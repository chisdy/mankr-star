import {
  aiJobs,
  aiUsageLogs,
  bookmarkTags,
  bookmarks,
  folders,
  kbConversations,
  kbMessages,
  sessions,
  tags,
  updateEvents,
  users,
} from "@mankr/db"
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_HOT_WITHIN_DAYS,
  DEFAULT_STALE_AFTER_DAYS,
  anysearchSettingsSchema,
  changePasswordSchema,
  deepseekSettingsSchema,
  githubPatSettingsSchema,
  recomputeActivityHealth,
  trackingSettingsSchema,
  updatePublicBrowsingSchema,
  type HealthStatus,
} from "@mankr/shared"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import type { Context } from "hono"
import type { AppEnv } from "../env"
import { getAnySearchKey, testAnySearchConnection } from "../lib/anysearch"
import { decryptSecret, encryptSecret, last4 } from "../lib/crypto"
import { recordAiUsage } from "../lib/ai-usage"
import { testDeepSeekConnection } from "../lib/deepseek"
import { hashPassword, verifyPassword } from "../lib/password"
import { rateLimit } from "../lib/rate-limit"
import { getClientIp, nowIso } from "../lib/utils"
import { requireAuth } from "../middleware/auth"

export const settingsRoutes = new Hono<AppEnv>()

settingsRoutes.use("/settings", requireAuth)
settingsRoutes.use("/settings/*", requireAuth)

settingsRoutes.put("/settings/deepseek", (c) => upsertDeepseek(c))
settingsRoutes.patch("/settings/deepseek", (c) => upsertDeepseek(c))

settingsRoutes.delete("/settings/deepseek", async (c) => {
  const db = c.get("db")
  const user = await db.select().from(users).get()
  if (!user) return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)

  await db
    .update(users)
    .set({
      deepseekApiKeyEncrypted: null,
      deepseekKeyLast4: null,
      updatedAt: nowIso(),
    })
    .where(eq(users.id, user.id))

  return c.json({
    deepseek_configured: false,
    deepseek_last4: null,
    deepseek_model: user.deepseekModel || DEFAULT_DEEPSEEK_MODEL,
  })
})

async function upsertDeepseek(c: Context<AppEnv>) {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`deepseek-settings:${ip}`, 20, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = deepseekSettingsSchema.safeParse(body)
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

  if (!parsed.data.clearKey && !parsed.data.apiKey && !parsed.data.model) {
    return c.json(
      { error: "请提供 apiKey、model 或 clearKey", code: "BAD_REQUEST" },
      400,
    )
  }

  const db = c.get("db")
  const user = await db.select().from(users).get()
  if (!user) return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)

  const encKey = c.env.AI_KEY_ENCRYPTION_KEY || c.env.PAT_ENCRYPTION_KEY
  const patch: Partial<typeof users.$inferInsert> = {
    updatedAt: nowIso(),
  }

  if (parsed.data.clearKey) {
    patch.deepseekApiKeyEncrypted = null
    patch.deepseekKeyLast4 = null
  } else if (parsed.data.apiKey) {
    patch.deepseekApiKeyEncrypted = await encryptSecret(
      parsed.data.apiKey,
      encKey,
    )
    patch.deepseekKeyLast4 = last4(parsed.data.apiKey)
  }

  if (parsed.data.model) {
    patch.deepseekModel = parsed.data.model
  }

  await db.update(users).set(patch).where(eq(users.id, user.id))
  const updated = await db.select().from(users).get()

  return c.json({
    deepseek_configured: Boolean(updated?.deepseekApiKeyEncrypted),
    deepseek_last4: updated?.deepseekKeyLast4 ?? null,
    deepseek_model: updated?.deepseekModel || DEFAULT_DEEPSEEK_MODEL,
  })
}

