import {
  aiJobs,
  aiUsageLogs,
  apiTokens,
  bookmarkEmbeddings,
  bookmarkTags,
  bookmarks,
  folders,
  githubImportJobs,
  kbConversations,
  kbMessages,
  sessions,
  tags,
  updateEvents,
  users,
} from "@mankr/db"
import {
  DEFAULT_DEEPSEEK_MODEL,
  anysearchSettingsSchema,
  bookmarkPaginationSettingsSchema,
  changePasswordSchema,
  cloudflareSettingsSchema,
  embeddingSettingsSchema,
  deepseekSettingsSchema,
  githubPatSettingsSchema,
  isCloudflareConfigured,
  recomputeActivityHealth,
  trackingSettingsSchema,
  updateAnalyticsSettingsSchema,
  updatePublicBrowsingSchema,
  type HealthStatus,
} from "@mankr/shared"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import type { Context } from "hono"
import type { AppEnv } from "../env"
import { getAnySearchKey, testAnySearchConnection } from "../lib/anysearch"
import { testCloudflareAnalyticsAccess, clearCloudflareQuotaCache } from "../lib/cloudflare-analytics"
import { decryptSecret, encryptSecret, last4 } from "../lib/crypto"
import { recordAiUsage } from "../lib/ai-usage"
import { testDeepSeekConnection } from "../lib/deepseek"
import { hashPassword, verifyPassword } from "../lib/password"
import { rateLimit } from "../lib/rate-limit"
import { readSetting, writeSetting } from "../lib/settings-store"
import { getClientIp, nowIso } from "../lib/utils"
import { requireAuthWrite } from "../middleware/auth"

export const settingsRoutes = new Hono<AppEnv>()

/** Settings 全是写操作；read-only Bearer 禁止 */
settingsRoutes.use("/settings", requireAuthWrite)
settingsRoutes.use("/settings/*", requireAuthWrite)

settingsRoutes.put("/settings/deepseek", (c) => upsertDeepseek(c))
settingsRoutes.patch("/settings/deepseek", (c) => upsertDeepseek(c))

