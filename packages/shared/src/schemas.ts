import { z } from "zod"
import {
  BOOKMARK_PAGINATION_MODES,
  DEFAULT_BOOKMARK_PAGE_SIZE,
  DEFAULT_BOOKMARK_PAGINATION_MODE,
  GOOGLE_ANALYTICS_MEASUREMENT_ID_RE,
} from "./settings"
import {
  AI_STATUSES,
  AI_SUMMARY_MAX_CHARS,
  BOOKMARK_PRICING_FILTER_VALUES,
  BOOKMARK_PRICING_VALUES,
  BOOKMARK_SORT_OPTIONS,
  DEEPSEEK_MODELS,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_HOT_WITHIN_DAYS,
  DEFAULT_INSIGHTS_RANGE,
  DEFAULT_STALE_AFTER_DAYS,
  HEALTH_STATUSES,
  INSIGHTS_RANGES,
  KB_CHAT_MAX_STORED_MESSAGES,
  KB_CHAT_MESSAGE_MAX_CHARS,
  KB_CHAT_MODEL_IDS,
  KB_CHAT_REQUEST_MAX_MESSAGES,
  KB_CHAT_TOP_K,
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
  url: z.string().min(1, "请输入 GitHub 仓库、X 帖子或网页链接"),
  notes: z.string().max(10000).optional(),
  folderId: z.string().uuid().optional().nullable(),
  trackUpdates: z.boolean().optional().default(true),
})
export type CreateBookmarkInput = z.infer<typeof createBookmarkSchema>

export const updateBookmarkSchema = z.object({
  notes: z.string().max(10000).optional().nullable(),
  folderId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional().nullable(),
  summaryAi: z.string().max(AI_SUMMARY_MAX_CHARS).optional().nullable(),
  trackUpdates: z.boolean().optional(),
  archived: z.boolean().optional(),
  tagNames: z.array(z.string().min(1).max(64)).max(20).optional(),
  /** 是否已注册账号（仅 url 来源生效） */
  accountRegistered: z.boolean().optional(),
  /** 站点账号；空字符串表示清除 */
  accountUsername: z.string().max(256).optional().nullable(),
  /**
   * 站点密码明文（仅写入时传输；空字符串表示清除）。
   * 列表/详情永不回传明文或密文。
   */
  accountPassword: z.string().max(512).optional().nullable(),
  /** 付费属性；null 表示清除为未设置 */
  pricing: z.enum(BOOKMARK_PRICING_VALUES).optional().nullable(),
  /** 精选标记 */
  featured: z.boolean().optional(),
})
export type UpdateBookmarkInput = z.infer<typeof updateBookmarkSchema>

export const listBookmarksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  folderId: z.string().uuid().optional(),
  tag: z.string().optional(),
  language: z.string().optional(),
  owner: z.string().optional(),
  site: z.string().optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  healthStatus: z.enum(HEALTH_STATUSES).optional(),
  /** AI 归类状态筛选；主要供洞察页 pending/failed 计数深链使用 */
  aiStatus: z.enum(AI_STATUSES).optional(),
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
  /** 仅网页来源：是否有账号。公开浏览时服务端忽略该参数 */
  hasAccount: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      return v === "true" || v === "1"
    }),
  /** 付费属性筛选；unset 匹配未设置（DB NULL） */
  pricing: z.enum(BOOKMARK_PRICING_FILTER_VALUES).optional(),
  /** 精选筛选；仅传参时过滤 */
  featured: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      return v === "true" || v === "1"
    }),
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

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(64),
})
export type UpdateTagInput = z.infer<typeof updateTagSchema>

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

export const anysearchSettingsSchema = z.object({
  apiKey: z.string().min(1).optional(),
  clearKey: z.boolean().optional(),
})
export type AnysearchSettingsInput = z.infer<typeof anysearchSettingsSchema>

