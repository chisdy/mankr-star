import {
  aiUsageLogs,
  bookmarkTags,
  bookmarks,
  folders,
  tags,
  updateEvents,
} from "@mankr/db"
import {
  AI_STATUSES,
  DEEPSEEK_PRICE_USD_PER_1M,
  DEFAULT_INSIGHTS_RANGE,
  HEALTH_STATUS_LABELS,
  isCloudflareConfigured,
  type DeepSeekModel,
  type InsightsRange,
  insightsQuerySchema,
} from "@mankr/shared"
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { fetchCloudflareFreeQuota } from "../lib/cloudflare-analytics"
import { decryptSecret } from "../lib/crypto"
import { rateLimit } from "../lib/rate-limit"
import { readSetting } from "../lib/settings-store"
import { getClientIp } from "../lib/utils"
import { requireAuth } from "../middleware/auth"

export const insightsRoutes = new Hono<AppEnv>()

insightsRoutes.use("/insights", requireAuth)
insightsRoutes.use("/insights/*", requireAuth)

function rangeStartIso(range: InsightsRange): string | null {
  if (range === "all") return null
  const days = range === "7d" ? 7 : 30
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

function estimateCostUsd(
  byModel: Array<{
    model: string
    prompt_tokens: number
    completion_tokens: number
  }>,
): number | null {
  let total = 0
  let known = false
  for (const row of byModel) {
    const prices = DEEPSEEK_PRICE_USD_PER_1M[row.model as DeepSeekModel]
    if (!prices) continue
    known = true
    total +=
      (row.prompt_tokens / 1_000_000) * prices.input +
      (row.completion_tokens / 1_000_000) * prices.output
  }
  return known ? Math.round(total * 1_000_000) / 1_000_000 : null
}

insightsRoutes.get("/insights", async (c) => {
  const db = c.get("db")
  const parsed = insightsQuerySchema.safeParse(c.req.query())
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

  const range = parsed.data.range ?? DEFAULT_INSIGHTS_RANGE
  const since = rangeStartIso(range)
  const active = isNull(bookmarks.deletedAt)

  // --- library snapshot ---
  const [{ total }] = await db
    .select({ total: count() })
    .from(bookmarks)
    .where(active)

  const addedWhere = since
    ? and(active, gte(bookmarks.createdAt, since))
    : active
  const [{ added_in_range }] = await db
    .select({ added_in_range: count() })
    .from(bookmarks)
    .where(addedWhere)

  const [{ folders: folderCount }] = await db
    .select({ folders: count() })
    .from(folders)

  const [{ tags: tagCount }] = await db.select({ tags: count() }).from(tags)

  const aiStatusRows = await db
    .select({
      status: bookmarks.aiStatus,
      count: count(),
    })
    .from(bookmarks)
    .where(active)
    .groupBy(bookmarks.aiStatus)

  const ai_status: Record<string, number> = Object.fromEntries(
    AI_STATUSES.map((s) => [s, 0]),
  )
  for (const row of aiStatusRows) {
    ai_status[row.status] = Number(row.count)
  }

  // --- composition ---
  const languageRows = await db
    .select({
      language: bookmarks.language,
      count: count(),
    })
    .from(bookmarks)
    .where(active)
    .groupBy(bookmarks.language)
    .orderBy(desc(count()))
    .limit(12)

  const languages = languageRows.map((r) => ({
    name: r.language?.trim() || "未知",
    count: Number(r.count),
  }))

  const healthRows = await db
    .select({
      status: bookmarks.healthStatus,
      count: count(),
    })
    .from(bookmarks)
    .where(active)
    .groupBy(bookmarks.healthStatus)

  const health = healthRows
    .map((r) => ({
      status: r.status,
      label:
        HEALTH_STATUS_LABELS[
          r.status as keyof typeof HEALTH_STATUS_LABELS
        ] ?? r.status,
      count: Number(r.count),
    }))
    .sort((a, b) => b.count - a.count)

  const folderRows = await db
    .select({
      folder_id: bookmarks.folderId,
      count: count(),
    })
    .from(bookmarks)
    .where(active)
    .groupBy(bookmarks.folderId)
    .orderBy(desc(count()))
    .limit(10)

  const folderIds = folderRows
    .map((r) => r.folder_id)
    .filter((id): id is string => !!id)

  const folderNameMap = new Map<string, string>()
  if (folderIds.length > 0) {
    const folderNameRows = await db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(inArray(folders.id, folderIds))
    for (const f of folderNameRows) folderNameMap.set(f.id, f.name)
  }

  const compositionFolders = folderRows.map((r) => ({
    folder_id: r.folder_id,
    name: r.folder_id ? (folderNameMap.get(r.folder_id) ?? "未知文件夹") : "未分类",
    count: Number(r.count),
  }))

  const sourceRows = await db
    .select({
      source_type: bookmarks.sourceType,
      count: count(),
    })
    .from(bookmarks)
    .where(active)
    .groupBy(bookmarks.sourceType)

  const sources = sourceRows.map((r) => ({
    source_type: r.source_type,
    count: Number(r.count),
  }))

  // --- engagement ---
  const topClicked = await db
    .select({
      id: bookmarks.id,
      title: bookmarks.title,
      external_id: bookmarks.externalId,
      click_count: bookmarks.clickCount,
    })
    .from(bookmarks)
    .where(and(active, sql`${bookmarks.clickCount} > 0`))
    .orderBy(desc(bookmarks.clickCount), asc(bookmarks.title))
    .limit(10)

  const usageCount = count(bookmarkTags.bookmarkId).as("usage_count")
  const topTagRows = await db
    .select({
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
      usage_count: usageCount,
    })
    .from(tags)
    .leftJoin(bookmarkTags, eq(tags.id, bookmarkTags.tagId))
    .groupBy(tags.id)
    .orderBy(desc(usageCount), asc(tags.name))
    .limit(10)

  // --- tracking ---
  const [{ tracked }] = await db
    .select({ tracked: count() })
    .from(bookmarks)
    .where(and(active, eq(bookmarks.trackUpdates, true)))

  const [{ untracked }] = await db
    .select({ untracked: count() })
    .from(bookmarks)
    .where(and(active, eq(bookmarks.trackUpdates, false)))

  const eventWhere = since
    ? gte(updateEvents.detectedAt, since)
    : undefined
  const eventRows = await db
    .select({
      event_type: updateEvents.eventType,
      count: count(),
    })
    .from(updateEvents)
    .where(eventWhere)
    .groupBy(updateEvents.eventType)

  const events_by_type = eventRows.map((r) => ({
    event_type: r.event_type,
    count: Number(r.count),
  }))

  const syncIssueRows = await db
    .select({
      status: bookmarks.syncStatus,
      count: count(),
    })
    .from(bookmarks)
    .where(
      and(
        active,
        inArray(bookmarks.syncStatus, ["error", "not_found", "forbidden"]),
      ),
    )
    .groupBy(bookmarks.syncStatus)

  const sync_issues: Record<string, number> = {
    error: 0,
    not_found: 0,
    forbidden: 0,
  }
  for (const row of syncIssueRows) {
    sync_issues[row.status] = Number(row.count)
  }

  // --- AI usage (range-scoped) ---
  const aiWhere = since ? gte(aiUsageLogs.createdAt, since) : undefined

  const aiAgg = await db
    .select({
      calls: count(),
      ok: sql<number>`sum(case when ${aiUsageLogs.status} = 'ok' then 1 else 0 end)`,
      error: sql<number>`sum(case when ${aiUsageLogs.status} = 'error' then 1 else 0 end)`,
      prompt: sql<number>`coalesce(sum(${aiUsageLogs.promptTokens}), 0)`,
      completion: sql<number>`coalesce(sum(${aiUsageLogs.completionTokens}), 0)`,
      total_tokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
    })
    .from(aiUsageLogs)
    .where(aiWhere)
    .get()

  const byModelRows = await db
    .select({
      model: aiUsageLogs.model,
      calls: count(),
      prompt_tokens: sql<number>`coalesce(sum(${aiUsageLogs.promptTokens}), 0)`,
      completion_tokens: sql<number>`coalesce(sum(${aiUsageLogs.completionTokens}), 0)`,
      total_tokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
    })
    .from(aiUsageLogs)
    .where(aiWhere)
    .groupBy(aiUsageLogs.model)
    .orderBy(desc(count()))

  const byKindRows = await db
    .select({
      kind: aiUsageLogs.kind,
      calls: count(),
      total_tokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
    })
    .from(aiUsageLogs)
    .where(aiWhere)
    .groupBy(aiUsageLogs.kind)
    .orderBy(desc(count()))

  const dailyRows = await db
    .select({
      date: sql<string>`substr(${aiUsageLogs.createdAt}, 1, 10)`,
      calls: count(),
      tokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
    })
    .from(aiUsageLogs)
    .where(aiWhere)
    .groupBy(sql`substr(${aiUsageLogs.createdAt}, 1, 10)`)
    .orderBy(asc(sql`substr(${aiUsageLogs.createdAt}, 1, 10)`))

  const by_model = byModelRows.map((r) => ({
    model: r.model,
    calls: Number(r.calls),
    prompt_tokens: Number(r.prompt_tokens),
    completion_tokens: Number(r.completion_tokens),
    total_tokens: Number(r.total_tokens),
  }))

  return c.json({
    range,
    library: {
      total: Number(total),
      added_in_range: Number(added_in_range),
      folders: Number(folderCount),
      tags: Number(tagCount),
      ai_status,
    },
    composition: {
      languages,
      health,
      folders: compositionFolders,
      sources,
    },
    engagement: {
      top_clicked: topClicked.map((r) => ({
        id: r.id,
        title: r.title,
        external_id: r.external_id,
        click_count: r.click_count,
      })),
      top_tags: topTagRows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        usage_count: Number(r.usage_count),
      })),
    },
    tracking: {
      tracked: Number(tracked),
      untracked: Number(untracked),
      events_by_type,
      sync_issues,
    },
    ai: {
      calls: Number(aiAgg?.calls ?? 0),
      ok: Number(aiAgg?.ok ?? 0),
      error: Number(aiAgg?.error ?? 0),
      tokens: {
        prompt: Number(aiAgg?.prompt ?? 0),
        completion: Number(aiAgg?.completion ?? 0),
        total: Number(aiAgg?.total_tokens ?? 0),
      },
      by_model,
      by_kind: byKindRows.map((r) => ({
        kind: r.kind,
        calls: Number(r.calls),
        total_tokens: Number(r.total_tokens),
      })),
      daily: dailyRows.map((r) => ({
        date: r.date,
        calls: Number(r.calls),
        tokens: Number(r.tokens),
      })),
      estimated_cost_usd: estimateCostUsd(by_model),
    },
  })
})

