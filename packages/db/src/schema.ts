import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

/**
 * 实例级设置：一行一个领域，value 是该领域的 JSON 对象。
 * 领域内新增字段不需要再改表结构。
 */
export const settings = sqliteTable(
  "settings",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [check("settings_value_json", sql`json_valid(${t.value})`)],
)

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    lastLoginAt: text("last_login_at"),
  },
  (t) => [
    uniqueIndex("users_username_uq").on(t.username),
    uniqueIndex("users_email_uq").on(t.email),
  ],
)

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    index("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
  ],
)

/** 入站 API Token（MCP / 自动化）；明文仅创建时返回一次 */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    /** JSON 数组：["read"] | ["read","write"] */
    scopes: text("scopes").notNull().default('["read"]'),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    uniqueIndex("api_tokens_token_hash_uq").on(t.tokenHash),
    index("api_tokens_prefix_idx").on(t.tokenPrefix),
  ],
)

/** 文件夹树：depth 0..4（最多 5 级）；path 如 /id1/id2/ */
export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    description: text("description"),
    isPreset: integer("is_preset", { mode: "boolean" }).notNull().default(false),
    parentId: text("parent_id"),
    /** 根为 0，最深 4 */
    depth: integer("depth").notNull().default(0),
    /** 物化路径，含自身：/id/ 或 /parent/id/ */
    path: text("path").notNull().default("/"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    /** 非根同级唯一；根级 slug 须 API 额外校验（SQLite NULL 不互斥） */
    uniqueIndex("folders_parent_slug_uq").on(t.parentId, t.slug),
    index("folders_parent_id_idx").on(t.parentId),
    index("folders_path_idx").on(t.path),
  ],
)

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type").notNull().default("github"),
    canonicalUrl: text("canonical_url").notNull(),
    externalId: text("external_id").notNull(),
    owner: text("owner"),
    title: text("title").notNull(),
    description: text("description"),
    language: text("language"),
    stars: integer("stars").notNull().default(0),
    forks: integer("forks").notNull().default(0),
    license: text("license"),
    homepage: text("homepage"),
    defaultBranch: text("default_branch"),
    topicsJson: text("topics_json").notNull().default("[]"),
    summaryAi: text("summary_ai"),
    useCasesJson: text("use_cases_json"),
    aiConfidence: real("ai_confidence"),
    folderId: text("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    /** 付费属性：null=未设置，free/freemium/paid */
    pricing: text("pricing"),
    /** 精选标记；默认 false，须手动开启 */
    featured: integer("featured", { mode: "boolean" })
      .notNull()
      .default(false),
    /** 是否已在该站点注册账号（仅 url 来源有意义；筛选用，默认 false） */
    accountRegistered: integer("account_registered", { mode: "boolean" })
      .notNull()
      .default(false),
    accountUsername: text("account_username"),
    accountPasswordEncrypted: text("account_password_encrypted"),
    accountPasswordUpdatedAt: text("account_password_updated_at"),
    siteName: text("site_name"),
    imageUrl: text("image_url"),
    faviconUrl: text("favicon_url"),
    contentExcerpt: text("content_excerpt"),
    /** GitHub README 缓存正文（截断存储），供详情展示与导出复用 */
    readmeExcerpt: text("readme_excerpt"),
    platformMetaJson: text("platform_meta_json").notNull().default("{}"),
    aiStatus: text("ai_status").notNull().default("pending"),
    trackUpdates: integer("track_updates", { mode: "boolean" })
      .notNull()
      .default(true),
    lastSyncedAt: text("last_synced_at"),
    pushedAt: text("pushed_at"),
    githubUpdatedAt: text("github_updated_at"),
    latestReleaseTag: text("latest_release_tag"),
    syncCursor: text("sync_cursor"),
    syncStatus: text("sync_status").notNull().default("never"),
    lastSyncError: text("last_sync_error"),
    healthStatus: text("health_status").notNull().default("unknown"),
    githubArchived: integer("github_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    repoSize: integer("repo_size"),
    archivedAt: text("archived_at"),
    deletedAt: text("deleted_at"),
    clickCount: integer("click_count").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("bookmarks_source_url_uq").on(t.sourceType, t.canonicalUrl),
    index("bookmarks_created_at_idx").on(t.createdAt),
    index("bookmarks_folder_id_idx").on(t.folderId),
    index("bookmarks_ai_status_idx").on(t.aiStatus),
    index("bookmarks_track_synced_idx").on(t.trackUpdates, t.lastSyncedAt),
    index("bookmarks_language_idx").on(t.language),
    index("bookmarks_external_id_idx").on(t.externalId),
    index("bookmarks_owner_idx").on(t.owner),
    index("bookmarks_health_status_idx").on(t.healthStatus),
    index("bookmarks_source_type_idx").on(t.sourceType),
    index("bookmarks_pricing_idx").on(t.pricing),
    index("bookmarks_featured_idx").on(t.featured),
  ],
)

/** 收藏向量（base64 Float32 LE）；个人库规模下可在 Worker 内余弦检索 */
export const bookmarkEmbeddings = sqliteTable(
  "bookmark_embeddings",
  {
    bookmarkId: text("bookmark_id")
      .primaryKey()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    dims: integer("dims").notNull(),
    vector: text("vector").notNull(),
    contentHash: text("content_hash").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [index("bookmark_embeddings_model_idx").on(t.model)],
)

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("tags_slug_uq").on(t.slug),
    uniqueIndex("tags_name_uq").on(t.name),
  ],
)