export const cloudflareSettingsSchema = z
  .object({
    accountId: z.string().min(1).optional(),
    apiToken: z.string().min(1).optional(),
    clearToken: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.accountId !== undefined ||
      data.apiToken !== undefined ||
      data.clearToken === true,
    { message: "请提供 accountId、apiToken 或 clearToken" },
  )
export type CloudflareSettingsInput = z.infer<typeof cloudflareSettingsSchema>

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
    eventPush: z.boolean().optional(),
    eventRelease: z.boolean().optional(),
    eventStarsDelta: z.boolean().optional(),
    eventMetaChange: z.boolean().optional(),
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
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(30),
  /** 最多导入页数（基础分页版） */
  maxPages: z.number().int().min(1).max(20).default(3),
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
  anysearch_configured: z.boolean(),
  anysearch_last4: z.string().nullable(),
  github_pat_configured: z.boolean(),
  cloudflare_configured: z.boolean(),
  cloudflare_account_id: z.string().nullable(),
  cloudflare_token_last4: z.string().nullable(),
  hot_within_days: z.number().int(),
  stale_after_days: z.number().int(),
  event_push: z.boolean(),
  event_release: z.boolean(),
  event_stars_delta: z.boolean(),
  event_meta_change: z.boolean(),
  public_browsing_enabled: z.boolean(),
  bookmark_pagination_mode: z.enum(BOOKMARK_PAGINATION_MODES),
  bookmark_page_size: z.number().int(),
  created_at: z.string(),
})
export type MeResponse = z.infer<typeof meResponseSchema>

/** 单条 Free 额度用量 */
export const cloudflareQuotaMetricSchema = z.object({
  used: z.number(),
  limit: z.number(),
  remaining: z.number(),
  ratio: z.number(),
})
export type CloudflareQuotaMetric = z.infer<typeof cloudflareQuotaMetricSchema>

export const cloudflareQuotaResponseSchema = z.discriminatedUnion(
  "configured",
  [
    z.object({ configured: z.literal(false) }),
    z.object({
      configured: z.literal(true),
      as_of: z.string(),
      period: z.object({
        kind: z.literal("utc_day"),
        start: z.string(),
        end: z.string(),
      }),
      plan: z.literal("workers_free"),
      scope: z.literal("account"),
      cached: z.boolean(),
      stale: z.boolean().optional(),
      workers: z.object({
        requests: cloudflareQuotaMetricSchema,
      }),
      d1: z.object({
        rows_read: cloudflareQuotaMetricSchema,
        rows_written: cloudflareQuotaMetricSchema,
        storage_bytes: cloudflareQuotaMetricSchema,
      }),
    }),
  ],
)
export type CloudflareQuotaResponse = z.infer<
  typeof cloudflareQuotaResponseSchema
>

export const updatePublicBrowsingSchema = z.object({
  enabled: z.boolean(),
})
export type UpdatePublicBrowsingInput = z.infer<
  typeof updatePublicBrowsingSchema
>

/** 写入 Google Analytics Measurement ID；空串 / null 表示清空 */
export const updateAnalyticsSettingsSchema = z.object({
  measurement_id: z
    .union([z.string(), z.null()])
    .transform((value, ctx) => {
      if (value == null) return null
      const trimmed = value.trim()
      if (!trimmed) return null
      if (!GOOGLE_ANALYTICS_MEASUREMENT_ID_RE.test(trimmed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Measurement ID 格式无效，应为 G-XXXXXXXXXX",
        })
        return z.NEVER
      }
      return trimmed.toUpperCase()
    }),
})
export type UpdateAnalyticsSettingsInput = z.infer<
  typeof updateAnalyticsSettingsSchema
>