settingsRoutes.delete("/settings/deepseek", async (c) => {
  const db = c.get("db")
  const ai = await writeSetting(db, "ai", {
    deepseekApiKeyEncrypted: null,
    deepseekKeyLast4: null,
  })

  return c.json({
    deepseek_configured: false,
    deepseek_last4: null,
    deepseek_model: ai.deepseekModel || DEFAULT_DEEPSEEK_MODEL,
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
  const encKey = c.env.AI_KEY_ENCRYPTION_KEY || c.env.PAT_ENCRYPTION_KEY

  // 只传 model 时不带 key 字段，避免把已保存的密钥合并掉
  const patch: {
    deepseekApiKeyEncrypted?: string | null
    deepseekKeyLast4?: string | null
    deepseekModel?: string
  } = {}

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

  const ai = await writeSetting(db, "ai", patch)

  return c.json({
    deepseek_configured: Boolean(ai.deepseekApiKeyEncrypted),
    deepseek_last4: ai.deepseekKeyLast4,
    deepseek_model: ai.deepseekModel || DEFAULT_DEEPSEEK_MODEL,
  })
}

settingsRoutes.post("/settings/deepseek/test", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`deepseek-test:${ip}`, 10, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const ai = await readSetting(db, "ai")
  if (!ai.deepseekApiKeyEncrypted) {
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
    apiKey = await decryptSecret(ai.deepseekApiKeyEncrypted, encKey)
  } catch {
    return c.json({ ok: false, error: "解密 Key 失败" }, 500)
  }

  const result = await testDeepSeekConnection(
    apiKey,
    ai.deepseekModel || DEFAULT_DEEPSEEK_MODEL,
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

settingsRoutes.put("/settings/embedding", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`embedding-settings:${ip}`, 20, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = embeddingSettingsSchema.safeParse(body)
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
  const encKey = c.env.AI_KEY_ENCRYPTION_KEY || c.env.PAT_ENCRYPTION_KEY
  const patch: {
    embeddingBaseUrl?: string
    embeddingModel?: string
    embeddingApiKeyEncrypted?: string | null
    embeddingKeyLast4?: string | null
    embeddingReuseAiKey?: boolean
  } = {}

  if (parsed.data.baseUrl !== undefined) {
    patch.embeddingBaseUrl = parsed.data.baseUrl.replace(/\/+$/, "")
  }
  if (parsed.data.model !== undefined) {
    patch.embeddingModel = parsed.data.model
  }
  if (parsed.data.reuseAiKey !== undefined) {
    patch.embeddingReuseAiKey = parsed.data.reuseAiKey
  }
  if (parsed.data.clearKey) {
    patch.embeddingApiKeyEncrypted = null
    patch.embeddingKeyLast4 = null
  } else if (parsed.data.apiKey) {
    patch.embeddingApiKeyEncrypted = await encryptSecret(
      parsed.data.apiKey,
      encKey,
    )
    patch.embeddingKeyLast4 = last4(parsed.data.apiKey)
  }

  const ai = await writeSetting(db, "ai", patch)
  const { isEmbeddingConfigured } = await import("../lib/embeddings")
  return c.json({
    embedding_configured: isEmbeddingConfigured(ai),
    embedding_base_url: ai.embeddingBaseUrl.trim() || null,
    embedding_model: ai.embeddingModel,
    embedding_last4: ai.embeddingKeyLast4,
    embedding_reuse_ai_key: ai.embeddingReuseAiKey,
  })
})

settingsRoutes.post("/settings/embedding/test", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`embedding-test:${ip}`, 10, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const {
    resolveEmbeddingCredentials,
    testEmbeddingConnection,
  } = await import("../lib/embeddings")
  const creds = await resolveEmbeddingCredentials(db, c.env)
  if (!creds) {
    return c.json(
      {
        ok: false,
        error: "尚未配置 Embedding（baseUrl + Key）",
        code: "NOT_CONFIGURED",
      },
      400,
    )
  }
  const result = await testEmbeddingConnection(creds)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, 502)
  }
  return c.json({ ok: true, dims: result.dims })
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
  await writeSetting(db, "search", {
    anysearchApiKeyEncrypted: null,
    anysearchKeyLast4: null,
  })

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
  const encKey = c.env.AI_KEY_ENCRYPTION_KEY || c.env.PAT_ENCRYPTION_KEY

  const patch: {
    anysearchApiKeyEncrypted?: string | null
    anysearchKeyLast4?: string | null
  } = {}

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

  const search = await writeSetting(db, "search", patch)

  return c.json({
    anysearch_configured: Boolean(search.anysearchApiKeyEncrypted),
    anysearch_last4: search.anysearchKeyLast4,
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

settingsRoutes.put("/settings/cloudflare", (c) => upsertCloudflare(c))
settingsRoutes.patch("/settings/cloudflare", (c) => upsertCloudflare(c))

settingsRoutes.delete("/settings/cloudflare", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`cloudflare-settings:${ip}`, 20, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const previous = await readSetting(db, "cloudflare")
  await writeSetting(db, "cloudflare", {
    accountId: "",
    apiTokenEncrypted: null,
    apiTokenLast4: null,
  })
  clearCloudflareQuotaCache(previous.accountId)

  return c.json({
    cloudflare_configured: false,
    cloudflare_account_id: null,
    cloudflare_token_last4: null,
  })
})

async function upsertCloudflare(c: Context<AppEnv>) {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`cloudflare-settings:${ip}`, 20, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = cloudflareSettingsSchema.safeParse(body)
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
  const previous = await readSetting(db, "cloudflare")
  const encKey = c.env.AI_KEY_ENCRYPTION_KEY || c.env.PAT_ENCRYPTION_KEY

  const patch: {
    accountId?: string
    apiTokenEncrypted?: string | null
    apiTokenLast4?: string | null
  } = {}

  if (parsed.data.accountId !== undefined) {
    patch.accountId = parsed.data.accountId.trim()
  }

  if (parsed.data.clearToken) {
    patch.apiTokenEncrypted = null
    patch.apiTokenLast4 = null
  } else if (parsed.data.apiToken) {
    patch.apiTokenEncrypted = await encryptSecret(parsed.data.apiToken, encKey)
    patch.apiTokenLast4 = last4(parsed.data.apiToken)
  }

  const cloudflare = await writeSetting(db, "cloudflare", patch)
  clearCloudflareQuotaCache(previous.accountId)
  clearCloudflareQuotaCache(cloudflare.accountId)

  return c.json({
    cloudflare_configured: isCloudflareConfigured(cloudflare),
    cloudflare_account_id: cloudflare.accountId.trim() || null,
    cloudflare_token_last4: cloudflare.apiTokenLast4,
  })
}

settingsRoutes.post("/settings/cloudflare/test", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`cloudflare-test:${ip}`, 10, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const cloudflare = await readSetting(db, "cloudflare")
  if (!isCloudflareConfigured(cloudflare)) {
    return c.json(
      {
        ok: false,
        error: "尚未配置 Cloudflare Account ID 与 API Token",
        code: "NOT_CONFIGURED",
      },
      400,
    )
  }

  const encKey = c.env.AI_KEY_ENCRYPTION_KEY || c.env.PAT_ENCRYPTION_KEY
  let apiToken: string
  try {
    apiToken = await decryptSecret(cloudflare.apiTokenEncrypted!, encKey)
  } catch {
    return c.json({ ok: false, error: "解密 Token 失败" }, 500)
  }

  const result = await testCloudflareAnalyticsAccess(
    cloudflare.accountId,
    apiToken,
  )
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, 502)
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
  const current = await readSetting(db, "tracking")

  const hotWithinDays = parsed.data.hotWithinDays ?? current.hotWithinDays
  const staleAfterDays = parsed.data.staleAfterDays ?? current.staleAfterDays

  if (hotWithinDays >= staleAfterDays) {
    return c.json(
      {
        error: "近期活跃天数须小于疑似停更天数",
        code: "VALIDATION_ERROR",
      },
      400,
    )
  }

  const saved = await writeSetting(db, "tracking", {
    hotWithinDays,
    staleAfterDays,
    eventPush: parsed.data.eventPush,
    eventRelease: parsed.data.eventRelease,
    eventStarsDelta: parsed.data.eventStarsDelta,
    eventMetaChange: parsed.data.eventMetaChange,
  })

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
    hot_within_days: saved.hotWithinDays,
    stale_after_days: saved.staleAfterDays,
    event_push: saved.eventPush,
    event_release: saved.eventRelease,
    event_stars_delta: saved.eventStarsDelta,
    event_meta_change: saved.eventMetaChange,
  })
})

