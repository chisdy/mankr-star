import { bookmarks, createDb, updateEvents, type Db } from "@mankr/db"
import {
  CRON_AI_BACKFILL_BATCH_SIZE,
  CRON_SYNC_BATCH_SIZE,
  STARS_DELTA_ABS_MIN,
  STARS_DELTA_THRESHOLD,
  computeHealthStatus,
  type HealthStatus,
  type SyncStatus,
  type TrackingSettingsValue,
} from "@mankr/shared"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import type { Env } from "../env"
import { resolveGithubToken, runAiForBookmark } from "../lib/ai-service"
import { continueStaleGithubImportJobs } from "../lib/github-import-job"
import {
  GithubApiError,
  fetchGithubRepo,
  fetchLatestRelease,
  fetchReadmeExcerpt,
} from "../lib/github"
import { readSetting } from "../lib/settings-store"
import { nowIso } from "../lib/utils"

async function insertEventIdempotent(
  db: Db,
  bookmarkId: string,
  eventType: string,
  dedupeKey: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const existing = await db
    .select({ id: updateEvents.id })
    .from(updateEvents)
    .where(
      and(
        eq(updateEvents.bookmarkId, bookmarkId),
        eq(updateEvents.dedupeKey, dedupeKey),
      ),
    )
    .get()
  if (existing) return false

  await db.insert(updateEvents).values({
    id: crypto.randomUUID(),
    bookmarkId,
    eventType,
    dedupeKey,
    payloadJson: JSON.stringify(payload),
    detectedAt: nowIso(),
  })
  return true
}

async function loadTrackingSettings(db: Db): Promise<TrackingSettingsValue> {
  return readSetting(db, "tracking")
}

/**
 * 仓库改名或转移后要重写的坐标字段；未改名返回 null。
 *
 * 若新地址已被库里另一条收藏占用就整体放弃改写：
 * (source_type, canonical_url) 上有唯一索引，硬写只会让整轮同步落到错误分支。
 */
async function renameIdentityPatch(
  db: Db,
  bookmark: typeof bookmarks.$inferSelect,
  fullName: string,
): Promise<Partial<typeof bookmarks.$inferInsert> | null> {
  if (!fullName || fullName === bookmark.externalId) return null

  const canonicalUrl = `https://github.com/${fullName}`
  const conflict = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.sourceType, "github"),
        eq(bookmarks.canonicalUrl, canonicalUrl),
      ),
    )
    .get()
  if (conflict && conflict.id !== bookmark.id) return null

  return {
    externalId: fullName,
    canonicalUrl,
    // 用户改过标题就保留他的写法，只有仍是默认的 owner/repo 才跟着改
    ...(bookmark.title === bookmark.externalId ? { title: fullName } : {}),
  }
}

function healthFromMeta(
  meta: {
    archived: boolean
    disabled: boolean
    size: number
    pushedAt: string | null
    defaultBranch: string | null
  },
  syncStatus: SyncStatus,
  thresholds: { hotWithinDays: number; staleAfterDays: number },
): HealthStatus {
  return computeHealthStatus({
    syncStatus,
    githubArchived: meta.archived,
    githubDisabled: meta.disabled,
    repoSize: meta.size,
    pushedAt: meta.pushedAt,
    defaultBranch: meta.defaultBranch,
    hotWithinDays: thresholds.hotWithinDays,
    staleAfterDays: thresholds.staleAfterDays,
  })
}

