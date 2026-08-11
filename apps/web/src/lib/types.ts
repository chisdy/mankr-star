/**
 * Mankr Star - Data Models & API Types
 * Aligned with TECHNICAL_DESIGN §7 and PRD.md
 */

import type {
  BookmarkPaginationMode,
  BookmarkPricing,
  BookmarkPricingFilter,
  CloudflareQuotaResponse,
} from "@mankr/shared"

export type {
  BookmarkPaginationMode,
  BookmarkPricing,
  BookmarkPricingFilter,
  CloudflareQuotaResponse,
}

export interface User {
  id: string
  username: string
  email?: string | null
  deepseek_configured: boolean
  deepseek_last4?: string | null
  deepseek_model?: string | null
  embedding_configured?: boolean
  embedding_base_url?: string | null
  embedding_model?: string | null
  embedding_last4?: string | null
  embedding_reuse_ai_key?: boolean
  anysearch_configured?: boolean
  anysearch_last4?: string | null
  github_pat_configured?: boolean
  github_pat_last4?: string | null
  cloudflare_configured?: boolean
  cloudflare_account_id?: string | null
  cloudflare_token_last4?: string | null
  hot_within_days?: number
  stale_after_days?: number
  /** 动态订阅开关；关闭后 Cron 同步不再写入对应类型的事件 */
  event_push?: boolean
  event_release?: boolean
  event_stars_delta?: boolean
  event_meta_change?: boolean
  public_browsing_enabled?: boolean
  bookmark_pagination_mode?: BookmarkPaginationMode
  bookmark_page_size?: number
  created_at?: string
  last_login_at?: string | null
}

export interface InstanceStatus {
  initialized: boolean
  public_browsing_enabled: boolean
  /** 当前请求是否带有有效 Session（软探测，不 401） */
  authenticated: boolean
  /** 实例级收藏分页偏好；公开访客与登录用户读取同一值 */
  bookmark_pagination_mode: BookmarkPaginationMode
  bookmark_page_size: number
  /** Google Analytics Measurement ID；未配置为 null */
  google_analytics_measurement_id: string | null
}

/** 收藏分页设置；写入时用 Partial 允许只改其中一项，读到的总是完整值 */
export interface BookmarkPaginationSettings {
  bookmark_pagination_mode: BookmarkPaginationMode
  bookmark_page_size: number
}

export interface Folder {
  id: string
  name: string
  slug: string
  color?: string | null
  sort_order?: number
  description?: string | null
  parent_id?: string | null
  depth: number
  path: string
  path_label?: string
  is_preset?: boolean
  count?: number
  created_at?: string
  updated_at?: string
}

export interface Tag {
  id: string
  name: string
  count?: number
}

export type AiStatus = "pending" | "done" | "fallback" | "failed"

export type HealthStatus =
  | "unavailable"
  | "empty"
  | "archived"
  | "stale"
  | "active"
  | "hot"
  | "unknown"

export type SyncStatus = "never" | "ok" | "not_found" | "forbidden" | "error"

export interface Bookmark {
  id: string
  source_type: string
  canonical_url: string
  external_id?: string | null // e.g. "owner/repo"
  owner?: string | null
  title: string
  description?: string | null
  language?: string | null
  stars?: number
  forks?: number
  summary_ai?: string | null
  site_name?: string | null
  image_url?: string | null
  favicon_url?: string | null
  content_excerpt?: string | null
  /** GitHub README 缓存正文（截断） */
  readme_excerpt?: string | null
  platform_meta?: Record<string, unknown> | null
  folder_id?: string | null
  folder_name?: string | null
  folder?: Folder | null
  tags?: string[]
  notes?: string | null
  /** 付费属性：null/未设置 | free | freemium | paid */
  pricing?: BookmarkPricing | null
  /** 精选标记 */
  featured?: boolean
  /** 是否已在该站点注册（仅登录态、url 来源） */
  account_registered?: boolean
  /** 站点账号明文（仅登录态；可本地复制） */
  account_username?: string | null
  /** 是否已设置密码（永不返回密码明文） */
  account_password_set?: boolean
  account_password_updated_at?: string | null
  ai_status: AiStatus
  track_updates: boolean
  last_synced_at?: string | null
  pushed_at?: string | null
  latest_release_tag?: string | null
  sync_status?: SyncStatus | string | null
  last_sync_error?: string | null
  health_status?: HealthStatus | string | null
  github_archived?: boolean | null
  repo_size?: number | null
  archived_at?: string | null
  deleted_at?: string | null
  click_count?: number
  created_at: string
  updated_at?: string
}

