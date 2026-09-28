import { browserImportJobs } from "@mankr/db"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import {
  appendBrowserImportBatch,
  applyBrowserImportChoice,
  beginBrowserImportScan,
  BrowserImportError,
  cancelBrowserImportJob,
  createBrowserImportJob,
  findActiveBrowserImportJob,
  runBrowserImportJob,
  serializeBrowserImportJob,
} from "../lib/browser-import-job"
import { rateLimit } from "../lib/rate-limit"
import { getClientIp } from "../lib/utils"
import { requireAuth, requireAuthWrite } from "../middleware/auth"

export const browserImportRoutes = new Hono<AppEnv>()

function fail(
  error: unknown
): { status: number; body: { error: string; code: string } } | null {
  if (!(error instanceof BrowserImportError)) return null
  return {
    status: error.status,
    body: { error: error.message, code: error.code },
  }
}

/**
 * 续跑只校验 continue_token。定时任务没有登录会话，不能走 requireAuth。
 */
browserImportRoutes.post(
  "/bookmarks/import/browser/jobs/:id/continue",
  async (c) => {
    const ip = getClientIp(c.req.raw)
    const limited = rateLimit(`import-browser-continue:${ip}`, 60, 60_000)
    if (!limited.ok) {
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
    const token = c.req.header("X-Import-Continue-Token") || body.token
    if (!token) {
      return c.json({ error: "缺少续跑令牌", code: "UNAUTHORIZED" }, 401)
    }

    const job = await db
      .select()
      .from(browserImportJobs)
      .where(eq(browserImportJobs.id, id))
      .get()
    if (!job || job.continueToken !== token) {
      return c.json({ error: "续跑令牌无效", code: "UNAUTHORIZED" }, 401)
    }

    const resumable =
      job.status === "probing" ||
      job.status === "classifying" ||
      job.status === "importing"
    if (!resumable) {
      return c.json({
        ok: true,
        job: await serializeBrowserImportJob(db, c.env, job),
      })
    }

    const continueBaseUrl = new URL(c.req.url).origin
    c.executionCtx.waitUntil(
      runBrowserImportJob(c.env, id, c.executionCtx, {
        renew: true,
        continueBaseUrl,
      })
    )
    return c.json({
      ok: true,
      job: await serializeBrowserImportJob(db, c.env, job),
    })
  }
)

browserImportRoutes.get(
  "/bookmarks/import/browser/active",
  requireAuth,
  async (c) => {
    const db = c.get("db")
    const job = await findActiveBrowserImportJob(db)
    return c.json({
      job: job ? await serializeBrowserImportJob(db, c.env, job) : null,
    })
  }
)

browserImportRoutes.get(
  "/bookmarks/import/browser/jobs/:id",
  requireAuth,
  async (c) => {
    const db = c.get("db")
    const job = await db
      .select()
      .from(browserImportJobs)
      .where(eq(browserImportJobs.id, c.req.param("id")))
      .get()
    if (!job) return c.json({ error: "导入任务不存在", code: "NOT_FOUND" }, 404)
    return c.json({ job: await serializeBrowserImportJob(db, c.env, job) })
  }
)

browserImportRoutes.post(
  "/bookmarks/import/browser",
  requireAuthWrite,
  async (c) => {
    const ip = getClientIp(c.req.raw)
    const limited = rateLimit(`import-browser:${ip}`, 20, 60_000)
    if (!limited.ok) {
      return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
    }

    let body: { source?: string } = {}
    try {
      body = (await c.req.json()) as { source?: string }
    } catch {
      body = {}
    }
    const source = body.source === "extension" ? "extension" : "html"
    const db = c.get("db")
    try {
      const job = await createBrowserImportJob(db, source)
      return c.json(
        { job: await serializeBrowserImportJob(db, c.env, job) },
        201
      )
    } catch (error) {
      const known = fail(error)
      if (known) return c.json(known.body, known.status as 400)
      throw error
    }
  }
)

browserImportRoutes.post(
  "/bookmarks/import/browser/jobs/:id/batches",
  requireAuthWrite,
  async (c) => {
    const ip = getClientIp(c.req.raw)
    const limited = rateLimit(`import-browser-batch:${ip}`, 120, 60_000)
    if (!limited.ok) {
      return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
    }

    let body: { batchIndex?: number; items?: unknown[] } = {}
    try {
      body = (await c.req.json()) as { batchIndex?: number; items?: unknown[] }
    } catch {
      return c.json({ error: "参数校验失败", code: "VALIDATION_ERROR" }, 400)
    }

    const db = c.get("db")
    try {
      const result = await appendBrowserImportBatch(
        db,
        c.req.param("id"),
        Number(body.batchIndex),
        Array.isArray(body.items) ? body.items : []
      )
      return c.json({ ok: true, ...result })
    } catch (error) {
      const known = fail(error)
      if (known) return c.json(known.body, known.status as 400)
      throw error
    }
  }
)

browserImportRoutes.post(
  "/bookmarks/import/browser/jobs/:id/scan",
  requireAuthWrite,
  async (c) => {
    const db = c.get("db")
    try {
      const job = await beginBrowserImportScan(db, c.req.param("id"))
      if (job.status === "probing") {
        const continueBaseUrl = new URL(c.req.url).origin
        c.executionCtx.waitUntil(
          runBrowserImportJob(c.env, job.id, c.executionCtx, {
            continueBaseUrl,
          })
        )
      }
      return c.json({ job: await serializeBrowserImportJob(db, c.env, job) })
    } catch (error) {
      const known = fail(error)
      if (known) return c.json(known.body, known.status as 400)
      throw error
    }
  }
)

browserImportRoutes.post(
  "/bookmarks/import/browser/jobs/:id/choice",
  requireAuthWrite,
  async (c) => {
    let body: { placement?: string; dead_policy?: string } = {}
    try {
      body = (await c.req.json()) as {
        placement?: string
        dead_policy?: string
      }
    } catch {
      return c.json({ error: "参数校验失败", code: "VALIDATION_ERROR" }, 400)
    }

    const db = c.get("db")
    try {
      const job = await applyBrowserImportChoice(
        db,
        c.env,
        c.req.param("id"),
        body.placement ?? "",
        body.dead_policy ?? ""
      )
      if (job.status === "classifying" || job.status === "importing") {
        const continueBaseUrl = new URL(c.req.url).origin
        c.executionCtx.waitUntil(
          runBrowserImportJob(c.env, job.id, c.executionCtx, {
            continueBaseUrl,
          })
        )
      }
      return c.json({ job: await serializeBrowserImportJob(db, c.env, job) })
    } catch (error) {
      const known = fail(error)
      if (known) return c.json(known.body, known.status as 400)
      throw error
    }
  }
)

browserImportRoutes.post(
  "/bookmarks/import/browser/jobs/:id/cancel",
  requireAuthWrite,
  async (c) => {
    const db = c.get("db")
    const job = await cancelBrowserImportJob(db, c.req.param("id"))
    if (!job) return c.json({ error: "导入任务不存在", code: "NOT_FOUND" }, 404)
    return c.json({ job: await serializeBrowserImportJob(db, c.env, job) })
  }
)