export async function syncUpdates(env: Env): Promise<{ scanned: number; events: number }> {
  const db = createDb(env)
  const token = await resolveGithubToken(db, env)
  const tracking = await loadTrackingSettings(db)

  const batch = await db
    .select()
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.sourceType, "github"),
        eq(bookmarks.trackUpdates, true),
        isNull(bookmarks.deletedAt),
        isNull(bookmarks.archivedAt),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${bookmarks.lastSyncedAt} IS NULL THEN 0 ELSE 1 END`,
      asc(bookmarks.lastSyncedAt),
    )
    .limit(CRON_SYNC_BATCH_SIZE)

  let events = 0

  for (const bookmark of batch) {
    const [owner, repo] = bookmark.externalId.split("/")
    if (!owner || !repo) continue

    const now = nowIso()

    try {
      const meta = await fetchGithubRepo(owner, repo, token)
      const release = await fetchLatestRelease(owner, repo, token)

      // 用旧地址请求会被 GitHub 重定向到改名/转移后的仓库，full_name 即新坐标
      const identityPatch = await renameIdentityPatch(db, bookmark, meta.fullName)
      if (identityPatch && tracking.eventMetaChange) {
        const ok = await insertEventIdempotent(
          db,
          bookmark.id,
          "meta_change",
          `meta:renamed:${bookmark.externalId}->${meta.fullName}`,
          { kind: "renamed", from: bookmark.externalId, to: meta.fullName },
        )
        if (ok) events += 1
      }

      if (
        tracking.eventPush &&
        meta.pushedAt &&
        meta.pushedAt !== bookmark.pushedAt
      ) {
        const ok = await insertEventIdempotent(
          db,
          bookmark.id,
          "push",
          `push:${meta.pushedAt}`,
          {
            previous: bookmark.pushedAt,
            current: meta.pushedAt,
          },
        )
        if (ok) events += 1
      }

      if (
        tracking.eventRelease &&
        release?.tagName &&
        release.tagName !== bookmark.latestReleaseTag
      ) {
        const ok = await insertEventIdempotent(
          db,
          bookmark.id,
          "release",
          `release:${release.tagName}`,
          {
            previous: bookmark.latestReleaseTag,
            current: release.tagName,
            name: release.name,
            published_at: release.publishedAt,
          },
        )
        if (ok) events += 1
      }

      const prevStars = bookmark.stars
      const nextStars = meta.stars
      const absDelta = Math.abs(nextStars - prevStars)
      const relDelta = prevStars > 0 ? absDelta / prevStars : absDelta > 0 ? 1 : 0
      if (
        tracking.eventStarsDelta &&
        (absDelta >= STARS_DELTA_ABS_MIN ||
          (absDelta > 0 && relDelta >= STARS_DELTA_THRESHOLD))
      ) {
        const ok = await insertEventIdempotent(
          db,
          bookmark.id,
          "stars_delta",
          `stars:${prevStars}->${nextStars}:${meta.updatedAt ?? now}`,
          { previous: prevStars, current: nextStars },
        )
        if (ok) events += 1
      }

      if (
        tracking.eventMetaChange &&
        ((meta.description ?? null) !== (bookmark.description ?? null) ||
          (meta.language ?? null) !== (bookmark.language ?? null))
      ) {
        const ok = await insertEventIdempotent(
          db,
          bookmark.id,
          "meta_change",
          `meta:${meta.updatedAt ?? now}`,
          {
            description: meta.description,
            language: meta.language,
          },
        )
        if (ok) events += 1
      }

      const syncStatus: SyncStatus = meta.disabled ? "forbidden" : "ok"
      const healthStatus = healthFromMeta(meta, syncStatus, tracking)

      // README：null = 从未试过；"" = 已试过但没有。避免对空仓库每轮空打
      const shouldFetchReadme =
        bookmark.readmeExcerpt == null ||
        (meta.pushedAt != null && meta.pushedAt !== bookmark.pushedAt)
      const readmeExcerpt = shouldFetchReadme
        ? await fetchReadmeExcerpt(
            owner,
            repo,
            token,
            AbortSignal.timeout(8_000),
          )
        : null

      await db
        .update(bookmarks)
        .set({
          ...identityPatch,
          ...(shouldFetchReadme
            ? { readmeExcerpt: readmeExcerpt ?? "" }
            : {}),
          stars: meta.stars,
          forks: meta.forks,
          description: meta.description,
          language: meta.language,
          owner: meta.fullName.split("/")[0] || owner,
          topicsJson: JSON.stringify(meta.topics),
          defaultBranch: meta.defaultBranch,
          pushedAt: meta.pushedAt,
          githubUpdatedAt: meta.updatedAt,
          latestReleaseTag: release?.tagName ?? bookmark.latestReleaseTag,
          githubArchived: meta.archived,
          repoSize: meta.size,
          syncStatus,
          lastSyncError: null,
          healthStatus,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .where(eq(bookmarks.id, bookmark.id))
    } catch (e) {
      let syncStatus: SyncStatus = "error"
      let healthStatus: HealthStatus = bookmark.healthStatus as HealthStatus
      let lastSyncError = "同步失败"

      if (e instanceof GithubApiError) {
        lastSyncError = e.message
        if (e.status === 404 || e.status === 410) {
          syncStatus = "not_found"
          healthStatus = "unavailable"
        } else if (e.status === 403) {
          syncStatus = "forbidden"
          healthStatus = "unavailable"
        } else {
          // error：保留原 health，不误判为停更
          healthStatus = (bookmark.healthStatus as HealthStatus) || "unknown"
        }
      }

      await db
        .update(bookmarks)
        .set({
          syncStatus,
          lastSyncError,
          healthStatus,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .where(eq(bookmarks.id, bookmark.id))
    }
  }

  return { scanned: batch.length, events }
}

export async function aiBackfill(env: Env): Promise<{ processed: number }> {
  const db = createDb(env)
  const pending = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.aiStatus, "pending"),
        isNull(bookmarks.deletedAt),
      ),
    )
    .orderBy(asc(bookmarks.createdAt))
    .limit(CRON_AI_BACKFILL_BATCH_SIZE)

  for (const row of pending) {
    await runAiForBookmark(db, env, row.id)
  }

  return { processed: pending.length }
}

export async function runCronJobs(
  env: Env,
  ctx?: ExecutionContext,
): Promise<void> {
  await syncUpdates(env)
  await aiBackfill(env)
  await continueStaleGithubImportJobs(env, ctx)
}

export { healthFromMeta, loadTrackingSettings }
