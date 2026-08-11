import { users } from "@mankr/db"
import { loginSchema, registerSchema } from "@mankr/shared"
import { count, eq, or } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { seedPresetFolders } from "../lib/ai-service"
import { hashPassword, verifyPassword } from "../lib/password"
import { pruneRateLimitBuckets, rateLimit } from "../lib/rate-limit"
import {
  createSession,
  resolveSessionUser,
  revokeSession,
} from "../lib/session"
import { initializeSettings, readAllSettings } from "../lib/settings-store"
import { serializeUser } from "../lib/user-response"
import { getClientIp, nowIso } from "../lib/utils"
import { requireAuth } from "../middleware/auth"

export const authRoutes = new Hono<AppEnv>()

/** 供访客页判断实例是否已初始化；并软探测当前是否已登录（不 401） */
authRoutes.get("/auth/status", async (c) => {
  const db = c.get("db")
  const sessionUser = await resolveSessionUser(c)
  const authenticated = Boolean(sessionUser)

  // 一次取全部领域：这个接口每次进页面都会调，别为两个领域走两趟
  const { analytics, bookmarks, browsing } = await readAllSettings(db)

  const [{ value: userCount }] = await db.select({ value: count() }).from(users)
  const initialized = userCount > 0

  return c.json({
    initialized,
    public_browsing_enabled: initialized && browsing.publicBrowsingEnabled,
    authenticated,
    bookmark_pagination_mode: bookmarks.paginationMode,
    bookmark_page_size: bookmarks.pageSize,
    google_analytics_measurement_id: analytics.measurementId,
  })
})

authRoutes.post("/auth/register", async (c) => {
  pruneRateLimitBuckets()
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`register:${ip}`, 5, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = registerSchema.safeParse(body)
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
  const [{ value: userCount }] = await db.select({ value: count() }).from(users)
  if (userCount > 0) {
    return c.json(
      {
        error: "本实例已初始化，无法再次注册",
        code: "INSTANCE_INITIALIZED",
      },
      409,
    )
  }

  const { email, password } = parsed.data
  const username =
    parsed.data.username ||
    email.split("@")[0]!.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) ||
    "owner"

  const id = crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  const now = nowIso()

  await db.insert(users).values({
    id,
    username,
    email,
    passwordHash,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  })

  await initializeSettings(db)
  await seedPresetFolders(db)
  await createSession(c, id)

  return c.json(
    {
      user: serializeUser(
        { id, username, email, createdAt: now },
        await readAllSettings(db),
      ),
    },
    201,
  )
})

authRoutes.post("/auth/login", async (c) => {
  pruneRateLimitBuckets()
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`login:${ip}`, 10, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = loginSchema.safeParse(body)
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
  const { username, password } = parsed.data
  const user = await db
    .select()
    .from(users)
    .where(or(eq(users.email, username), eq(users.username, username)))
    .get()

  // 统一错误，不泄露账号是否存在
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return c.json({ error: "用户名或密码错误", code: "INVALID_CREDENTIALS" }, 401)
  }

  await db
    .update(users)
    .set({ lastLoginAt: nowIso(), updatedAt: nowIso() })
    .where(eq(users.id, user.id))

  await seedPresetFolders(db)
  await createSession(c, user.id)

  return c.json({ user: serializeUser(user, await readAllSettings(db)) })
})

authRoutes.post("/auth/logout", requireAuth, async (c) => {
  await revokeSession(c)
  return c.json({ ok: true })
})
