import { createDb, users } from "@mankr/db"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../env"
import { pruneRateLimitBuckets, rateLimit } from "../lib/rate-limit"
import { resolveSessionUser } from "../lib/session"
import { getClientIp } from "../lib/utils"

export const withDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("db", createDb(c.env))
  await next()
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await resolveSessionUser(c)
  if (!user) {
    return c.json({ error: "未登录", code: "UNAUTHORIZED" }, 401)
  }
  c.set("userId", user.id)
  c.set("user", user)
  c.set("isPublicRead", false)
  await next()
}

/**
 * 已登录放行；未登录则在「公开浏览」开启时以只读访客放行，否则 401。
 * 访客请求带轻量 IP 限流。
 */
export const requireAuthOrPublicRead: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const user = await resolveSessionUser(c)
  if (user) {
    c.set("userId", user.id)
    c.set("user", user)
    c.set("isPublicRead", false)
    await next()
    return
  }

  pruneRateLimitBuckets()
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`public-read:${ip}`, 120, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const row = await db
    .select({ enabled: users.publicBrowsingEnabled })
    .from(users)
    .get()

  if (!row?.enabled) {
    return c.json({ error: "未登录", code: "UNAUTHORIZED" }, 401)
  }

  c.set("isPublicRead", true)
  await next()
}

/** GET → 公开只读；其它方法 → 必须登录 */
export function authByMethod(
  getMw: MiddlewareHandler<AppEnv> = requireAuthOrPublicRead,
  otherMw: MiddlewareHandler<AppEnv> = requireAuth,
  /**
   * 额外允许公开读访客访问的非 GET 路径判断。
   * 例如外链打开计数 POST /bookmarks/:id/open。
   */
  allowPublicWrite?: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => boolean,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === "GET") {
      return getMw(c, next)
    }
    if (allowPublicWrite?.(c)) {
      return getMw(c, next)
    }
    return otherMw(c, next)
  }
}
