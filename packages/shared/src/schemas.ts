import { z } from "zod"
import {
  AI_STATUSES,
  AI_SUMMARY_MAX_CHARS,
  BOOKMARK_SORT_OPTIONS,
  DEEPSEEK_MODELS,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_HOT_WITHIN_DAYS,
  DEFAULT_INSIGHTS_RANGE,
  DEFAULT_STALE_AFTER_DAYS,
  HEALTH_STATUSES,
  INSIGHTS_RANGES,
  MAX_TRACKING_DAYS,
  MIN_TRACKING_DAYS,
  PASSWORD_MIN_LENGTH,
  SOURCE_TYPES,
  SYNC_STATUSES,
  UPDATE_EVENT_TYPES,
} from "./constants"

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)

export const registerSchema = z.object({
  email: z.email("请输入有效邮箱"),
  username: z
    .string()
    .min(2, "用户名至少 2 位")
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, "用户名仅允许字母数字下划线与连字符")
    .optional(),
  password: passwordSchema,
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  /** 用户名或邮箱（字段名统一为 username） */
  username: z.string().min(1, "请输入用户名或邮箱"),
  password: z.string().min(1, "请输入密码"),
})
export type LoginInput = z.infer<typeof loginSchema>

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
})
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const createBookmarkSchema = z.object({
  url: z.string().min(1, "请输入 GitHub URL 或 owner/repo"),
  notes: z.string().max(10000).optional(),
  folderId: z.string().uuid().optional().nullable(),
  trackUpdates: z.boolean().optional().default(true),
})
export type CreateBookmarkInput = z.infer<typeof createBookmarkSchema>

export const updateBookmarkSchema = z.object({
  notes: z.string().max(10000).optional().nullable(),
  folderId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500).optional(),
  summaryAi: z.string().max(AI_SUMMARY_MAX_CHARS).optional().nullable(),
  trackUpdates: z.boolean().optional(),
  archived: z.boolean().optional(),
  tagNames: z.array(z.string().min(1).max(64)).max(20).optional(),
})
export type UpdateBookmarkInput = z.infer<typeof updateBookmarkSchema>

export const listBookmarksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  folderId: z.string().uuid().optional(),
  tag: z.string().optional(),
  language: z.string().optional(),
  owner: z.string().optional(),
  healthStatus: z.enum(HEALTH_STATUSES).optional(),
  archived: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => {
      if (v === undefined) return false
      return v === "true" || v === "1"
    }),
  includeArchived: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
  q: z.string().optional(),
  sort: z.enum(BOOKMARK_SORT_OPTIONS).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
})
export type ListBookmarksQuery = z.infer<typeof listBookmarksQuerySchema>

export const createFolderSchema = z.object({
  name: z.string().min(1).max(64),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "slug 仅允许小写英文字母、数字与连字符（kebab-case）",
    )
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  description: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().optional(),
  /** 父文件夹 id；省略或 null 表示根级 */
  parentId: z.string().uuid().optional().nullable(),
})
export type CreateFolderInput = z.infer<typeof createFolderSchema>

export const updateFolderSchema = createFolderSchema.partial()
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>

export const suggestFolderSlugSchema = z.object({
  name: z.string().min(1).max(64),
  parentId: z.string().uuid().optional().nullable(),
  excludeId: z.string().uuid().optional().nullable(),
})
export type SuggestFolderSlugInput = z.infer<typeof suggestFolderSlugSchema>

/** 删除文件夹时对所属收藏的处置 */
export const deleteFolderSchema = z
  .object({
    /** detach=取消归属（默认）；delete=软删除收藏；move=迁移到其他文件夹 */
    bookmarkAction: z.enum(["detach", "delete", "move"]).default("detach"),
    moveToFolderId: z.string().uuid().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.bookmarkAction === "move" && !data.moveToFolderId) {
      ctx.addIssue({
        code: "custom",
        message: "迁移目标文件夹必填",
        path: ["moveToFolderId"],
      })
    }
  })
export type DeleteFolderInput = z.infer<typeof deleteFolderSchema>

/** @deprecated 使用 createFolderSchema */
export const createCategorySchema = createFolderSchema
/** @deprecated 使用 CreateFolderInput */
export type CreateCategoryInput = CreateFolderInput
/** @deprecated 使用 updateFolderSchema */
export const updateCategorySchema = updateFolderSchema
/** @deprecated 使用 UpdateFolderInput */
export type UpdateCategoryInput = UpdateFolderInput