export const instanceStatusSchema = z.object({
  initialized: z.boolean(),
  public_browsing_enabled: z.boolean(),
  authenticated: z.boolean(),
  /** 实例级收藏分页偏好，公开访客与登录用户一致 */
  bookmark_pagination_mode: z
    .enum(BOOKMARK_PAGINATION_MODES)
    .default(DEFAULT_BOOKMARK_PAGINATION_MODE),
  bookmark_page_size: z.number().int().default(DEFAULT_BOOKMARK_PAGE_SIZE),
  /** 未配置时为 null；Measurement ID 非敏感，可公开下发 */
  google_analytics_measurement_id: z.string().nullable().default(null),
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

export const kbChatMessageSchema = z.object({
  /**
   * 客户端侧的消息 id（与会话存档里的 kb_messages.id 同源）。
   *
   * 滚动摘要的水位是「覆盖到哪条消息为止」这个指针，而不是条数：
   * 客户端会丢掉空内容的回合（中止／无命中），也会在超过请求上限时
   * 截掉最旧的几条，条数因此不是两端共享的坐标系 —— 差一条，
   * 后续每轮都会把已进摘要的消息再发一遍并重压一次。
   *
   * 可选：第三方调用方不带 id 也能正常对话，只是不会产生摘要。
   */
  id: z.string().min(1).optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(KB_CHAT_MESSAGE_MAX_CHARS),
})
export type KbChatMessage = z.infer<typeof kbChatMessageSchema>

export const kbChatRequestSchema = z.object({
  messages: z
    .array(kbChatMessageSchema)
    .min(1)
    .max(KB_CHAT_REQUEST_MAX_MESSAGES),
  webSearch: z.boolean().optional().default(false),
  /** 按轮次生效的模型覆盖；缺省时回落到用户设置里的 deepseek_model */
  model: z.enum(KB_CHAT_MODEL_IDS).optional(),
  /**
   * 当前会话 id。带上它服务端才能读写滚动摘要；缺省时按无摘要处理，
   * 对话照常进行，只是长会话会退化成硬截断。
   */
  conversationId: z.string().uuid().optional(),
  /**
   * 客户端当前所处的软上下文（例如收藏页正在筛选的文件夹）。
   * 仅用于提示词里的轻量提示，不影响检索逻辑；缺省时按无上下文处理。
   */
  context: z
    .object({
      folderId: z.string().uuid().optional(),
      folderName: z.string().max(200).optional(),
    })
    .optional(),
})
export type KbChatRequest = z.infer<typeof kbChatRequestSchema>

export const KB_SOURCE_TYPES = ["bookmark", "web"] as const
export type KbSourceType = (typeof KB_SOURCE_TYPES)[number]

/**
 * 这些结构既由 worker 产出、又要被会话存档接口回传校验，
 * 所以用 zod 作为唯一来源、类型从 schema infer，避免 type 与校验两份定义漂移。
 */
export const kbChatSourceSchema = z.object({
  type: z.enum(KB_SOURCE_TYPES),
  /** 仅 bookmark 来源有值 */
  id: z.string().optional(),
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
})
export type KbChatSource = z.infer<typeof kbChatSourceSchema>

export const KB_CHAT_WARNINGS = ["ANYSEARCH_FAILED"] as const
export type KbChatWarning = (typeof KB_CHAT_WARNINGS)[number]

/** 与 UI 层 TodoItemStatus 逐字对齐，前端零转换直接喂给 TodoList */
export const KB_CHAT_PLAN_STATUSES = [
  "pending",
  "in-progress",
  "completed",
  "cancelled",
] as const
export type KbChatPlanStatus = (typeof KB_CHAT_PLAN_STATUSES)[number]

export const kbChatPlanItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(KB_CHAT_PLAN_STATUSES),
  detail: z.string().optional(),
})
export type KbChatPlanItem = z.infer<typeof kbChatPlanItemSchema>

/** 与 UI 层 AgentStepStatus 逐字对齐 */
export const KB_CHAT_ACTIVITY_STEP_STATUSES = [
  "pending",
  "active",
  "complete",
] as const
export type KbChatActivityStepStatus =
  (typeof KB_CHAT_ACTIVITY_STEP_STATUSES)[number]

/** 检索/生成阶段的语义标识，前端按它取本地化文案 */
export const KB_CHAT_STAGES = [
  "search_bookmarks",
  "search_web",
  "generate",
] as const
export type KbChatStage = (typeof KB_CHAT_STAGES)[number]

/**
 * AgentActivityItem 的服务端子集：只保留能由 worker 真实产出的四种形态，
 * 字段类型收窄为 string（服务端没有 ReactNode），仍可直接赋给 UI 类型。
 *
 * step 的文案走 stage + count 而不是成品句子：worker 层没有 i18n，
 * 与 errors 用 code 映射同一套路，措辞交给前端。label 只作兜底。
 */
export const kbChatActivityItemSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("step"),
    label: z.string(),
    status: z.enum(KB_CHAT_ACTIVITY_STEP_STATUSES).optional(),
    meta: z.string().optional(),
    stage: z.enum(KB_CHAT_STAGES).optional(),
    /** 供前端拼 meta 文案的数量，如命中条数 */
    count: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("search"),
    query: z.string(),
    results: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          domain: z.string().optional(),
          url: z.string().optional(),
        }),
      )
      .optional(),
    moreCount: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("tool"),
    action: z.string(),
    target: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("trace"),
    kind: z.string(),
    label: z.string(),
    detail: z.string().optional(),
  }),
])
export type KbChatActivityItem = z.infer<typeof kbChatActivityItemSchema>

