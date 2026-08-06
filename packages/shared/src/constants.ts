/** 预置根文件夹（注册/首次登录后 seed）；description 供 AI prompt 语义用 */
export const PRESET_FOLDERS = [
  {
    name: "前端框架",
    slug: "frontend-framework",
    color: "#3B82F6",
    sortOrder: 10,
    description: "React/Vue/Svelte 等应用框架与元框架（Next/Nuxt 等）",
  },
  {
    name: "UI 组件",
    slug: "ui-components",
    color: "#8B5CF6",
    sortOrder: 20,
    description: "可复用 UI 组件库、设计系统、样式工具",
  },
  {
    name: "状态管理",
    slug: "state-management",
    color: "#EC4899",
    sortOrder: 30,
    description: "客户端/服务端状态、缓存与数据同步库",
  },
  {
    name: "后端与 API",
    slug: "backend-api",
    color: "#10B981",
    sortOrder: 40,
    description: "服务端框架、HTTP/RPC API、BaaS 与后端运行时",
  },
  {
    name: "数据库",
    slug: "database",
    color: "#F59E0B",
    sortOrder: 50,
    description: "数据库引擎、ORM、查询构建与存储相关工具",
  },
  {
    name: "DevOps 与部署",
    slug: "devops",
    color: "#EF4444",
    sortOrder: 60,
    description: "CI/CD、容器、基础设施即代码与部署平台",
  },
  {
    name: "AI / LLM",
    slug: "ai-llm",
    color: "#06B6D4",
    sortOrder: 70,
    description:
      "大模型、Agent、向量检索、推理框架、提示词库；细分形态应建或选用子文件夹，勿整仓硬塞本根目录",
  },
  {
    name: "工具与 CLI",
    slug: "tools-cli",
    color: "#6366F1",
    sortOrder: 80,
    description: "开发者工具、CLI、SDK、构建与效率脚本",
  },
  {
    name: "学习与教程",
    slug: "learning",
    color: "#84CC16",
    sortOrder: 90,
    description: "教程、课程、入门指南与系统化学习资料",
  },
  {
    name: "设计资源",
    slug: "design",
    color: "#F97316",
    sortOrder: 100,
    description: "图标、字体、设计稿与视觉资源",
  },
  {
    name: "其他",
    slug: "other",
    color: "#64748B",
    sortOrder: 110,
    description: "无法归入以上目录时使用；优先考虑新建更贴切的文件夹",
  },
] as const

/** 文件夹标识色色板（预置色去重 + 深色中性） */
export const FOLDER_COLOR_PRESETS = [
  ...new Set([...PRESET_FOLDERS.map((f) => f.color), "#0F172A"]),
] as const

/** @deprecated 使用 PRESET_FOLDERS */
export const PRESET_CATEGORIES = PRESET_FOLDERS

/** 产品最大文件夹深度（根 depth=0，最深 4 → 共 5 级） */
export const FOLDER_MAX_DEPTH = 4
/** AI 自动创建文件夹深度上限（depth 0..2 → 最多 3 级） */
export const AI_FOLDER_AUTO_CREATE_MAX_DEPTH = 2

export const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number]
export const DEFAULT_DEEPSEEK_MODEL: DeepSeekModel = "deepseek-v4-flash"
export const DEEPSEEK_API_BASE = "https://api.deepseek.com"

export const AI_USAGE_KINDS = [
  "classify",
  "slug_translate",
  "connection_test",
] as const
export type AiUsageKind = (typeof AI_USAGE_KINDS)[number]

export const AI_USAGE_STATUSES = ["ok", "error"] as const
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number]

export const INSIGHTS_RANGES = ["7d", "30d", "all"] as const
export type InsightsRange = (typeof INSIGHTS_RANGES)[number]
export const DEFAULT_INSIGHTS_RANGE: InsightsRange = "30d"

/**
 * DeepSeek 公开价粗算（USD / 1M tokens）。
 * 仅供洞察页估算，非官方账单；变更以 DeepSeek 定价页为准。
 */
export const DEEPSEEK_PRICE_USD_PER_1M: Record<
  DeepSeekModel,
  { input: number; output: number }
