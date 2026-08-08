/** 预置根文件夹（注册/首次登录后 seed）；description 供 AI prompt 语义用 */
export const PRESET_FOLDERS = [
  {
    name: "前端框架",
    slug: "frontend-framework",
    color: "#4A7BB0",
    sortOrder: 10,
    description: "React/Vue/Svelte 等应用框架与元框架（Next/Nuxt 等）",
  },
  {
    name: "UI 组件",
    slug: "ui-components",
    color: "#8263B4",
    sortOrder: 20,
    description: "可复用 UI 组件库、设计系统、样式工具",
  },
  {
    name: "状态管理",
    slug: "state-management",
    color: "#C25983",
    sortOrder: 30,
    description: "客户端/服务端状态、缓存与数据同步库",
  },
  {
    name: "后端与 API",
    slug: "backend-api",
    color: "#3B8A72",
    sortOrder: 40,
    description: "服务端框架、HTTP/RPC API、BaaS 与后端运行时",
  },
  {
    name: "数据库",
    slug: "database",
    color: "#B87B2E",
    sortOrder: 50,
    description: "数据库引擎、ORM、查询构建与存储相关工具",
  },
  {
    name: "DevOps 与部署",
    slug: "devops",
    color: "#B95252",
    sortOrder: 60,
    description: "CI/CD、容器、基础设施即代码与部署平台",
  },
  {
    name: "AI / LLM",
    slug: "ai-llm",
    color: "#338B98",
    sortOrder: 70,
    description:
      "大模型、Agent、向量检索、推理框架、提示词库；细分形态应建或选用子文件夹，勿整仓硬塞本根目录",
  },
  {
    name: "工具与 CLI",
    slug: "tools-cli",
    color: "#5865B3",
    sortOrder: 80,
    description: "开发者工具、CLI、SDK、构建与效率脚本",
  },
  {
    name: "学习与教程",
    slug: "learning",
    color: "#6A8D3F",
    sortOrder: 90,
    description: "教程、课程、入门指南与系统化学习资料",
  },
  {
    name: "设计资源",
    slug: "design",
    color: "#B86B35",
    sortOrder: 100,
    description: "图标、字体、设计稿与视觉资源",
  },
  {
    name: "其他",
    slug: "other",
    color: "#606E80",
    sortOrder: 110,
    description: "无法归入以上目录时使用；优先考虑新建更贴切的文件夹",
  },
] as const

