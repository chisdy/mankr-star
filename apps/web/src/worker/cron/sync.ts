import { bookmarks, createDb, updateEvents, users, type Db } from "@mankr/db"
import {
  CRON_AI_BACKFILL_BATCH_SIZE,
  CRON_SYNC_BATCH_SIZE,
  DEFAULT_HOT_WITHIN_DAYS,
  DEFAULT_STALE_AFTER_DAYS,
  STARS_DELTA_ABS_MIN,
  STARS_DELTA_THRESHOLD,
  computeHealthStatus,
  type HealthStatus,
  type SyncStatus,
} from "@mankr/shared"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import type { Env } from "../env"
import { resolveGithubToken, runAiForBookmark } from "../lib/ai-service"
import { GithubApiError, fetchGithubRepo, fetchLatestRelease } from "../lib/github"
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

async function loadTrackingThresholds(db: Db): Promise<{
  hotWithinDays: number
  staleAfterDays: number
}> {
  const user = await db.select().from(users).get()
  return {
    hotWithinDays: user?.hotWithinDays ?? DEFAULT_HOT_WITHIN_DAYS,
    staleAfterDays: user?.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
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
  const thresholds = await loadTrackingThresholds(db)

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

      if (meta.pushedAt && meta.pushedAt !== bookmark.pushedAt) {
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
        absDelta >= STARS_DELTA_ABS_MIN ||
        (absDelta > 0 && relDelta >= STARS_DELTA_THRESHOLD)
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
        (meta.description ?? null) !== (bookmark.description ?? null) ||
        (meta.language ?? null) !== (bookmark.language ?? null)
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
      const healthStatus = healthFromMeta(meta, syncStatus, thresholds)

      await db
        .update(bookmarks)
        .set({
          stars: meta.stars,
          forks: meta.forks,
          description: meta.description,
          language: meta.language,
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

export async function runCronJobs(env: Env): Promise<void> {
  await syncUpdates(env)
  await aiBackfill(env)
}

export { healthFromMeta, loadTrackingThresholds }
