import {
  bookmarkTags,
  bookmarks,
  createDb,
  githubImportJobs,
  type Db,
  type GithubImportJob,
} from "@mankr/db"
import {
  IMPORT_JOB_LEASE_MS,
  IMPORT_JOB_TIME_BUDGET_MS,
  computeHealthStatus,
} from "@mankr/shared"
import { and, desc, eq, isNull, lt, or } from "drizzle-orm"
import type { Env } from "../env"
import { resolveGithubToken, runAiForBookmark } from "./ai-service"
import {
  GithubApiError,
  fetchReadmeExcerpt,
  fetchStarredPage,
  type StarredRepo,
} from "./github"
import { readSetting } from "./settings-store"
import { nowIso } from "./utils"

export type GithubImportJobPublic = {
  id: string
  status: string
  phase: string
  total: number
  processed: number
  imported: number
  skipped: number
  failed_count: number
  current_title: string | null
  last_error: string | null
  started_at: string | null
  updated_at: string
  finished_at: string | null
}

export function serializeGithubImportJob(
  job: GithubImportJob,
): GithubImportJobPublic {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    total: job.total,
    processed: job.processed,
    imported: job.imported,
    skipped: job.skipped,
    failed_count: job.failedCount,
    current_title: job.currentTitle,
    last_error: job.lastError,
    started_at: job.startedAt,
    updated_at: job.updatedAt,
    finished_at: job.finishedAt,
  }
}

export async function findActiveImportJob(
  db: Db,
): Promise<GithubImportJob | null> {
  return (
    (await db
      .select()
      .from(githubImportJobs)
      .where(
        or(
          eq(githubImportJobs.status, "queued"),
          eq(githubImportJobs.status, "running"),
        ),
      )
      .orderBy(desc(githubImportJobs.createdAt))
      .get()) ?? null
  )
}

export async function findLatestImportJob(
  db: Db,
): Promise<GithubImportJob | null> {
  return (
    (await db
      .select()
      .from(githubImportJobs)
      .orderBy(desc(githubImportJobs.createdAt))
      .get()) ?? null
  )
}

function leaseUntilIso(fromMs = Date.now()): string {
  return new Date(fromMs + IMPORT_JOB_LEASE_MS).toISOString()
}

