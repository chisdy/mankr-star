import { createDb } from "@mankr/db"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../env"
import { hasScope, resolveBearerToken } from "../lib/api-tokens"
import { pruneRateLimitBuckets, rateLimit } from "../lib/rate-limit"
import { resolveSessionUser } from "../lib/session"
import { readSetting } from "../lib/settings-store"
import { getClientIp } from "../lib/utils"

export const withDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("db", createDb(c.env))
  await next()
}

async function resolveAuth(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  const db = c.get("db")
  const pepper = c.env.SESSION_SECRET
  const bearer = await resolveBearerToken(
    db,
    c.req.header("Authorization"),
    pepper,
  )
  if (bearer) {
    return {
      user: bearer.user,
      authMethod: "token" as const,
      tokenScopes: bearer.scopes,
    }
  }
  const user = await resolveSessionUser(c)
  if (user) {
    return {
      user,
      authMethod: "session" as const,
      tokenScopes: undefined,
    }
  }
  return null
}

function applyAuth(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuth>>>,
) {
  c.set("userId", auth.user.id)
  c.set("user", auth.user)
  c.set("authMethod", auth.authMethod)
  c.set("tokenScopes", auth.tokenScopes)
  c.set("isPublicRead", false)
}

/** 登录即可（Cookie 或 Bearer）。写权限由 requireWriteAccess / authByMethod 另行校验。 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await resolveAuth(c)
  if (!auth) {
    return c.json({ error: "未登录", code: "UNAUTHORIZED" }, 401)
  }
  applyAuth(c, auth)
  await next()
}

/** Bearer read-only token 禁止写操作；session 不受影响 */
export const requireWriteAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (
    c.get("authMethod") === "token" &&
    !hasScope(c.get("tokenScopes") ?? [], "write")
  ) {
    return c.json({ error: "Token 缺少 write 权限", code: "FORBIDDEN" }, 403)
  }
  await next()
}

/** 登录且（session 或 write-scope Bearer）才可写 */
export const requireAuthWrite: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await resolveAuth(c)
  if (!auth) {
    return c.json({ error: "未登录", code: "UNAUTHORIZED" }, 401)
  }
  applyAuth(c, auth)
  if (
    auth.authMethod === "token" &&
    !hasScope(auth.tokenScopes ?? [], "write")
  ) {
    return c.json({ error: "Token 缺少 write 权限", code: "FORBIDDEN" }, 403)
  }
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
  const auth = await resolveAuth(c)
  if (auth) {
    applyAuth(c, auth)
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
  const browsing = await readSetting(db, "browsing")

  if (!browsing.publicBrowsingEnabled) {
    return c.json({ error: "未登录", code: "UNAUTHORIZED" }, 401)
  }

  c.set("isPublicRead", true)
  await next()
}

/** GET → 公开只读；其它方法 → 必须登录且 Token 需 write */
export function authByMethod(
  getMw: MiddlewareHandler<AppEnv> = requireAuthOrPublicRead,
  otherMw: MiddlewareHandler<AppEnv> = requireAuthWrite,
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
