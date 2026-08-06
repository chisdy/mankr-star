import { sql } from "drizzle-orm"
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    githubPatEncrypted: text("github_pat_encrypted"),
    deepseekApiKeyEncrypted: text("deepseek_api_key_encrypted"),
    deepseekKeyLast4: text("deepseek_key_last4"),
    deepseekModel: text("deepseek_model").default("deepseek-v4-flash"),
    hotWithinDays: integer("hot_within_days").notNull().default(30),
    staleAfterDays: integer("stale_after_days").notNull().default(180),
    publicBrowsingEnabled: integer("public_browsing_enabled", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
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
  ],
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

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Folder = typeof folders.$inferSelect
export type Bookmark = typeof bookmarks.$inferSelect
export type Tag = typeof tags.$inferSelect
export type UpdateEvent = typeof updateEvents.$inferSelect
export type AiUsageLog = typeof aiUsageLogs.$inferSelect
export type AiJob = typeof aiJobs.$inferSelect
