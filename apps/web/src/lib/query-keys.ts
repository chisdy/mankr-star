import type { BookmarksQueryParams } from "./types"

export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const,
    status: ["auth", "status"] as const,
  },
  bookmarks: {
    all: ["bookmarks"] as const,
    list: (params?: BookmarksQueryParams) => ["bookmarks", "list", params] as const,
    detail: (id: string) => ["bookmarks", "detail", id] as const,
  },
  folders: {
    all: ["folders"] as const,
  },
  tags: {
    all: ["tags"] as const,
  },
  feed: {
    all: ["feed"] as const,
  },
  insights: {
    all: ["insights"] as const,
    range: (range: string) => ["insights", range] as const,
  },
  settings: {
    deepseek: ["settings", "deepseek"] as const,
  },
}