> = {
  "deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "deepseek-v4-pro": { input: 1.14, output: 4.56 },
}

export const AI_STATUSES = ["pending", "done", "fallback", "failed"] as const
export type AiStatus = (typeof AI_STATUSES)[number]

export const SOURCE_TYPES = ["github", "twitter", "url"] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

/** 本期已实现写库/同步的适配器 */
export const IMPLEMENTED_SOURCE_TYPES = ["github", "twitter", "url"] as const
export type ImplementedSourceType = (typeof IMPLEMENTED_SOURCE_TYPES)[number]

export type SourceCapabilities = {
  healthStatus: boolean
  sortByPushedAt: boolean
  trackUpdates: boolean
  languages: boolean
  /** 站点账号/密码备忘（仅通用网页） */
  accountCredentials: boolean
}

export const SOURCE_CAPABILITIES: Record<SourceType, SourceCapabilities> = {
  github: {
    healthStatus: true,
    sortByPushedAt: true,
    trackUpdates: true,
    languages: true,
    accountCredentials: false,
  },
  twitter: {
    healthStatus: false,
    sortByPushedAt: false,
    trackUpdates: false,
    languages: false,
    accountCredentials: false,
  },
  url: {
    healthStatus: false,
    sortByPushedAt: false,
    trackUpdates: false,
    languages: false,
    accountCredentials: true,
  },
}

/** 识别规则：更具体的 host 须排在通用 url 之前 */
export const SOURCE_DETECT_RULES: Array<{
  type: SourceType
  match: RegExp
  label: string
}> = [
  { type: "github", match: /(?:^|\.)github\.com$/i, label: "GitHub" },
  {
    type: "twitter",
    match: /(?:^|\.)(?:x|twitter)\.com$/i,
    label: "X",
  },
  { type: "url", match: /^https?:\/\//i, label: "通用网页" },
]

export const HEALTH_STATUSES = [
  "unavailable",
  "empty",
  "archived",
  "stale",
  "active",
  "hot",
  "unknown",
] as const
export type HealthStatus = (typeof HEALTH_STATUSES)[number]

export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  unavailable: "已失效",
  empty: "空仓库",
  archived: "官方归档",
  stale: "疑似停更",
  active: "正常维护",
  hot: "近期活跃",
  unknown: "近况未知",
}

export const SYNC_STATUSES = [
  "never",
  "ok",
  "not_found",
  "forbidden",
  "error",
] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

export const UPDATE_EVENT_TYPES = [
  "push",
  "release",
  "stars_delta",
  "meta_change",
] as const
export type UpdateEventType = (typeof UPDATE_EVENT_TYPES)[number]

export const BOOKMARK_SORT_OPTIONS = [
  "created_at",
  "stars",
  "title",
  "updated_at",
  "pushed_at",
] as const
export type BookmarkSort = (typeof BOOKMARK_SORT_OPTIONS)[number]

export const SESSION_COOKIE_NAME = "mankr_session"
export const SESSION_TTL_DAYS = 30

export const PASSWORD_MIN_LENGTH = 8
export const AI_SUMMARY_MAX_CHARS = 80
export const AI_TAG_MIN = 3
export const AI_TAG_MAX = 8

/** GitHub sync: stars 变化超过此阈值（或绝对值）才记 stars_delta */
export const STARS_DELTA_THRESHOLD = 0.1
export const STARS_DELTA_ABS_MIN = 50

export const CRON_SYNC_BATCH_SIZE = 20
export const CRON_AI_BACKFILL_BATCH_SIZE = 5
export const GITHUB_README_MAX_CHARS = 4000
/** 网页/仓库正文摘录入库与 AI prompt 共用上限 */
export const CONTENT_EXCERPT_MAX_CHARS = 8000
/** URL 规范化时剥离的常见追踪参数前缀/全名 */
export const TRACKING_QUERY_PARAMS = [
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "ref_url",
] as const

/** 仓库近况：近期活跃 / 疑似停更默认阈值（天） */
export const DEFAULT_HOT_WITHIN_DAYS = 30
export const DEFAULT_STALE_AFTER_DAYS = 180
export const MIN_TRACKING_DAYS = 1
export const MAX_TRACKING_DAYS = 3650