export const feedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  eventType: z.enum(UPDATE_EVENT_TYPES).optional(),
  bookmarkId: z.string().uuid().optional(),
})
export type FeedQuery = z.infer<typeof feedQuerySchema>

export const deepseekSettingsSchema = z.object({
  apiKey: z.string().min(1).optional(),
  model: z.enum(DEEPSEEK_MODELS).optional(),
  clearKey: z.boolean().optional(),
})
export type DeepseekSettingsInput = z.infer<typeof deepseekSettingsSchema>

export const githubPatSettingsSchema = z.object({
  pat: z.string().min(1).optional(),
  clear: z.boolean().optional(),
})
export type GithubPatSettingsInput = z.infer<typeof githubPatSettingsSchema>

export const trackingSettingsSchema = z
  .object({
    hotWithinDays: z.coerce
      .number()
      .int()
      .min(MIN_TRACKING_DAYS)
      .max(MAX_TRACKING_DAYS)
      .optional(),
    staleAfterDays: z.coerce
      .number()
      .int()
      .min(MIN_TRACKING_DAYS)
      .max(MAX_TRACKING_DAYS)
      .optional(),
  })
  .superRefine((data, ctx) => {
    const hot = data.hotWithinDays ?? DEFAULT_HOT_WITHIN_DAYS
    const stale = data.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS
    if (hot >= stale) {
      ctx.addIssue({
        code: "custom",
        message: "近期活跃天数须小于疑似停更天数",
        path: ["hotWithinDays"],
      })
    }
  })
export type TrackingSettingsInput = z.infer<typeof trackingSettingsSchema>

export const importGithubSchema = z.object({
  page: z.number().int().min(1).default(1).optional(),
  perPage: z.number().int().min(1).max(100).default(30).optional(),
  /** 最多导入页数（基础分页版） */
  maxPages: z.number().int().min(1).max(20).default(3).optional(),
})
export type ImportGithubInput = z.infer<typeof importGithubSchema>

export const aiOutputSchema = z.object({
  summary: z.string().max(AI_SUMMARY_MAX_CHARS),
  /** 复用已有文件夹 id；与 new_folder 互斥，优先本字段 */
  folder_id: z.string().uuid().nullable().optional(),
  /** 无合适已有文件夹时新建（单级，挂在 parent_id 下） */
  new_folder: z
    .object({
      name: z.string().min(1).max(64),
      parent_id: z.string().uuid().nullable(),
    })
    .nullable()
    .optional(),
  /**
   * 兼容旧模型偶发返回的名称路径；服务端可按名解析，不作为主契约
   * @deprecated 使用 folder_id / new_folder
   */
  folder_path: z.array(z.string().min(1)).min(1).max(5).optional(),
  tags: z.array(z.string().min(1)).min(1).max(12),
  use_cases: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional().default(0.5),
})
export type AiOutput = z.infer<typeof aiOutputSchema>

export const meResponseSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  username: z.string(),
  deepseek_configured: z.boolean(),
  deepseek_last4: z.string().nullable(),
  deepseek_model: z.enum(DEEPSEEK_MODELS).or(z.string()),
  github_pat_configured: z.boolean(),
  hot_within_days: z.number().int(),
  stale_after_days: z.number().int(),
  public_browsing_enabled: z.boolean(),
  created_at: z.string(),
})
export type MeResponse = z.infer<typeof meResponseSchema>

export const updatePublicBrowsingSchema = z.object({
  enabled: z.boolean(),
})
export type UpdatePublicBrowsingInput = z.infer<
  typeof updatePublicBrowsingSchema
>

export const instanceStatusSchema = z.object({
  initialized: z.boolean(),
  public_browsing_enabled: z.boolean(),
  authenticated: z.boolean(),
})
export type InstanceStatus = z.infer<typeof instanceStatusSchema>

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
})

export const sourceTypeSchema = z.enum(SOURCE_TYPES)
export const aiStatusSchema = z.enum(AI_STATUSES)
export const healthStatusSchema = z.enum(HEALTH_STATUSES)
export const syncStatusSchema = z.enum(SYNC_STATUSES)

export const insightsQuerySchema = z.object({
  range: z.enum(INSIGHTS_RANGES).default(DEFAULT_INSIGHTS_RANGE),
})
export type InsightsQuery = z.infer<typeof insightsQuerySchema>

export { DEFAULT_DEEPSEEK_MODEL }
