/**
 * Mankr Star - Data Models & API Types
 * Aligned with TECHNICAL_DESIGN §7 and PRD.md
 */

export interface User {
  id: string
  username: string
  email?: string | null
  deepseek_configured: boolean
  deepseek_last4?: string | null
  deepseek_model?: string | null
  anysearch_configured?: boolean
  anysearch_last4?: string | null
  github_pat_configured?: boolean
  github_pat_last4?: string | null
  hot_within_days?: number
  stale_after_days?: number
  public_browsing_enabled?: boolean
  created_at?: string
  last_login_at?: string | null
}

export interface InstanceStatus {
  initialized: boolean
  public_browsing_enabled: boolean
  /** 当前请求是否带有有效 Session（软探测，不 401） */
  authenticated: boolean
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
  platform_meta?: Record<string, unknown> | null
  folder_id?: string | null
  folder_name?: string | null
  folder?: Folder | null
  tags?: string[]
  notes?: string | null
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

export interface ExportData {
  exported_at: string
  version: string | number
  bookmarks: Bookmark[]
  folders: Folder[]
  tags: Tag[]
  update_events?: unknown[]
}

export type InsightsRange = "7d" | "30d" | "all"

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