function parseQueue(raw: string): StarredRepo[] {
  try {
    const parsed = JSON.parse(raw) as StarredRepo[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 认领卡住/排队任务：lease 为空或已过期。
 */
async function claimJob(db: Db, jobId: string): Promise<GithubImportJob | null> {
  const now = nowIso()
  const existing = await db
    .select()
    .from(githubImportJobs)
    .where(eq(githubImportJobs.id, jobId))
    .get()
  if (!existing) return null
  if (
    existing.status !== "queued" &&
    existing.status !== "running"
  ) {
    return null
  }
  if (
    existing.status === "running" &&
    existing.leaseUntil &&
    existing.leaseUntil > now
  ) {
    return null
  }

  const lease = leaseUntilIso()
  await db
    .update(githubImportJobs)
    .set({
      status: "running",
      startedAt: existing.startedAt ?? now,
      leaseUntil: lease,
      updatedAt: now,
      lastError: null,
    })
    .where(
      and(
        eq(githubImportJobs.id, jobId),
        or(
          eq(githubImportJobs.status, "queued"),
          and(
            eq(githubImportJobs.status, "running"),
            or(
              isNull(githubImportJobs.leaseUntil),
              lt(githubImportJobs.leaseUntil, now),
            ),
          ),
        ),
      ),
    )

  const claimed = await db
    .select()
    .from(githubImportJobs)
    .where(eq(githubImportJobs.id, jobId))
    .get()
  if (!claimed || claimed.status !== "running") return null
  if (claimed.leaseUntil !== lease) return null
  return claimed
}

/** 同一 waitUntil 链内续跑：刷新 lease */
async function renewLease(
  db: Db,
  jobId: string,
): Promise<GithubImportJob | null> {
  const now = nowIso()
  const lease = leaseUntilIso()
  await db
    .update(githubImportJobs)
    .set({ leaseUntil: lease, updatedAt: now, status: "running" })
    .where(
      and(
        eq(githubImportJobs.id, jobId),
        or(
          eq(githubImportJobs.status, "queued"),
          eq(githubImportJobs.status, "running"),
        ),
      ),
    )
  const row = await db
    .select()
    .from(githubImportJobs)
    .where(eq(githubImportJobs.id, jobId))
    .get()
  if (!row || row.status === "cancelled") return null
  return row
}

async function markFailed(db: Db, jobId: string, error: string): Promise<void> {
  const now = nowIso()
  await db
    .update(githubImportJobs)
    .set({
      status: "failed",
      lastError: error,
      finishedAt: now,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(eq(githubImportJobs.id, jobId))
}

async function markCompleted(db: Db, jobId: string): Promise<void> {
  const now = nowIso()
  await db
    .update(githubImportJobs)
    .set({
      status: "completed",
      phase: "process",
      currentTitle: null,
      finishedAt: now,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(eq(githubImportJobs.id, jobId))
}

async function discoverQueue(
  db: Db,
  job: GithubImportJob,
  token: string,
): Promise<GithubImportJob> {
  const queue: StarredRepo[] = []
  const seen = new Set<string>()
  let page = job.page

  for (let i = 0; i < job.maxPages; i++) {
    const { repos, hasMore } = await fetchStarredPage(token, page, job.perPage)
    for (const repo of repos) {
      if (!repo.fullName || seen.has(repo.fullName)) continue
      seen.add(repo.fullName)
      queue.push(repo)
    }
    if (!hasMore || repos.length === 0) break
    page += 1
  }

  const now = nowIso()
  await db
    .update(githubImportJobs)
    .set({
      phase: "process",
      queueJson: JSON.stringify(queue),
      total: queue.length,
      cursor: 0,
      processed: 0,
      updatedAt: now,
      currentTitle: queue[0]?.fullName ?? null,
      leaseUntil: leaseUntilIso(),
    })
    .where(eq(githubImportJobs.id, job.id))

  const updated = await db
    .select()
    .from(githubImportJobs)
    .where(eq(githubImportJobs.id, job.id))
    .get()
  return updated!
}

async function importOneRepo(
  db: Db,
  env: Env,
  repo: StarredRepo,
  thresholds: { hotWithinDays: number; staleAfterDays: number },
  token: string,
): Promise<"imported" | "skipped"> {
  const canonicalUrl = `https://github.com/${repo.fullName}`
  const existing = await db
    .select({
      id: bookmarks.id,
      deletedAt: bookmarks.deletedAt,
    })
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.sourceType, "github"),
        eq(bookmarks.canonicalUrl, canonicalUrl),
      ),
    )
    .get()

  if (existing && !existing.deletedAt) {
    return "skipped"
  }

  const now = nowIso()
  const syncStatus = repo.disabled ? ("forbidden" as const) : ("ok" as const)
  const healthStatus = computeHealthStatus({
    syncStatus,
    githubArchived: repo.archived,
    githubDisabled: repo.disabled,
    repoSize: repo.size,
    pushedAt: repo.pushedAt,
    defaultBranch: repo.defaultBranch,
    hotWithinDays: thresholds.hotWithinDays,
    staleAfterDays: thresholds.staleAfterDays,
  })
  const owner = repo.fullName.split("/")[0] || repo.owner

  const readmeExcerpt =
    (await fetchReadmeExcerpt(repo.owner, repo.repo, token)) ?? ""

  const values = {
    sourceType: "github" as const,
    canonicalUrl,
    externalId: repo.fullName,
    owner,
    title: repo.fullName,
    description: repo.description,
    language: repo.language,
    stars: repo.stars,
    forks: repo.forks,
    license: repo.license,
    homepage: repo.homepage,
    defaultBranch: repo.defaultBranch,
    topicsJson: JSON.stringify(repo.topics),
    readmeExcerpt,
    folderId: null as string | null,
    aiStatus: "pending" as const,
    trackUpdates: true,
    lastSyncedAt: now,
    pushedAt: repo.pushedAt,
    githubUpdatedAt: repo.updatedAt,
    syncStatus,
    lastSyncError: null as string | null,
    healthStatus,
    githubArchived: repo.archived,
    repoSize: repo.size,
    updatedAt: now,
    summaryAi: null as string | null,
    useCasesJson: null as string | null,
    aiConfidence: null as number | null,
    latestReleaseTag: null as string | null,
    archivedAt: null as string | null,
    deletedAt: null as string | null,
  }

  const id = existing?.id ?? crypto.randomUUID()
  if (existing) {
    await db
      .update(bookmarks)
      .set({ ...values, createdAt: now })
      .where(eq(bookmarks.id, id))
    await db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, id))
  } else {
    await db.insert(bookmarks).values({ ...values, id, createdAt: now })
  }

  await runAiForBookmark(db, env, id, { overwriteFolder: true })
  return "imported"
}

type ProcessOutcome = "done" | "continue" | "cancelled" | "failed"

/**
 * 处理一轮导入（discover + 若干 process 条目），受时间预算限制。
 * 返回 continue 时调用方应再调度一轮。
 */
export async function processGithubImportJobSlice(
  db: Db,
  env: Env,
  jobId: string,
  opts?: { renew?: boolean; budgetMs?: number },
): Promise<ProcessOutcome> {
  const job = opts?.renew
    ? await renewLease(db, jobId)
    : await claimJob(db, jobId)
  if (!job) return "done"

  if (job.status === "cancelled") return "cancelled"

  const token = await resolveGithubToken(db, env)
  if (!token) {
    await markFailed(db, jobId, "请先在设置中配置 GitHub PAT")
    return "failed"
  }

  const budgetMs = opts?.budgetMs ?? IMPORT_JOB_TIME_BUDGET_MS
  const deadline = Date.now() + budgetMs
  let current = job

  try {
    if (current.phase === "discover") {
      current = await discoverQueue(db, current, token)
    }

    const cancelled = await db
      .select({ status: githubImportJobs.status })
      .from(githubImportJobs)
      .where(eq(githubImportJobs.id, jobId))
      .get()
    if (cancelled?.status === "cancelled") return "cancelled"

    if (current.total === 0) {
      await markCompleted(db, jobId)
      return "done"
    }

    const thresholds = await readSetting(db, "tracking")
    const queue = parseQueue(current.queueJson)
    let cursor = current.cursor
    let processed = current.processed
    let imported = current.imported
    let skipped = current.skipped
    let failedCount = current.failedCount

    while (cursor < queue.length) {
      if (Date.now() >= deadline) {
        // 保持 lease，避免 cron 与即将发起的 continue 双跑
        await db
          .update(githubImportJobs)
          .set({
            cursor,
            processed,
            imported,
            skipped,
            failedCount,
            updatedAt: nowIso(),
            leaseUntil: leaseUntilIso(),
            currentTitle: queue[cursor]?.fullName ?? null,
          })
          .where(eq(githubImportJobs.id, jobId))
        return "continue"
      }

      const statusRow = await db
        .select({ status: githubImportJobs.status })
        .from(githubImportJobs)
        .where(eq(githubImportJobs.id, jobId))
        .get()
      if (statusRow?.status === "cancelled") {
        await db
          .update(githubImportJobs)
          .set({
            cursor,
            processed,
            imported,
            skipped,
            failedCount,
            leaseUntil: null,
            finishedAt: nowIso(),
            updatedAt: nowIso(),
          })
          .where(eq(githubImportJobs.id, jobId))
        return "cancelled"
      }

      const repo = queue[cursor]!
      await db
        .update(githubImportJobs)
        .set({
          currentTitle: repo.fullName,
          updatedAt: nowIso(),
          leaseUntil: leaseUntilIso(),
        })
        .where(eq(githubImportJobs.id, jobId))

      try {
        const result = await importOneRepo(db, env, repo, thresholds, token)
        if (result === "imported") imported += 1
        else skipped += 1
      } catch (e) {
        failedCount += 1
        const msg =
          e instanceof GithubApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "导入失败"
        await db
          .update(githubImportJobs)
          .set({ lastError: msg, updatedAt: nowIso() })
          .where(eq(githubImportJobs.id, jobId))
      }

      cursor += 1
      processed += 1

      await db
        .update(githubImportJobs)
        .set({
          cursor,
          processed,
          imported,
          skipped,
          failedCount,
          updatedAt: nowIso(),
          leaseUntil: leaseUntilIso(),
          currentTitle: queue[cursor]?.fullName ?? repo.fullName,
        })
        .where(eq(githubImportJobs.id, jobId))
    }

    await markCompleted(db, jobId)
    return "done"
  } catch (e) {
    const msg =
      e instanceof GithubApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : "导入任务失败"
    await markFailed(db, jobId, msg)
    return "failed"
  }
}

export type RunGithubImportJobOpts = {
  /** token 鉴权的 continue / 同链兜底续跑 */
  renew?: boolean
  /** 单轮预算（测试可注入） */
  budgetMs?: number
  /**
   * Worker 对外 origin（如 https://example.com）。
   * 有值时预算用尽后 HTTP 自调用 continue 端点以刷新 CPU 预算；
   * 缺失或自调用失败时回退为同请求 waitUntil(renew)。
   */
  continueBaseUrl?: string
}

/**
 * 仅依赖 waitUntil，兼容 CF ExecutionContext 与 Hono 的 executionCtx
 *（后者缺少 workers-types 新增的 tracing 等字段）。
 */
export type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void
}

async function scheduleContinue(
  env: Env,
  jobId: string,
  continueToken: string,
  ctx: WaitUntilContext,
  continueBaseUrl?: string,
): Promise<void> {
  const nested = () =>
    ctx.waitUntil(
      runGithubImportJob(env, jobId, ctx, {
        renew: true,
        continueBaseUrl,
      }),
    )

  if (!continueBaseUrl) {
    nested()
    return
  }

  const url = `${continueBaseUrl.replace(/\/$/, "")}/api/bookmarks/import/github/jobs/${jobId}/continue`
  ctx.waitUntil(
    (async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Import-Continue-Token": continueToken,
          },
          body: JSON.stringify({ token: continueToken }),
        })
        if (!res.ok) {
          nested()
        }
      } catch {
        nested()
      }
    })(),
  )
}

