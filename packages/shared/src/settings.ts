import { z } from "zod"
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_HOT_WITHIN_DAYS,
  DEFAULT_STALE_AFTER_DAYS,
  MAX_TRACKING_DAYS,
  MIN_TRACKING_DAYS,
} from "./constants"

/** 收藏列表分页方式：滚动自动追加 / 点击追加 / 传统分页器 */
export const BOOKMARK_PAGINATION_MODES = [
  "auto",
  "manual",
  "pagination",
] as const
export type BookmarkPaginationMode = (typeof BOOKMARK_PAGINATION_MODES)[number]

export const DEFAULT_BOOKMARK_PAGINATION_MODE: BookmarkPaginationMode = "auto"
export const DEFAULT_BOOKMARK_PAGE_SIZE = 20
export const MIN_BOOKMARK_PAGE_SIZE = 1
export const MAX_BOOKMARK_PAGE_SIZE = 100

/** settings 表的领域键；一行一个领域，value 为该领域的 JSON 对象 */
export const SETTING_KEYS = [
  "ai",
  "search",
  "github",
  "tracking",
  "browsing",
  "bookmarks",
] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

/**
 * 领域内逐字段降级。
 *
 * 用 .catch() 而不是让整个对象解析失败：同一领域里密钥和普通偏好放在一起，
 * 若某个偏好字段损坏就整体回退默认值，密文会被判成"未配置"，
 * 用户下一次保存又会把 null 合并写回，等于永久丢钥匙。
 */
const encryptedSecret = z.string().nullable().catch(null)

export const aiSettingsValueSchema = z.object({
  deepseekApiKeyEncrypted: encryptedSecret.default(null),
  deepseekKeyLast4: z.string().nullable().catch(null).default(null),
  deepseekModel: z
    .string()
    .min(1)
    .catch(DEFAULT_DEEPSEEK_MODEL)
    .default(DEFAULT_DEEPSEEK_MODEL),
})
export type AiSettingsValue = z.infer<typeof aiSettingsValueSchema>

export const searchSettingsValueSchema = z.object({
  anysearchApiKeyEncrypted: encryptedSecret.default(null),
  anysearchKeyLast4: z.string().nullable().catch(null).default(null),
})
export type SearchSettingsValue = z.infer<typeof searchSettingsValueSchema>

export const githubSettingsValueSchema = z.object({
  patEncrypted: encryptedSecret.default(null),
})
export type GithubSettingsValue = z.infer<typeof githubSettingsValueSchema>

/**
 * 事件订阅开关。默认全开，损坏时也回到开：漏记一条动态无法补录，
 * 而多记一条只是噪音。
 */
const eventSubscription = z.boolean().catch(true).default(true)

export const trackingSettingsValueSchema = z.object({
  hotWithinDays: z
    .number()
    .int()
    .min(MIN_TRACKING_DAYS)
    .max(MAX_TRACKING_DAYS)
    .catch(DEFAULT_HOT_WITHIN_DAYS)
    .default(DEFAULT_HOT_WITHIN_DAYS),
  staleAfterDays: z
    .number()
    .int()
    .min(MIN_TRACKING_DAYS)
    .max(MAX_TRACKING_DAYS)
    .catch(DEFAULT_STALE_AFTER_DAYS)
    .default(DEFAULT_STALE_AFTER_DAYS),
  eventPush: eventSubscription,
  eventRelease: eventSubscription,
  eventStarsDelta: eventSubscription,
  eventMetaChange: eventSubscription,
})
export type TrackingSettingsValue = z.infer<typeof trackingSettingsValueSchema>

export const browsingSettingsValueSchema = z.object({
  publicBrowsingEnabled: z.boolean().catch(false).default(false),
})
export type BrowsingSettingsValue = z.infer<typeof browsingSettingsValueSchema>

export const bookmarksSettingsValueSchema = z.object({
  paginationMode: z
    .enum(BOOKMARK_PAGINATION_MODES)
    .catch(DEFAULT_BOOKMARK_PAGINATION_MODE)
    .default(DEFAULT_BOOKMARK_PAGINATION_MODE),
  pageSize: z
    .number()
    .int()
    .min(MIN_BOOKMARK_PAGE_SIZE)
    .max(MAX_BOOKMARK_PAGE_SIZE)
    .catch(DEFAULT_BOOKMARK_PAGE_SIZE)
    .default(DEFAULT_BOOKMARK_PAGE_SIZE),
})
export type BookmarksSettingsValue = z.infer<typeof bookmarksSettingsValueSchema>

export const SETTINGS_SCHEMAS = {
  ai: aiSettingsValueSchema,
  search: searchSettingsValueSchema,
  github: githubSettingsValueSchema,
  tracking: trackingSettingsValueSchema,
  browsing: browsingSettingsValueSchema,
  bookmarks: bookmarksSettingsValueSchema,
} as const

export type SettingsValueMap = {
  ai: AiSettingsValue
  search: SearchSettingsValue
  github: GithubSettingsValue
  tracking: TrackingSettingsValue
  browsing: BrowsingSettingsValue
  bookmarks: BookmarksSettingsValue
}

export function defaultSettingValue<K extends SettingKey>(
  key: K,
): SettingsValueMap[K] {
  return SETTINGS_SCHEMAS[key].parse({}) as SettingsValueMap[K]
}

/**
 * 单个领域的容错解析：结构损坏时只把该领域回退到默认值，
 * 不抛出、也不把原始内容带回调用方。
 */
export function parseSettingValue<K extends SettingKey>(
  key: K,
  raw: unknown,
): SettingsValueMap[K] {
  const parsed = SETTINGS_SCHEMAS[key].safeParse(raw)
  if (parsed.success) return parsed.data as SettingsValueMap[K]
  return defaultSettingValue(key)
}

/** 直接解析数据库里的 JSON 文本；非法 JSON 同样回退默认值 */
export function parseSettingJson<K extends SettingKey>(
  key: K,
  text: string | null | undefined,
): SettingsValueMap[K] {
  if (!text) return defaultSettingValue(key)
  try {
    return parseSettingValue(key, JSON.parse(text))
  } catch {
    return defaultSettingValue(key)
  }
}

/** 收藏分页设置的写入契约：允许只改其中一项 */
export const bookmarkPaginationSettingsSchema = z
  .object({
    paginationMode: z.enum(BOOKMARK_PAGINATION_MODES).optional(),
    pageSize: z.coerce
      .number()
      .int()
      .min(MIN_BOOKMARK_PAGE_SIZE)
      .max(MAX_BOOKMARK_PAGE_SIZE)
      .optional(),
  })
  .refine(
    (data) => data.paginationMode !== undefined || data.pageSize !== undefined,
    { message: "请提供 paginationMode 或 pageSize" },
  )
export type BookmarkPaginationSettingsInput = z.infer<
  typeof bookmarkPaginationSettingsSchema
>