export type EventType = "push" | "release" | "stars_delta" | "meta_change"

export interface UpdateEvent {
  id: string
  bookmark_id: string
  bookmark_title?: string
  bookmark_external_id?: string
  event_type: EventType
  payload_json?: string
  detected_at: string
}

export interface FeedQueryParams {
  eventType?: EventType
  bookmarkId?: string
  page?: number
  pageSize?: number
}

export interface FeedResponse {
  items: UpdateEvent[]
  page: number
  pageSize: number
  total: number
}

export interface GithubImportParams {
  page?: number
  perPage?: number
  maxPages?: number
}

export type GithubImportJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export interface GithubImportJob {
  id: string
  status: GithubImportJobStatus | string
  phase: string
  total: number
  processed: number
  imported: number
  skipped: number
  failed_count: number
  current_title: string | null
  last_error: string | null
  started_at: string | null
  updated_at: string
  finished_at: string | null
}

export interface GithubImportStartResult {
  job: GithubImportJob
}

export interface BookmarksQueryParams {
  folder_id?: string
  tag?: string
  language?: string
  owner?: string
  site?: string
  source_type?: string
  health_status?: HealthStatus
  /** 仅网页模式：是否有账号 */
  has_account?: boolean
  /** 付费属性筛选；unset 表示未设置 */
  pricing?: BookmarkPricingFilter
  /** 精选筛选 */
  featured?: boolean
  /** AI 归类状态筛选 */
  ai_status?: AiStatus
  sort?: "recent" | "updated" | "stars" | "name"
  q?: string
  archived?: boolean
  page?: number
  limit?: number
}

export interface BookmarkOwner {
  name: string
  usage_count?: number
}

export interface BookmarkSite {
  name: string
  usage_count?: number
}

export interface BookmarksResponse {
  items: Bookmark[]
  total: number
  page: number
  limit: number
}

export interface DeepSeekSettings {
  configured: boolean
  last4?: string | null
  model: string
}

export interface AnySearchSettings {
  configured: boolean
  last4?: string | null
}

export interface CloudflareSettings {
  configured: boolean
  account_id?: string | null
  token_last4?: string | null
}

/** 更新跟踪：活跃阈值 + 动态订阅开关 */
export interface TrackingSettings {
  hot_within_days: number
  stale_after_days: number
  event_push: boolean
  event_release: boolean
  event_stars_delta: boolean
  event_meta_change: boolean
}

export interface ExportData {
  exported_at: string
  version: string | number
  bookmarks: Bookmark[]
  folders: Folder[]
  tags: Tag[]
  update_events?: unknown[]
}

export type InsightsRange = "7d" | "30d" | "all"

export interface FeedStatsResponse {
  range: InsightsRange
  summary: {
    total_events: number
    today_events: number
    active_bookmarks: number
    tracked_bookmarks: number
  }
  events_by_type: Array<{ event_type: string; count: number }>
  daily: Array<{ date: string; count: number }>
}

export interface InsightsResponse {
  range: InsightsRange
  library: {
    total: number
    added_in_range: number
    folders: number
    tags: number
    ai_status: Record<string, number>
  }
  composition: {
    languages: Array<{ name: string; count: number }>
    health: Array<{ status: string; label: string; count: number }>
    folders: Array<{
      folder_id: string | null
      name: string
      count: number
    }>
    sources: Array<{ source_type: string; count: number }>
  }
  engagement: {
    top_clicked: Array<{
      id: string
      title: string
      external_id: string
      click_count: number
    }>
    top_tags: Array<{
      id: string
      name: string
      slug: string
      usage_count: number
    }>
  }
  tracking: {
    tracked: number
    untracked: number
    events_by_type: Array<{ event_type: string; count: number }>
    sync_issues: Record<string, number>
  }
  ai: {
    calls: number
    ok: number
    error: number
    tokens: { prompt: number; completion: number; total: number }
    by_model: Array<{
      model: string
      calls: number
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }>
    by_kind: Array<{ kind: string; calls: number; total_tokens: number }>
    daily: Array<{ date: string; calls: number; tokens: number }>
    estimated_cost_usd: number | null
  }
}