/** 文件夹标识色色板（预置色去重 + 深色中性） */
export const FOLDER_COLOR_PRESETS = [
  ...new Set([...PRESET_FOLDERS.map((f) => f.color), "#2D3748"]),
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

/** AnySearch 联网搜索（通用 search 接口） */
export const ANYSEARCH_API_BASE = "https://api.anysearch.com/v1"
export const ANYSEARCH_CLIENT_HEADER = "mankr-star/1.0"
/** 单轮联网检索返回的最大结果数 */
export const ANYSEARCH_MAX_RESULTS = 5

/** 知识库对话检索与上下文上限 */
export const KB_CHAT_TOP_K = 8
export const KB_CHAT_SNIPPET_MAX_CHARS = 600
export const KB_CHAT_QUERY_MAX_CHARS = 500
/** 随每轮 prompt 常驻的分类目录条数上限，文件夹很多时按收藏数截断 */
export const KB_CHAT_FOLDER_DIGEST_LIMIT = 40
/** 按分类列举收藏时的单次条数上限 */
export const KB_CHAT_FOLDER_LIST_LIMIT = 20
/** 一次提问最多认领几个分类，避免宽泛词把半个库拖进上下文 */
export const KB_CHAT_MATCHED_CATEGORY_LIMIT = 3
export const KB_CHAT_MESSAGE_MAX_CHARS = 4000
/** 请求体允许携带的历史消息条数上限 */
export const KB_CHAT_REQUEST_MAX_MESSAGES = 40

/**
 * 上下文压缩（滚动摘要）阈值。
 *
 * 触发时机刻意设得「低频」：压缩会重写 prompt 的稳定前缀，
 * 而各家的前缀缓存只在前缀逐字节相同时命中，所以每轮都压缩反而更贵
 * —— 既付了摘要调用的钱，又把后续所有轮次的缓存命中打掉。
 * 只有历史确实撑到阈值才压一次，压完的摘要在下一次压缩前保持不变。
 */
export const KB_CONTEXT_COMPRESS_TOKEN_THRESHOLD = 6000
/** 压缩时保留原文的最近消息条数（约 3 轮问答），更早的进摘要 */
export const KB_CONTEXT_RECENT_MESSAGES = 6
/**
 * 单轮 prompt 里历史部分的容量上限，与上面的成本阈值是两件事：
 * 6000 是「该花钱压一次了」，这个是「再多就撑不住了」。
 *
 * 压缩与生成并发进行，摘要要下一轮才可用，所以触发压缩的那一轮仍然
 * 原样发送全部历史 —— 只有超过这个上限时才从头砍，避免请求体上限
 * （40 条 × 4000 字 ≈ 40k token）叠上检索资料后顶穿 agent 的
 * KB_AGENT_MAX_TOTAL_TOKENS 预算。
 */
export const KB_CONTEXT_MAX_PROMPT_TOKENS = 20_000
/** 摘要文本长度上限，防止摘要自己变成新的上下文负担 */
export const KB_CONTEXT_SUMMARY_MAX_CHARS = 2000
/** 摘要生成调用的输出上限 */
export const KB_CONTEXT_SUMMARY_MAX_TOKENS = 512

/** 保留的会话数上限，超出时淘汰最久未更新的（单用户个人库，无需无限增长） */
export const KB_CHAT_MAX_CONVERSATIONS = 50
/** 单个会话落库的消息条数上限 */
export const KB_CHAT_MAX_STORED_MESSAGES = 200
/** 会话标题长度上限，标题由首条提问派生 */
export const KB_CHAT_TITLE_MAX_CHARS = 40

/**
 * 混合 agent 的保护阈值。三者任一触顶都会立即降级为「用已有资料直出」，
 * 其中时间预算是 Cloudflare Workers 上的硬约束：超时表现为流被掐断。
 */
export const KB_AGENT_MAX_TOOL_ROUNDS = 4
export const KB_AGENT_MAX_TOTAL_TOKENS = 60_000
export const KB_AGENT_TIME_BUDGET_MS = 20_000
/** 工具未指定 limit 时返回的结果条数（硬上限仍是 KB_CHAT_TOP_K） */
export const KB_AGENT_TOOL_RESULT_LIMIT = 6
/** 单条工具回执喂回模型的长度上限，防止上下文被一次调用撑爆 */
export const KB_AGENT_TOOL_RESULT_MAX_CHARS = 6000

/**
 * 知识库对话可选模型。provider 两级描述，为后续接入其他厂商预留；
 * tools 表示该模型是否支持 function calling（决定能否走 agent 循环路径）。
 */
export const KB_CHAT_PROVIDERS = ["deepseek"] as const
export type KbChatProvider = (typeof KB_CHAT_PROVIDERS)[number]

export const KB_CHAT_MODELS = [
  { provider: "deepseek", model: "deepseek-v4-flash", tools: true },
  { provider: "deepseek", model: "deepseek-v4-pro", tools: true },
] as const satisfies ReadonlyArray<
  // provider 分支各自约束 model 的取值域，新增厂商时在此追加一支。
  // deepseek 收紧到 DEEPSEEK_MODELS，保证 DEEPSEEK_PRICE_USD_PER_1M 不会漏配定价。
  { provider: "deepseek"; model: DeepSeekModel; tools: boolean }
>

export type KbChatModelId = (typeof KB_CHAT_MODELS)[number]["model"]

/** 供 zod 枚举与前端白名单校验使用的模型 id 列表 */
export const KB_CHAT_MODEL_IDS = KB_CHAT_MODELS.map((entry) => entry.model)

export function findKbChatModel(model: string | undefined | null) {
  if (!model) return undefined
  return KB_CHAT_MODELS.find((entry) => entry.model === model)
}

export const AI_USAGE_KINDS = [
  "classify",
  "slug_translate",
  "connection_test",
  "kb_chat",
  /**
   * 滚动摘要压缩。单独一类而不是并进 kb_chat：压缩与生成并发进行、
   * 各自独立成败，混在一条记录里就看不出摘要本身花了多少。
   */
  "kb_compress",
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