insightsRoutes.get("/insights/cloudflare-quota", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`cloudflare-quota:${ip}`, 30, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  const db = c.get("db")
  const cloudflare = await readSetting(db, "cloudflare")
  if (!isCloudflareConfigured(cloudflare)) {
    return c.json({ configured: false as const })
  }

  const encKey = c.env.AI_KEY_ENCRYPTION_KEY || c.env.PAT_ENCRYPTION_KEY
  let apiToken: string
  try {
    apiToken = await decryptSecret(cloudflare.apiTokenEncrypted!, encKey)
  } catch {
    return c.json(
      { error: "解密 Token 失败", code: "DECRYPT_FAILED" },
      500,
    )
  }

  const forceRefresh = c.req.query("refresh") === "1"
  const result = await fetchCloudflareFreeQuota({
    accountId: cloudflare.accountId,
    apiToken,
    forceRefresh,
  })

  if (result.ok) {
    return c.json(result.payload)
  }

  // 有陈旧缓存时降级返回，仍标记 stale
  if (result.stale) {
    return c.json(result.stale)
  }

  return c.json(
    {
      error: result.error || "拉取 Cloudflare 用量失败",
      code:
        result.status === 401
          ? "CLOUDFLARE_UNAUTHORIZED"
          : "CLOUDFLARE_QUOTA_FAILED",
    },
    502,
  )
})