export const bookmarkTags = sqliteTable(
  "bookmark_tags",
  {
    bookmarkId: text("bookmark_id")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("bookmark_tags_uq").on(t.bookmarkId, t.tagId),
    index("bookmark_tags_tag_id_idx").on(t.tagId),
  ],
)

export const updateEvents = sqliteTable(
  "update_events",
  {
    id: text("id").primaryKey(),
    bookmarkId: text("bookmark_id")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    /** 幂等键，如 push:2026-08-01T12:00:00Z 或 release:v1.2.3 */
    dedupeKey: text("dedupe_key").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    detectedAt: text("detected_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("update_events_dedupe_uq").on(t.bookmarkId, t.dedupeKey),
    index("update_events_detected_at_idx").on(t.detectedAt),
    index("update_events_bookmark_id_idx").on(t.bookmarkId),
  ],
)

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    bookmarkId: text("bookmark_id")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index("ai_jobs_status_idx").on(t.status),
    index("ai_jobs_bookmark_id_idx").on(t.bookmarkId),
  ],
)

/**
 * GitHub Stars 后台导入任务（单实例同时最多一个 queued/running）。
 * queue_json 在 discover 阶段写入仓库列表；process 阶段按 cursor 逐条入库+AI。
 */
export const githubImportJobs = sqliteTable(
  "github_import_jobs",
  {
    id: text("id").primaryKey(),
    /** queued | running | completed | failed | cancelled */
    status: text("status").notNull().default("queued"),
    /** discover | process */
    phase: text("phase").notNull().default("discover"),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    imported: integer("imported").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    cursor: integer("cursor").notNull().default(0),
    queueJson: text("queue_json").notNull().default("[]"),
    page: integer("page").notNull().default(1),
    perPage: integer("per_page").notNull().default(30),
    maxPages: integer("max_pages").notNull().default(3),
    currentTitle: text("current_title"),
    lastError: text("last_error"),
    /** 自续跑鉴权；不对客户端暴露 */
    continueToken: text("continue_token").notNull(),
    leaseUntil: text("lease_until"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [index("github_import_jobs_status_idx").on(t.status)],
)

/** DeepSeek 真实 HTTP 调用用量（仅记 API 请求，不含规则降级） */
export const aiUsageLogs = sqliteTable(
  "ai_usage_logs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    /**
     * 提供方无关的缓存计量：各厂商的 hit/cached/read 字段统一归一到这两列
     * （见 llm-provider.ts），换厂商不必再加列。
     */
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    bookmarkId: text("bookmark_id").references(() => bookmarks.id, {
      onDelete: "set null",
    }),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index("ai_usage_logs_created_at_idx").on(t.createdAt),
    index("ai_usage_logs_kind_idx").on(t.kind),
    index("ai_usage_logs_model_idx").on(t.model),
  ],
)

/**
 * 收藏库对话的会话。与 bookmarks 一样不带 user 维度：本产品是单用户库，
 * users 表恒只有一行（见 getDeepSeekKey / getAnySearchKey 的取法）。
 */
export const kbConversations = sqliteTable(
  "kb_conversations",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    /**
     * 滚动摘要：把已经滑出近窗的旧轮次压成一段文本，替代原文进 prompt。
     * 两次压缩之间保持不变，因此它仍属于可被前缀缓存命中的稳定段。
     */
    contextSummary: text("context_summary"),
    /**
     * 摘要覆盖到的最后一条消息 id（kb_messages.id），未压缩过则为 null。
     *
     * 用消息 id 而不是条数或 seq 下标：客户端会丢掉空内容的回合、也会在
     * 超过请求上限时截掉最旧的几条，所以「从头数第几条」在两端并不一致，
     * 差一条就会让后续每轮都重发并重压同一段历史。指针只指向服务端确实
     * 总结过的那条消息，无论中间少了什么都不会错位。
     */
    summaryCoversThroughId: text("summary_covers_through_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [index("kb_conversations_updated_at_idx").on(t.updatedAt)],
)

/**
 * 会话内的单条消息。sources / warnings / plan / activity 以 JSON 文本整存：
 * 它们只用于回放渲染，不参与任何查询或聚合，拆表只会换来多一次 join。
 * seq 决定回放顺序，不依赖 created_at（同一秒内可能写入多条）。
 */
export const kbMessages = sqliteTable(
  "kb_messages",
  {
    /** 客户端生成，只保证会话内唯一：存档要能原样读回前端的消息 id */
    id: text("id").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => kbConversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** 仅 assistant 消息有值，对应前端 KbTurnState */
    state: text("state"),
    errorCode: text("error_code"),
    sources: text("sources"),
    warnings: text("warnings"),
    plan: text("plan"),
    activity: text("activity"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("kb_messages_uq").on(t.conversationId, t.id),
    index("kb_messages_conversation_seq_idx").on(t.conversationId, t.seq),
  ],
)

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type ApiToken = typeof apiTokens.$inferSelect
export type Folder = typeof folders.$inferSelect
export type Bookmark = typeof bookmarks.$inferSelect
export type Tag = typeof tags.$inferSelect
export type UpdateEvent = typeof updateEvents.$inferSelect
export type AiUsageLog = typeof aiUsageLogs.$inferSelect
export type AiJob = typeof aiJobs.$inferSelect
export type GithubImportJob = typeof githubImportJobs.$inferSelect
export type KbConversation = typeof kbConversations.$inferSelect
export type KbMessageRow = typeof kbMessages.$inferSelect