/**
 * 处理导入任务；预算用尽时优先 HTTP 自调用 continue 刷新预算。
 */
export async function runGithubImportJob(
  env: Env,
  jobId: string,
  ctx: WaitUntilContext,
  opts?: RunGithubImportJobOpts,
): Promise<void> {
  const db = createDb(env)
  const outcome = await processGithubImportJobSlice(db, env, jobId, {
    renew: opts?.renew,
    budgetMs: opts?.budgetMs,
  })
  if (outcome !== "continue") return

  const job = await db
    .select({ continueToken: githubImportJobs.continueToken })
    .from(githubImportJobs)
    .where(eq(githubImportJobs.id, jobId))
    .get()
  if (!job) return

  await scheduleContinue(
    env,
    jobId,
    job.continueToken,
    ctx,
    opts?.continueBaseUrl,
  )
}

/** Cron：捞 lease 过期仍未完成的任务 */
export async function continueStaleGithubImportJobs(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<{ resumed: number }> {
  const db = createDb(env)
  const now = nowIso()
  const stale = await db
    .select({ id: githubImportJobs.id })
    .from(githubImportJobs)
    .where(
      and(
        or(
          eq(githubImportJobs.status, "queued"),
          eq(githubImportJobs.status, "running"),
        ),
        or(
          isNull(githubImportJobs.leaseUntil),
          lt(githubImportJobs.leaseUntil, now),
        ),
      ),
    )
    .limit(1)

  const jobId = stale[0]?.id
  if (!jobId) return { resumed: 0 }

  const execCtx: WaitUntilContext =
    ctx ??
    {
      waitUntil(promise: Promise<unknown>) {
        void promise
      },
    }

  // cron 本身是新 invocation；优先 APP_URL 自调用 continue，否则同链 renew
  const baseUrl = env.APP_URL

  if (ctx) {
    ctx.waitUntil(
      runGithubImportJob(env, jobId, execCtx, { continueBaseUrl: baseUrl }),
    )
  } else {
    await runGithubImportJob(env, jobId, execCtx, { continueBaseUrl: baseUrl })
  }
  return { resumed: 1 }
}

export async function cancelActiveImportJob(
  db: Db,
): Promise<GithubImportJob | null> {
  const active = await findActiveImportJob(db)
  if (!active) return null
  const now = nowIso()
  await db
    .update(githubImportJobs)
    .set({
      status: "cancelled",
      finishedAt: now,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(eq(githubImportJobs.id, active.id))
  return (
    (await db
      .select()
      .from(githubImportJobs)
      .where(eq(githubImportJobs.id, active.id))
      .get()) ?? null
  )
}
