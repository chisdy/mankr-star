import type { BookmarksQueryParams } from "./types"

export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const,
    status: ["auth", "status"] as const,
  },
  bookmarks: {
    all: ["bookmarks"] as const,
    list: (params?: BookmarksQueryParams) => ["bookmarks", "list", params] as const,
    /** 追加模式的分页缓存与传统列表分开，避免两种形态互相污染 */
    infinite: (params?: BookmarksQueryParams) =>
      ["bookmarks", "infinite", params] as const,
    detail: (id: string) => ["bookmarks", "detail", id] as const,
    /** 排行榜；挂在 bookmarks 前缀下，互动写操作后随列表一起失效 */
    rankings: ["bookmarks", "rankings"] as const,
    /** 挂在 bookmarks 前缀下，invalidate bookmarks.all 时一并刷新 */
    ownersInfinite: (sourceType?: string, q?: string) =>
      ["bookmarks", "owners", sourceType ?? "github", "infinite", q ?? ""] as const,
    sitesInfinite: (q?: string) =>
      ["bookmarks", "sites", "infinite", q ?? ""] as const,
  },
  /**
   * 已赞 id 集合。刻意不挂 bookmarks 前缀：写操作普遍 invalidate bookmarks.all，
   * 挂进去会让每次打开外链都白白重拉一次已赞列表。
   */
  bookmarkLikes: {
    mine: ["bookmark-likes", "mine"] as const,
  },
  folders: {
    all: ["folders"] as const,
  },
  tags: {
    all: ["tags"] as const,
    /** 前缀仍是 tags，invalidate tags.all 时 facet 分页缓存一并失效 */
    infinite: (q?: string) => ["tags", "infinite", q ?? ""] as const,
  },
  feed: {
    all: ["feed"] as const,
    list: (params?: {
      eventType?: string
      bookmarkId?: string
      page?: number
      pageSize?: number
    }) => ["feed", "list", params] as const,
    stats: (range: string) => ["feed", "stats", range] as const,
  },
  insights: {
    all: ["insights"] as const,
    range: (range: string) => ["insights", range] as const,
    cloudflareQuota: ["insights", "cloudflare-quota"] as const,
  },
  settings: {
    deepseek: ["settings", "deepseek"] as const,
    cloudflare: ["settings", "cloudflare"] as const,
  },
  apiTokens: {
    all: ["api-tokens"] as const,
  },
  import: {
    githubActive: ["import", "github", "active"] as const,
  },
  kb: {
    conversations: ["kb", "conversations"] as const,
    conversation: (id: string) => ["kb", "conversations", id] as const,
  },
}