settingsRoutes.post("/settings/deepseek/test", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`deepseek-test:${ip}`, 10, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const user = await db.select().from(users).get()
  if (!user?.deepseekApiKeyEncrypted) {
    return c.json(
      {
        ok: false,
        error: "尚未配置 DeepSeek API Key",
        code: "NOT_CONFIGURED",
      },
      400,
    )
  }

  const encKey = c.env.AI_KEY_ENCRYPTION_KEY || c.env.PAT_ENCRYPTION_KEY
  let apiKey: string
  try {
    apiKey = await decryptSecret(user.deepseekApiKeyEncrypted, encKey)
  } catch {
    return c.json({ ok: false, error: "解密 Key 失败" }, 500)
  }

  const result = await testDeepSeekConnection(
    apiKey,
    user.deepseekModel || DEFAULT_DEEPSEEK_MODEL,
  )
  await recordAiUsage(db, {
    kind: "connection_test",
    model: result.model,
    status: result.ok ? "ok" : "error",
    usage: result.usage,
    errorCode: result.ok ? null : (result.error?.slice(0, 120) ?? "TEST_FAILED"),
    latencyMs: result.latencyMs,
  })
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, 502)
  }
  return c.json({ ok: true })
})

settingsRoutes.put("/settings/anysearch", (c) => upsertAnysearch(c))
settingsRoutes.patch("/settings/anysearch", (c) => upsertAnysearch(c))

settingsRoutes.delete("/settings/anysearch", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`anysearch-settings:${ip}`, 20, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const user = await db.select().from(users).get()
  if (!user) return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)

  await db
    .update(users)
    .set({
      anysearchApiKeyEncrypted: null,
      anysearchKeyLast4: null,
      updatedAt: nowIso(),
    })
    .where(eq(users.id, user.id))

  return c.json({ anysearch_configured: false, anysearch_last4: null })
})

async function upsertAnysearch(c: Context<AppEnv>) {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`anysearch-settings:${ip}`, 20, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = anysearchSettingsSchema.safeParse(body)
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

  if (!parsed.data.clearKey && !parsed.data.apiKey) {
    return c.json(
      { error: "请提供 apiKey 或 clearKey", code: "BAD_REQUEST" },
      400,
    )
  }

  const db = c.get("db")
  const user = await db.select().from(users).get()
  if (!user) return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)

  const encKey = c.env.AI_KEY_ENCRYPTION_KEY || c.env.PAT_ENCRYPTION_KEY
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: nowIso() }

  if (parsed.data.clearKey) {
    patch.anysearchApiKeyEncrypted = null
    patch.anysearchKeyLast4 = null
  } else if (parsed.data.apiKey) {
    patch.anysearchApiKeyEncrypted = await encryptSecret(
      parsed.data.apiKey,
      encKey,
    )
    patch.anysearchKeyLast4 = last4(parsed.data.apiKey)
  }

  await db.update(users).set(patch).where(eq(users.id, user.id))
  const updated = await db.select().from(users).get()

  return c.json({
    anysearch_configured: Boolean(updated?.anysearchApiKeyEncrypted),
    anysearch_last4: updated?.anysearchKeyLast4 ?? null,
  })
}

settingsRoutes.post("/settings/anysearch/test", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`anysearch-test:${ip}`, 10, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const apiKey = await getAnySearchKey(db, c.env)
  if (!apiKey) {
    return c.json(
      {
        ok: false,
        error: "尚未配置 AnySearch API Key",
        code: "NOT_CONFIGURED",
      },
      400,
    )
  }

  const result = await testAnySearchConnection(apiKey)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error, code: result.code }, 502)
  }
  return c.json({ ok: true })
})

settingsRoutes.put("/settings/github-pat", (c) => upsertGithubPat(c))
settingsRoutes.patch("/settings/github-pat", (c) => upsertGithubPat(c))