settingsRoutes.delete("/settings/github-pat", async (c) => {
  const db = c.get("db")
  await writeSetting(db, "github", { patEncrypted: null })
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

  if (parsed.data.clear) {
    await writeSetting(db, "github", { patEncrypted: null })
    return c.json({ github_pat_configured: false })
  }

  if (!parsed.data.pat) {
    return c.json({ error: "请提供 pat 或 clear", code: "BAD_REQUEST" }, 400)
  }

  const encrypted = await encryptSecret(
    parsed.data.pat,
    c.env.PAT_ENCRYPTION_KEY,
  )
  await writeSetting(db, "github", { patEncrypted: encrypted })

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
  await writeSetting(db, "browsing", {
    publicBrowsingEnabled: parsed.data.enabled,
  })

  return c.json({ public_browsing_enabled: parsed.data.enabled })
})

/** 实例级 Google Analytics Measurement ID；公开下发到 /auth/status */
settingsRoutes.put("/settings/analytics", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = updateAnalyticsSettingsSchema.safeParse(body)
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
  const saved = await writeSetting(db, "analytics", {
    measurementId: parsed.data.measurement_id,
  })

  return c.json({
    google_analytics_measurement_id: saved.measurementId,
  })
})

/** 实例级收藏分页方式与每页数量；登录用户与公开访客共用同一值 */
settingsRoutes.put("/settings/bookmark-pagination", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = bookmarkPaginationSettingsSchema.safeParse(body)
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
  const next = await writeSetting(db, "bookmarks", {
    paginationMode: parsed.data.paginationMode,
    pageSize: parsed.data.pageSize,
  })

  return c.json({
    bookmark_pagination_mode: next.paginationMode,
    bookmark_page_size: next.pageSize,
  })
})

/** 清空业务数据，保留 users 行与实例设置 */
settingsRoutes.post("/settings/clear-data", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`clear-data:${ip}`, 3, 300_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const userId = c.get("userId")
  if (!userId) {
    return c.json({ error: "未登录", code: "UNAUTHORIZED" }, 401)
  }

  // D1 batch：多次删除一次提交，避免中途失败留下半清空状态
  await db.batch([
    db.delete(bookmarkTags),
    db.delete(bookmarkEmbeddings),
    db.delete(updateEvents),
    db.delete(aiJobs),
    db.delete(aiUsageLogs),
    db.delete(githubImportJobs),
    // 对话存档引用的是收藏内容，收藏清空后留着只会指向不存在的条目
    db.delete(kbMessages),
    db.delete(kbConversations),
    db.delete(bookmarks),
    db.delete(tags),
    db.delete(folders),
    db.delete(sessions).where(eq(sessions.userId, userId)),
    db.delete(apiTokens),
  ])
  // 触发器已随 bookmarks 删除清理，这里兜底防孤儿行（FTS 不在 drizzle schema 内）
  await db.run(sql`DELETE FROM bookmarks_fts`)

  return c.json({ ok: true })
})

