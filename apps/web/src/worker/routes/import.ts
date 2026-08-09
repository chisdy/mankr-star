import { githubImportJobs } from "@mankr/db"
import { importGithubSchema } from "@mankr/shared"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { resolveGithubToken } from "../lib/ai-service"
import {
  cancelActiveImportJob,
  findActiveImportJob,
  findLatestImportJob,
  runGithubImportJob,
  serializeGithubImportJob,
} from "../lib/github-import-job"
import { rateLimit } from "../lib/rate-limit"
import { getClientIp, nowIso } from "../lib/utils"
import { requireAuth } from "../middleware/auth"

export const importRoutes = new Hono<AppEnv>()

/**
 * 内部续跑：仅校验 continue_token（无用户会话）。
 * 使用 renew 认领（调用方仍持有未过期 lease）。
 */
importRoutes.post("/bookmarks/import/github/jobs/:id/continue", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`import-github-continue:${ip}`, 60, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const id = c.req.param("id")
  let body: { token?: string } = {}
  try {
    body = (await c.req.json()) as { token?: string }
  } catch {
    body = {}
  }
  const headerToken = c.req.header("X-Import-Continue-Token")
  const token = headerToken || body.token
  if (!token) {
    return c.json({ error: "缺少续跑令牌", code: "UNAUTHORIZED" }, 401)
  }

  const job = await db
    .select()
    .from(githubImportJobs)
    .where(eq(githubImportJobs.id, id))
    .get()
  if (!job || job.continueToken !== token) {
    return c.json({ error: "续跑令牌无效", code: "UNAUTHORIZED" }, 401)
  }
  if (job.status !== "queued" && job.status !== "running") {
    return c.json({ job: serializeGithubImportJob(job) })
  }

  const continueBaseUrl = new URL(c.req.url).origin
  c.executionCtx.waitUntil(
    runGithubImportJob(c.env, id, c.executionCtx, {
      renew: true,
      continueBaseUrl,
    }),
  )
  return c.json({ ok: true, job: serializeGithubImportJob(job) })
})

/**
 * 启动 GitHub Stars 后台导入任务（discover → 逐条 README+AI）。
 * 立即返回 job；进度通过 GET .../active 轮询。
 */
importRoutes.post("/bookmarks/import/github", requireAuth, async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`import-github:${ip}`, 5, 300_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }

  const parsed = importGithubSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      400,
    )
  }

  const db = c.get("db")
  const token = await resolveGithubToken(db, c.env)
  if (!token) {
    return c.json(
      {
        error: "请先在设置中配置 GitHub PAT",
        code: "PAT_REQUIRED",
      },
      400,
    )
  }

  const active = await findActiveImportJob(db)
  if (active) {
    return c.json(
      {
        error: "已有导入任务进行中",
        code: "IMPORT_IN_PROGRESS",
        job: serializeGithubImportJob(active),
      },
      409,
    )
  }

  const id = crypto.randomUUID()
  const now = nowIso()
  const continueToken = crypto.randomUUID()

  await db.insert(githubImportJobs).values({
    id,
    status: "queued",
    phase: "discover",
    total: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    failedCount: 0,
    cursor: 0,
    queueJson: "[]",
    page: parsed.data.page,
    perPage: parsed.data.perPage,
    maxPages: parsed.data.maxPages,
    currentTitle: null,
    lastError: null,
    continueToken,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const job = await db
    .select()
    .from(githubImportJobs)
    .where(eq(githubImportJobs.id, id))
    .get()

  c.executionCtx.waitUntil(
    runGithubImportJob(c.env, id, c.executionCtx, {
      continueBaseUrl: new URL(c.req.url).origin,
    }),
  )

  return c.json({ job: serializeGithubImportJob(job!) }, 202)
})

/** 当前进行中任务，否则最近一次任务（供进度条轮询） */
importRoutes.get("/bookmarks/import/github/active", requireAuth, async (c) => {
  const db = c.get("db")
  const active = await findActiveImportJob(db)
  const job = active ?? (await findLatestImportJob(db))
  if (!job) return c.json({ job: null })
  return c.json({ job: serializeGithubImportJob(job) })
})

/** 取消进行中的导入 */
importRoutes.post("/bookmarks/import/github/cancel", requireAuth, async (c) => {
  const db = c.get("db")
  const job = await cancelActiveImportJob(db)
  if (!job) {
    return c.json({ error: "没有进行中的导入任务", code: "NOT_FOUND" }, 404)
  }
  return c.json({ job: serializeGithubImportJob(job) })
})