settingsRoutes.put("/settings/tracking", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = trackingSettingsSchema.safeParse(body)
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
  const user = await db.select().from(users).get()
  if (!user) return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)

  const hotWithinDays =
    parsed.data.hotWithinDays ?? user.hotWithinDays ?? DEFAULT_HOT_WITHIN_DAYS
  const staleAfterDays =
    parsed.data.staleAfterDays ??
    user.staleAfterDays ??
    DEFAULT_STALE_AFTER_DAYS

  if (hotWithinDays >= staleAfterDays) {
    return c.json(
      {
        error: "近期活跃天数须小于疑似停更天数",
        code: "VALIDATION_ERROR",
      },
      400,
    )
  }

  await db
    .update(users)
    .set({
      hotWithinDays,
      staleAfterDays,
      updatedAt: nowIso(),
    })
    .where(eq(users.id, user.id))

  // 本地重算 hot/active/stale（不调 GitHub）
  const rows = await db
    .select({
      id: bookmarks.id,
      healthStatus: bookmarks.healthStatus,
      pushedAt: bookmarks.pushedAt,
      syncStatus: bookmarks.syncStatus,
    })
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.sourceType, "github"),
        eq(bookmarks.syncStatus, "ok"),
        isNull(bookmarks.deletedAt),
      ),
    )

  const now = nowIso()
  for (const row of rows) {
    const current = row.healthStatus as HealthStatus
    if (
      current === "unavailable" ||
      current === "empty" ||
      current === "archived" ||
      current === "unknown"
    ) {
      continue
    }
    const next = recomputeActivityHealth(current, row.pushedAt, {
      hotWithinDays,
      staleAfterDays,
    })
    if (next !== current) {
      await db
        .update(bookmarks)
        .set({ healthStatus: next, updatedAt: now })
        .where(eq(bookmarks.id, row.id))
    }
  }

  return c.json({
    hot_within_days: hotWithinDays,
    stale_after_days: staleAfterDays,
  })
})

settingsRoutes.delete("/settings/github-pat", async (c) => {
  const db = c.get("db")
  const user = await db.select().from(users).get()
  if (!user) return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)
  await db
    .update(users)
    .set({ githubPatEncrypted: null, updatedAt: nowIso() })
    .where(eq(users.id, user.id))
  return c.json({ github_pat_configured: false })
})

async function upsertGithubPat(c: Context<AppEnv>) {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = githubPatSettingsSchema.safeParse(body)
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
  const user = await db.select().from(users).get()
  if (!user) return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)

  if (parsed.data.clear) {
    await db
      .update(users)
      .set({ githubPatEncrypted: null, updatedAt: nowIso() })
      .where(eq(users.id, user.id))
    return c.json({ github_pat_configured: false })
  }

  if (!parsed.data.pat) {
    return c.json({ error: "请提供 pat 或 clear", code: "BAD_REQUEST" }, 400)
  }

  const encrypted = await encryptSecret(
    parsed.data.pat,
    c.env.PAT_ENCRYPTION_KEY,
  )
  await db
    .update(users)
    .set({ githubPatEncrypted: encrypted, updatedAt: nowIso() })
    .where(eq(users.id, user.id))

  return c.json({ github_pat_configured: true })
}

settingsRoutes.post("/settings/password", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = changePasswordSchema.safeParse(body)
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
  const user = await db.select().from(users).get()
  if (!user) return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)

  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return c.json({ error: "当前密码不正确", code: "INVALID_PASSWORD" }, 401)
  }

  const passwordHash = await hashPassword(parsed.data.newPassword)
  await db
    .update(users)
    .set({ passwordHash, updatedAt: nowIso() })
    .where(eq(users.id, user.id))

  return c.json({ ok: true })
})

settingsRoutes.put("/settings/public-browsing", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = updatePublicBrowsingSchema.safeParse(body)
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
  const user = await db.select().from(users).get()
  if (!user) return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)

  await db
    .update(users)
    .set({
      publicBrowsingEnabled: parsed.data.enabled,
      updatedAt: nowIso(),
    })
    .where(eq(users.id, user.id))

  return c.json({ public_browsing_enabled: parsed.data.enabled })
})

/** 清空业务数据，保留 users 行 */
settingsRoutes.post("/settings/clear-data", async (c) => {
  const db = c.get("db")
  const userId = c.get("userId")
  if (!userId) {
    return c.json({ error: "未登录", code: "UNAUTHORIZED" }, 401)
  }

  await db.delete(bookmarkTags)
  await db.delete(updateEvents)
  await db.delete(aiJobs)
  await db.delete(aiUsageLogs)
  // 对话存档引用的是收藏内容，收藏清空后留着只会指向不存在的条目
  await db.delete(kbMessages)
  await db.delete(kbConversations)
  await db.delete(bookmarks)
  // 触发器已随 bookmarks 删除清理，这里兜底防孤儿行
  await db.run(sql`DELETE FROM bookmarks_fts`)
  await db.delete(tags)
  await db.delete(folders)
  await db.delete(sessions).where(eq(sessions.userId, userId))

  return c.json({ ok: true })
})