/**
 * SSE 事件契约（顺序敏感，改动前先读 apps/web/test/kb-chat.test.ts）：
 * - meta 恒为流的第一个事件，且整轮只发一次
 * - 多轮检索新增的来源走 sources_append 增量追加，绝不重复发 meta
 * - empty 表示检索无命中、未调用生成模型，由前端渲染本地化文案
 * - done 收尾；error 表示上游生成失败
 *
 * 这里刻意没有「摘要水位」事件：压缩与生成并发跑，流关闭时它可能还没写完，
 * 硬要在流里通告就得等它，等于把省下来的延迟又还回去。水位随每轮收尾的
 * 存档响应回传（见 KbConversationSummary.summary_covers_through_id），
 * 而且它只是省上传流量的优化 —— 服务端按 id 对齐，客户端水位过期不影响正确性。
 */
export type KbChatStreamEvent =
  | { type: "meta"; sources: KbChatSource[]; warnings?: KbChatWarning[] }
  | { type: "sources_append"; sources: KbChatSource[] }
  | { type: "plan"; items: KbChatPlanItem[] }
  | { type: "plan_update"; id: string; status: KbChatPlanStatus }
  | { type: "activity"; item: KbChatActivityItem }
  | { type: "delta"; text: string }
  | { type: "empty" }
  | { type: "done" }
  | { type: "error"; code: string; message: string }

/** 一轮对话的最终状态，前端与存档共用 */
export const KB_TURN_STATES = [
  "pending",
  "streaming",
  "done",
  "empty",
  "error",
  "aborted",
] as const
export type KbTurnState = (typeof KB_TURN_STATES)[number]

/**
 * 存档里的单条消息。SSE 产出的过程数据（plan / activity）一并保留，
 * 重开会话时能完整回放检索过程与任务清单。
 *
 * 字段用 camelCase 且请求与响应共用这一个 schema —— 它是前端会话状态的存档，
 * 不是一份资源表示；若出站改成 snake_case，就要为同一结构维护两套字段名与
 * 两次映射。会话元数据（created_at 等）仍沿用其他接口的 snake_case。
 */
export const kbStoredMessageSchema = z.object({
  id: z.string().min(1).max(64),
  role: z.enum(["user", "assistant"]),
  /** 被中止且未产出内容的回合会是空串 */
  content: z.string().max(KB_CHAT_MESSAGE_MAX_CHARS),
  state: z.enum(KB_TURN_STATES).optional(),
  errorCode: z.string().max(64).optional(),
  sources: z.array(kbChatSourceSchema).max(KB_CHAT_TOP_K * 4).optional(),
  warnings: z.array(z.enum(KB_CHAT_WARNINGS)).optional(),
  plan: z.array(kbChatPlanItemSchema).max(20).optional(),
  activity: z.array(kbChatActivityItemSchema).max(60).optional(),
})
export type KbStoredMessage = z.infer<typeof kbStoredMessageSchema>

/** 整会话全量覆盖。重试会截断尾部消息，增量 append 表达不了这种语义 */
export const kbConversationUpsertSchema = z.object({
  messages: z
    .array(kbStoredMessageSchema)
    .min(1)
    .max(KB_CHAT_MAX_STORED_MESSAGES)
    // 会话内 id 唯一由客户端保证，这里拦一道，免得撞唯一索引冒成 500
    .refine(
      (items) => new Set(items.map((m) => m.id)).size === items.length,
      "消息 id 在同一会话内必须唯一",
    ),
})
export type KbConversationUpsert = z.infer<typeof kbConversationUpsertSchema>

export type KbConversationSummary = {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  /**
   * 滚动摘要覆盖到的最后一条消息 id，未压缩过则为 null。
   * 前端据此在下一轮请求里跳过这段前缀，只回传摘要没覆盖到的尾部。
   *
   * 这是省上传流量的优化，不是正确性的一环：服务端也会按同一个 id
   * 自行对齐，客户端拿着过期指针只是多传几条会被服务端丢掉的消息。
   */
  summary_covers_through_id: string | null
}

export type KbConversationDetail = Omit<
  KbConversationSummary,
  "message_count"
> & {
  messages: KbStoredMessage[]
}

export { DEFAULT_DEEPSEEK_MODEL }
