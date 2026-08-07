import {
  DEFAULT_BOOKMARK_PAGE_SIZE,
  DEFAULT_BOOKMARK_PAGINATION_MODE,
  slugify,
  type KbConversationDetail,
  type KbConversationSummary,
  type KbStoredMessage,
} from "@mankr/shared"
import type {
  AnySearchSettings,
  Bookmark,
  BookmarkPaginationSettings,
  BookmarkOwner,
  BookmarkSite,
  BookmarksQueryParams,
  BookmarksResponse,
  DeepSeekSettings,
  ExportData,
  Folder,
  InsightsRange,
  InsightsResponse,
  InstanceStatus,
  Tag,
  UpdateEvent,
  User,
} from "./types"
import { collectSubtreeFolderIds } from "./folder-utils"

export class ApiError extends Error {
  status: number
  code?: string
  /** 请求未到达后端（网络错误 / Worker 未部署），可安全回退 mock */
  backendUnavailable: boolean

  constructor(
    message: string,
    status: number,
    options: { code?: string; backendUnavailable?: boolean } = {}
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = options.code
    this.backendUnavailable = options.backendUnavailable ?? false
  }
}

const STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  401: "未登录或会话已过期。",
  403: "没有权限执行该操作。",
  404: "资源不存在。",
  409: "资源冲突，请检查后重试。",
  429: "请求过于频繁，请稍后再试。",
  502: "上游服务不可用，请稍后重试。",
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json")
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      ...options,
      headers,
      credentials: "include",
    })
  } catch {
    throw new ApiError("无法连接服务器，请检查网络后重试。", 0, {
      backendUnavailable: true,
    })
  }

  const isJson = (response.headers.get("content-type") || "").includes("application/json")

  if (!response.ok) {
    let message = STATUS_FALLBACK_MESSAGES[response.status] ?? "请求失败，请稍后重试。"
    let code: string | undefined

    if (isJson) {
      try {
        const data = (await response.json()) as Record<string, unknown>
        if (typeof data.error === "string") message = data.error
        else if (typeof data.message === "string") message = data.message
        if (typeof data.code === "string") code = data.code
      } catch {
        // 保留状态码默认文案
      }
    }

    // 只有「/api 根本没有被后端接管」才算后端缺失：此时 404 不会带 JSON 错误体
    throw new ApiError(message, response.status, {
      code,
      backendUnavailable: response.status === 404 && !isJson,
    })
  }

  if (response.status === 204) return {} as T
  if (!isJson) return {} as T
  return (await response.json()) as T
}

/**
 * 后端尚未部署时的本地 mock 兜底。默认关闭，只有显式设置
 * VITE_ENABLE_MOCK=true 时才启用，避免吞掉真实的 401/404/409。
 */
const MOCK_ENABLED = import.meta.env.VITE_ENABLE_MOCK === "true"

function shouldFallbackToMock(err: unknown): boolean {
  return MOCK_ENABLED && err instanceof ApiError && err.backendUnavailable
}

function emptyInsights(range: InsightsRange): InsightsResponse {
  return {
    range,
    library: {
      total: 0,
      added_in_range: 0,
      folders: 0,
      tags: 0,
      ai_status: { pending: 0, done: 0, fallback: 0, failed: 0 },
    },
    composition: { languages: [], health: [], folders: [], sources: [] },
    engagement: { top_clicked: [], top_tags: [] },
    tracking: {
      tracked: 0,
      untracked: 0,
      events_by_type: [],
      sync_issues: { error: 0, not_found: 0, forbidden: 0 },
    },
    ai: {
      calls: 0,
      ok: 0,
      error: 0,
      tokens: { prompt: 0, completion: 0, total: 0 },
      by_model: [],
      by_kind: [],
      daily: [],
      estimated_cost_usd: null,
    },
  }
}

// ---------------------------------------------------------------------------
// 后端响应 → 前端类型 的映射（后端 body 用 camelCase，响应用 snake_case）
// ---------------------------------------------------------------------------

interface ApiBookmark extends Omit<Bookmark, "folder_name"> {
  folder?: (Pick<
    Folder,
    "id" | "name" | "slug" | "color" | "parent_id" | "depth" | "path" | "path_label"
  >) | null
}

interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

function folderDisplayName(
  folder?: { path_label?: string; name: string } | null,
): string | null {
  if (!folder) return null
  return folder.path_label ?? folder.name
}

function toBookmark(raw: ApiBookmark): Bookmark {
  return {
    ...raw,
    tags: raw.tags ?? [],
    folder_name: folderDisplayName(raw.folder),
  }
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function normalizeSlug(slug?: string): string | undefined {
  const value = slug?.trim().toLowerCase()
  if (!value || !SLUG_PATTERN.test(value)) return undefined
  return value
}

function toBookmarksQuery(params?: BookmarksQueryParams): string {
  const search = new URLSearchParams()
  if (!params) return ""

  if (params.folder_id) search.set("folderId", params.folder_id)
  if (params.tag) search.set("tag", params.tag)
  if (params.language) search.set("language", params.language)
  if (params.owner) search.set("owner", params.owner)
  if (params.site) search.set("site", params.site)
  if (params.source_type) search.set("sourceType", params.source_type)
  if (params.health_status) search.set("healthStatus", params.health_status)
  if (params.has_account === true) search.set("hasAccount", "true")
  if (params.has_account === false) search.set("hasAccount", "false")
  if (params.q) search.set("q", params.q)
  if (params.page) search.set("page", String(params.page))
  if (params.limit) search.set("pageSize", String(params.limit))
  // UI 上的「包括归档」= 列表同时返回归档项
  if (params.archived) search.set("includeArchived", "true")

  if (params.sort === "stars") {
    search.set("sort", "stars")
    search.set("order", "desc")
  } else if (params.sort === "name") {
    search.set("sort", "title")
    search.set("order", "asc")
  } else if (params.sort === "updated") {
    search.set("sort", "pushed_at")
    search.set("order", "desc")
  } else {
    search.set("sort", "created_at")
    search.set("order", "desc")
  }

  const qs = search.toString()
  return qs ? `?${qs}` : ""
}

// ---------------------------------------------------------------------------
// Mock store（仅 MOCK_ENABLED 时使用）
// ---------------------------------------------------------------------------

const LOCAL_STORAGE_KEY_MOCK = "mankr_star_mock_data"

interface MockDataStore {
  user: User | null
  folders: Folder[]
  bookmarks: Bookmark[]
  tags: Tag[]
  events: UpdateEvent[]
}

function getInitialMockData(): MockDataStore {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY_MOCK)
  if (saved) {
    try {
      return JSON.parse(saved) as MockDataStore
    } catch {
      // ignore
    }
  }

  const defaultFolders: Folder[] = [
    {
      id: "fld-1",
      name: "前端框架",
      slug: "frontend-framework",
      color: "#3B82F6",
      sort_order: 10,
      description: "UI 框架、渲染库",
      parent_id: null,
      depth: 0,
      path: "/fld-1/",
      path_label: "前端框架",
      count: 2,
    },
    {
      id: "fld-2",
      name: "AI / LLM",
      slug: "ai-llm",
      color: "#06B6D4",
      sort_order: 70,
      description: "大模型、Agent、提示工程工具",
      parent_id: null,
      depth: 0,
      path: "/fld-2/",
      path_label: "AI / LLM",
      count: 1,
    },
    {
      id: "fld-3",
      name: "工具与 CLI",
      slug: "tools-cli",
      color: "#6366F1",
      sort_order: 80,
      description: "提升开发效率的命令行与桌面工具",
      parent_id: null,
      depth: 0,
      path: "/fld-3/",
      path_label: "工具与 CLI",
      count: 1,
    },
  ]

  const defaultBookmarks: Bookmark[] = [
    {
      id: "bm-1",
      source_type: "github",
      canonical_url: "https://github.com/facebook/react",
      external_id: "facebook/react",
      owner: "facebook",
      title: "facebook/react",
      description: "The library for web and native user interfaces.",
      language: "JavaScript",
      stars: 231500,
      forks: 46800,
      summary_ai: "用于构建 Web 和原生用户界面的响应式 UI 声明式组件库。",
      folder_id: "fld-1",
      folder_name: "前端框架",
      tags: ["react", "ui", "frontend"],
      notes: "常用核心基础库",
      ai_status: "done",
      track_updates: true,
      click_count: 12,
      pushed_at: new Date(Date.now() - 3600000 * 5).toISOString(),
      created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      id: "bm-2",
      source_type: "github",
      canonical_url: "https://github.com/deepseek-ai/DeepSeek-V3",
      external_id: "deepseek-ai/DeepSeek-V3",
      owner: "deepseek-ai",
      title: "deepseek-ai/DeepSeek-V3",
      description: "An open-source Mixture-of-Experts (MoE) language model.",
      language: "Python",
      stars: 64200,
      forks: 8900,
      summary_ai: "高性能开源混合专家 (MoE) 大语言模型。",
      folder_id: "fld-2",
      folder_name: "AI / LLM",
      tags: ["llm", "deepseek", "ai"],
      notes: "",
      ai_status: "done",
      track_updates: true,
      click_count: 3,
      pushed_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
  ]

  return {
    user: {
      id: "user-mock",
      username: "demo_user",
      email: "demo@mankr.star",
      deepseek_configured: false,
      deepseek_last4: null,
      deepseek_model: "deepseek-v4-flash",
      anysearch_configured: false,
      anysearch_last4: null,
      github_pat_configured: false,
      public_browsing_enabled: false,
      bookmark_pagination_mode: DEFAULT_BOOKMARK_PAGINATION_MODE,
      bookmark_page_size: DEFAULT_BOOKMARK_PAGE_SIZE,
    },
    folders: defaultFolders,
    bookmarks: defaultBookmarks,
    tags: [
      { id: "t-1", name: "react", count: 1 },
      { id: "t-2", name: "llm", count: 1 },
    ],
    events: [],
  }
}

let mockStoreCache: MockDataStore | null = null

function mockStore(): MockDataStore {
  if (!mockStoreCache) mockStoreCache = getInitialMockData()
  return mockStoreCache
}

function saveMockStore() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_MOCK, JSON.stringify(mockStore()))
  } catch {
    // ignore
  }
}

/** 按收藏实时计算文件夹计数（含子树），避免 mock 写入后 count 过期 */
function foldersWithCounts(store: MockDataStore): Folder[] {
  const direct = new Map<string, number>()
  for (const b of store.bookmarks) {
    if (b.deleted_at || !b.folder_id) continue
    direct.set(b.folder_id, (direct.get(b.folder_id) ?? 0) + 1)
  }
  return store.folders.map((f) => {
    const ids = collectSubtreeFolderIds(f.id, store.folders)
    const count = ids.reduce((sum, id) => sum + (direct.get(id) ?? 0), 0)
    return { ...f, count }
  })
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const api = {
  // Auth ---------------------------------------------------------------
  async getInstanceStatus(): Promise<InstanceStatus> {
    try {
      return await request<InstanceStatus>("/api/auth/status")
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        return {
          initialized: !!store.user,
          public_browsing_enabled: Boolean(store.user?.public_browsing_enabled),
          authenticated: !!store.user,
          bookmark_pagination_mode:
            store.user?.bookmark_pagination_mode ??
            DEFAULT_BOOKMARK_PAGINATION_MODE,
          bookmark_page_size:
            store.user?.bookmark_page_size ?? DEFAULT_BOOKMARK_PAGE_SIZE,
        }
      }
      throw err
    }
  },

  async register(data: {
    email: string
    username?: string
    password: string
  }): Promise<User> {
    try {
      const res = await request<{ user: User }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          ...(data.username ? { username: data.username } : {}),
        }),
      })
      return res.user
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (store.user) {
          throw new ApiError("本实例已初始化，无法再次注册", 409, {
            code: "INSTANCE_INITIALIZED",
          })
        }
        store.user = {
          id: "user-" + Date.now(),
          username: data.username || data.email.split("@")[0]!,
          email: data.email,
          deepseek_configured: false,
          anysearch_configured: false,
          public_browsing_enabled: false,
          bookmark_pagination_mode: DEFAULT_BOOKMARK_PAGINATION_MODE,
          bookmark_page_size: DEFAULT_BOOKMARK_PAGE_SIZE,
        }
        saveMockStore()
        return store.user
      }
      throw err
    }
  },

  async login(data: { username: string; password: string }): Promise<User> {
    try {
      const res = await request<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: data.username, password: data.password }),
      })
      return res.user
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (!store.user) {
          throw new ApiError("用户名或密码错误", 401, {
            code: "INVALID_CREDENTIALS",
          })
        }
        return store.user
      }
      throw err
    }
  },

  async logout(): Promise<void> {
    try {
      await request("/api/auth/logout", { method: "POST" })
    } catch (err) {
      // 已登出（401）或后端缺失时静默通过，其余错误抛出
      if (err instanceof ApiError && (err.status === 401 || err.backendUnavailable)) {
        return
      }
      throw err
    }
  },

  async getMe(): Promise<User> {
    try {
      return await request<User>("/api/me")
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (store.user) return store.user
        throw new ApiError("未登录", 401, { code: "UNAUTHORIZED" })
      }
      throw err
    }
  },

  // Bookmarks ----------------------------------------------------------
  async getBookmarks(params?: BookmarksQueryParams): Promise<BookmarksResponse> {
    try {
      const res = await request<Paginated<ApiBookmark>>(
        `/api/bookmarks${toBookmarksQuery(params)}`
      )
      return {
        items: res.items.map(toBookmark),
        total: res.total,
        page: res.page,
        limit: res.pageSize,
      }
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        let items = mockStore().bookmarks.filter((b) => !b.deleted_at)
        if (!params?.archived) items = items.filter((b) => !b.archived_at)
        if (params?.folder_id) {
          const allFolders = mockStore().folders
          const allowed = new Set(
            collectSubtreeFolderIds(params.folder_id, allFolders),
          )
          items = items.filter(
            (b) => b.folder_id && allowed.has(b.folder_id),
          )
        }
        if (params?.tag) items = items.filter((b) => b.tags?.includes(params.tag!))
        if (params?.language) {
          items = items.filter(
            (b) => b.language?.toLowerCase() === params.language!.toLowerCase()
          )
        }
        if (params?.owner) {
          items = items.filter(
            (b) => b.source_type === "github" && b.owner === params.owner
          )
        }
        if (params?.site) {
          items = items.filter(
            (b) =>
              b.source_type === "url" &&
              (b.site_name === params.site ||
                (!b.site_name && b.owner === params.site))
          )
        }
        if (params?.source_type) {
          items = items.filter((b) => b.source_type === params.source_type)
        }
        if (params?.health_status) {
          items = items.filter(
            (b) =>
              b.source_type === "github" &&
              b.health_status === params.health_status
          )
        }
        if (params?.has_account !== undefined) {
          items = items.filter(
            (b) =>
              b.source_type === "url" &&
              Boolean(b.account_registered) === params.has_account
          )
        }
        if (params?.q) {
          const q = params.q.toLowerCase()
          items = items.filter(
            (b) =>
              b.title.toLowerCase().includes(q) ||
              b.description?.toLowerCase().includes(q) ||
              b.summary_ai?.toLowerCase().includes(q) ||
              b.notes?.toLowerCase().includes(q) ||
              b.tags?.some((t) => t.toLowerCase().includes(q))
          )
        }
        if (params?.sort === "stars") {
          items.sort((a, b) => (b.stars || 0) - (a.stars || 0))
        } else if (params?.sort === "name") {
          items.sort((a, b) => a.title.localeCompare(b.title))
        } else if (params?.sort === "updated") {
          items.sort((a, b) => {
            const ta = a.pushed_at ? Date.parse(a.pushed_at) : 0
            const tb = b.pushed_at ? Date.parse(b.pushed_at) : 0
            return tb - ta
          })
        } else {
          items.sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        }
        // total 取过滤后的全量条数，再按 page/limit 切片，与 Worker 保持一致
        const total = items.length
        const limit = params?.limit || DEFAULT_BOOKMARK_PAGE_SIZE
        const page = params?.page || 1
        return {
          items: items.slice((page - 1) * limit, page * limit),
          total,
          page,
          limit,
        }
      }
      throw err
    }
  },

  async getBookmark(id: string): Promise<Bookmark> {
    try {
      return toBookmark(await request<ApiBookmark>(`/api/bookmarks/${id}`))
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const item = mockStore().bookmarks.find((b) => b.id === id)
        if (item) return item
        throw new ApiError("收藏不存在", 404, { code: "NOT_FOUND" })
      }
      throw err
    }
  },

  async createBookmark(data: {
    url: string
    folder_id?: string | null
    notes?: string
    track_updates?: boolean
  }): Promise<Bookmark> {
    try {
      const raw = await request<ApiBookmark>("/api/bookmarks", {
        method: "POST",
        body: JSON.stringify({
          url: data.url,
          ...(data.folder_id !== undefined ? { folderId: data.folder_id } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.track_updates !== undefined
            ? { trackUpdates: data.track_updates }
            : {}),
        }),
      })
      return toBookmark(raw)
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        const repoName = data.url
          .replace(/^https?:\/\/github\.com\//, "")
          .replace(/\/$/, "")
        const folder = store.folders.find((f) => f.id === data.folder_id)
        const newBookmark: Bookmark = {
          id: "bm-" + Date.now(),
          source_type: "github",
          canonical_url: `https://github.com/${repoName}`,
          external_id: repoName,
          owner: repoName.split("/")[0] || null,
          title: repoName,
          description: null,
          language: null,
          summary_ai: null,
          folder_id: data.folder_id || null,
          folder_name: folder ? folder.path_label ?? folder.name : null,
          tags: [],
          notes: data.notes || "",
          ai_status: "pending",
          track_updates: data.track_updates ?? true,
          click_count: 0,
          created_at: new Date().toISOString(),
        }
        store.bookmarks.unshift(newBookmark)
        saveMockStore()

        // 模拟后端 waitUntil AI：未指定文件夹时稍后自动归类
        if (!data.folder_id) {
          const bookmarkId = newBookmark.id
          window.setTimeout(() => {
            const s = mockStore()
            const idx = s.bookmarks.findIndex((b) => b.id === bookmarkId)
            const target = s.folders[0]
            if (idx < 0 || !target) return
            s.bookmarks[idx] = {
              ...s.bookmarks[idx]!,
              folder_id: target.id,
              folder_name: target.path_label ?? target.name,
              summary_ai: "（mock）自动生成的用途摘要",
              ai_status: "done",
              tags: ["mock"],
            }
            // 同步 mock 标签用量
            const existing = s.tags.find((t) => t.name === "mock")
            if (existing) {
              existing.count = (existing.count ?? 0) + 1
            } else {
              s.tags.push({ id: "t-mock", name: "mock", count: 1 })
            }
            saveMockStore()
          }, 1500)
        } else {
          window.setTimeout(() => {
            const s = mockStore()
            const idx = s.bookmarks.findIndex((b) => b.id === newBookmark.id)
            if (idx < 0) return
            s.bookmarks[idx] = {
              ...s.bookmarks[idx]!,
              summary_ai: "（mock）自动生成的用途摘要",
              ai_status: "done",
            }
            saveMockStore()
          }, 1500)
        }

        return newBookmark
      }
      throw err
    }
  },

  async updateBookmark(
    id: string,
    data: Partial<{
      summary_ai: string | null
      folder_id: string | null
      tags: string[]
      notes: string | null
      track_updates: boolean
      archived: boolean
      title: string
      account_registered: boolean
      account_username: string | null
      /** 明文仅写入时传输；空字符串清除。永不进入 mock/localStorage */
      account_password: string | null
    }>
  ): Promise<Bookmark> {
    const body: Record<string, unknown> = {}
    if (data.summary_ai !== undefined) body.summaryAi = data.summary_ai
    if (data.folder_id !== undefined) body.folderId = data.folder_id
    if (data.tags !== undefined) body.tagNames = data.tags
    if (data.notes !== undefined) body.notes = data.notes
    if (data.track_updates !== undefined) body.trackUpdates = data.track_updates
    if (data.archived !== undefined) body.archived = data.archived
    if (data.title !== undefined) body.title = data.title
    if (data.account_registered !== undefined) {
      body.accountRegistered = data.account_registered
    }
    if (data.account_username !== undefined) {
      body.accountUsername = data.account_username
    }
    if (data.account_password !== undefined) {
      body.accountPassword = data.account_password
    }

    try {
      const raw = await request<ApiBookmark>(`/api/bookmarks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
      return toBookmark(raw)
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        const idx = store.bookmarks.findIndex((b) => b.id === id)
        if (idx === -1) throw new ApiError("收藏不存在", 404, { code: "NOT_FOUND" })
        const folder = data.folder_id
          ? store.folders.find((f) => f.id === data.folder_id)
          : null
        // mock 不承载密码明文；仅可更新注册态与用户名，语义对齐服务端
        let accountUsername = store.bookmarks[idx]!.account_username ?? null
        if (data.account_username !== undefined) {
          accountUsername =
            data.account_username === null || data.account_username === ""
              ? null
              : data.account_username
        }
        const hasCredentials = Boolean(accountUsername)
        const accountRegistered = hasCredentials
          ? true
          : data.account_registered === true
        const updated: Bookmark = {
          ...store.bookmarks[idx]!,
          ...(data.summary_ai !== undefined && { summary_ai: data.summary_ai }),
          ...(data.folder_id !== undefined && {
            folder_id: data.folder_id,
            folder_name: folder ? folder.path_label ?? folder.name : null,
          }),
          ...(data.tags !== undefined && { tags: data.tags }),
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(data.track_updates !== undefined && { track_updates: data.track_updates }),
          ...(data.archived !== undefined && {
            archived_at: data.archived ? new Date().toISOString() : null,
          }),
          account_registered: accountRegistered,
          account_username: accountUsername,
          account_password_set: false,
          account_password_updated_at: null,
          updated_at: new Date().toISOString(),
        }
        store.bookmarks[idx] = updated
        saveMockStore()
        return updated
      }
      throw err
    }
  },

  /**
   * 按需解密站点密码（一次性明文）。调用方须立即写入剪贴板后丢弃，
   * 不得写入 React state / Query 缓存 / localStorage。
   */
  async copyAccountPassword(id: string): Promise<string> {
    const res = await request<{ password: string }>(
      `/api/bookmarks/${id}/account-password/copy`,
      { method: "POST" },
    )
    return res.password
  },

  async deleteBookmark(id: string): Promise<void> {
    try {
      await request(`/api/bookmarks/${id}`, { method: "DELETE" })
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        store.bookmarks = store.bookmarks.filter((b) => b.id !== id)
        saveMockStore()
        return
      }
      throw err
    }
  },

  /** 记录外链打开次数，返回更新后的收藏 */
  async recordBookmarkOpen(id: string): Promise<Bookmark> {
    try {
      const raw = await request<ApiBookmark>(`/api/bookmarks/${id}/open`, {
        method: "POST",
      })
      return toBookmark(raw)
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        const idx = store.bookmarks.findIndex((b) => b.id === id)
        if (idx === -1) throw new ApiError("收藏不存在", 404, { code: "NOT_FOUND" })
        const updated: Bookmark = {
          ...store.bookmarks[idx]!,
          click_count: (store.bookmarks[idx]!.click_count ?? 0) + 1,
          updated_at: new Date().toISOString(),
        }
        store.bookmarks[idx] = updated
        saveMockStore()
        return updated
      }
      throw err
    }
  },

  /** 触发重新生成后返回最新收藏（AI 在后台异步执行，ai_status 可能仍为 pending） */
  async regenerateAi(id: string): Promise<Bookmark> {
    try {
      await request<{ ok: boolean; ai_status: string }>(
        `/api/bookmarks/${id}/ai/regenerate`,
        { method: "POST" }
      )
      return toBookmark(await request<ApiBookmark>(`/api/bookmarks/${id}`))
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        const idx = store.bookmarks.findIndex((b) => b.id === id)
        if (idx === -1) throw new ApiError("收藏不存在", 404, { code: "NOT_FOUND" })
        store.bookmarks[idx] = { ...store.bookmarks[idx]!, ai_status: "pending" }
        saveMockStore()
        return store.bookmarks[idx]!
      }
      throw err
    }
  },

  // Folders ------------------------------------------------------------
  async getFolders(): Promise<Folder[]> {
    try {
      const res = await request<{ items: Folder[] }>("/api/folders")
      return res.items
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        return foldersWithCounts(mockStore())
      }
      throw err
    }
  },

  async createFolder(data: {
    name: string
    slug?: string
    color?: string
    description?: string
    parent_id?: string | null
  }): Promise<Folder> {
    try {
      return await request<Folder>("/api/folders", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          ...(normalizeSlug(data.slug) ? { slug: normalizeSlug(data.slug) } : {}),
          ...(data.color ? { color: data.color } : {}),
          ...(data.description ? { description: data.description } : {}),
          ...(data.parent_id !== undefined
            ? { parentId: data.parent_id }
            : {}),
        }),
      })
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        const parent = data.parent_id
          ? store.folders.find((f) => f.id === data.parent_id)
          : null
        const id = "fld-" + Date.now()
        const path = parent ? `${parent.path}${id}/` : `/${id}/`
        const depth = parent ? parent.depth + 1 : 0
        const newFolder: Folder = {
          id,
          name: data.name,
          slug: normalizeSlug(data.slug) || `folder-${store.folders.length + 1}`,
          color: data.color || "#64748B",
          description: data.description || null,
          parent_id: data.parent_id ?? null,
          depth,
          path,
          path_label: parent
            ? `${parent.path_label ?? parent.name} / ${data.name}`
            : data.name,
          sort_order: 200,
          count: 0,
        }
        store.folders.push(newFolder)
        saveMockStore()
        return newFolder
      }
      throw err
    }
  },

  async suggestFolderSlug(data: {
    name: string
    parent_id?: string | null
    exclude_id?: string | null
  }): Promise<{ slug: string; source: "ai" | "fallback" }> {
    try {
      return await request<{ slug: string; source: "ai" | "fallback" }>(
        "/api/folders/suggest-slug",
        {
          method: "POST",
          body: JSON.stringify({
            name: data.name,
            ...(data.parent_id !== undefined
              ? { parentId: data.parent_id }
              : {}),
            ...(data.exclude_id !== undefined
              ? { excludeId: data.exclude_id }
              : {}),
          }),
        },
      )
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const base =
          data.name
            .trim()
            .toLowerCase()
            .replace(/[\s_]+/g, "-")
            .replace(/[^a-z0-9-]/g, "")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 64) || "folder"
        return { slug: base, source: "fallback" }
      }
      throw err
    }
  },

  async updateFolder(
    id: string,
    data: Partial<{
      name: string
      slug: string
      color: string
      description: string
      sort_order: number
      parent_id: string | null
    }>
  ): Promise<Folder> {
    const body: Record<string, unknown> = {}
    if (data.name !== undefined) body.name = data.name
    if (data.color !== undefined) body.color = data.color
    if (data.description !== undefined) body.description = data.description
    if (data.sort_order !== undefined) body.sortOrder = data.sort_order
    if (data.parent_id !== undefined) body.parentId = data.parent_id
    const slug = normalizeSlug(data.slug)
    if (slug) body.slug = slug

    try {
      return await request<Folder>(`/api/folders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        const idx = store.folders.findIndex((f) => f.id === id)
        if (idx === -1) throw new ApiError("文件夹不存在", 404, { code: "NOT_FOUND" })
        const updated = { ...store.folders[idx]!, ...data }
        store.folders[idx] = updated
        saveMockStore()
        return updated
      }
      throw err
    }
  },

  async deleteFolder(
    id: string,
    options?: {
      bookmarkAction?: "detach" | "delete" | "move"
      moveToFolderId?: string | null
    },
  ): Promise<void> {
    const bookmarkAction = options?.bookmarkAction ?? "detach"
    const body = {
      bookmarkAction,
      ...(bookmarkAction === "move"
        ? { moveToFolderId: options?.moveToFolderId }
        : {}),
    }
    try {
      await request(`/api/folders/${id}`, {
        method: "DELETE",
        body: JSON.stringify(body),
      })
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (bookmarkAction === "delete") {
          const now = new Date().toISOString()
          store.bookmarks = store.bookmarks.map((b) =>
            b.folder_id === id
              ? { ...b, deleted_at: now, updated_at: now }
              : b,
          )
        } else if (bookmarkAction === "move" && options?.moveToFolderId) {
          const target = store.folders.find(
            (f) => f.id === options.moveToFolderId,
          )
          store.bookmarks = store.bookmarks.map((b) =>
            b.folder_id === id
              ? {
                  ...b,
                  folder_id: options.moveToFolderId!,
                  folder_name: target?.name ?? b.folder_name,
                }
              : b,
          )
        } else {
          store.bookmarks = store.bookmarks.map((b) =>
            b.folder_id === id ? { ...b, folder_id: null, folder_name: null } : b,
          )
        }
        store.folders = store.folders.filter((f) => f.id !== id)
        saveMockStore()
        return
      }
      throw err
    }
  },

  // Tags ---------------------------------------------------------------
  async getTags(): Promise<Tag[]> {
    try {
      const res = await request<{
        items: Array<{ id: string; name: string; usage_count?: number }>
      }>("/api/tags")
      return res.items.map((t) => ({
        id: t.id,
        name: t.name,
        count: t.usage_count ?? 0,
      }))
    } catch (err) {
      if (shouldFallbackToMock(err)) return mockStore().tags
      throw err
    }
  },

  async updateTag(id: string, data: { name: string }): Promise<Tag> {
    const name = data.name.trim()
    try {
      const res = await request<{
        id: string
        name: string
        usage_count?: number
      }>(`/api/tags/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      })
      return {
        id: res.id,
        name: res.name,
        count: res.usage_count ?? 0,
      }
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        const idx = store.tags.findIndex((t) => t.id === id)
        if (idx === -1) {
          throw new ApiError("标签不存在", 404, { code: "NOT_FOUND" })
        }
        const oldName = store.tags[idx]!.name
        if (name !== oldName) {
          const nextSlug = slugify(name)
          const dup = store.tags.some(
            (t) =>
              t.id !== id &&
              (t.name === name || slugify(t.name) === nextSlug),
          )
          if (dup) {
            throw new ApiError("标签名称或标识已存在", 409, {
              code: "DUPLICATE",
            })
          }
          store.tags[idx] = { ...store.tags[idx]!, name }
          store.bookmarks = store.bookmarks.map((b) => ({
            ...b,
            tags: (b.tags ?? []).map((t) => (t === oldName ? name : t)),
          }))
          saveMockStore()
        }
        return store.tags[idx]!
      }
      throw err
    }
  },

  async deleteTag(id: string): Promise<void> {
    try {
      await request(`/api/tags/${id}`, { method: "DELETE" })
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        const tag = store.tags.find((t) => t.id === id)
        if (!tag) {
          throw new ApiError("标签不存在", 404, { code: "NOT_FOUND" })
        }
        const tagName = tag.name
        store.tags = store.tags.filter((t) => t.id !== id)
        store.bookmarks = store.bookmarks.map((b) => ({
          ...b,
          tags: (b.tags ?? []).filter((t) => t !== tagName),
        }))
        saveMockStore()
        return
      }
      throw err
    }
  },

  async getOwners(opts?: {
    q?: string
    sourceType?: "github" | "twitter" | "url"
  }): Promise<BookmarkOwner[]> {
    const q = opts?.q
    const sourceType = opts?.sourceType
    try {
      const params = new URLSearchParams()
      if (q?.trim()) params.set("q", q.trim())
      if (sourceType) params.set("sourceType", sourceType)
      const search = params.toString() ? `?${params.toString()}` : ""
      const res = await request<{
        items: Array<{ name: string; usage_count?: number }>
      }>(`/api/bookmarks/owners${search}`)
      return res.items.map((o) => ({
        name: o.name,
        usage_count: o.usage_count ?? 0,
      }))
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const filterType = sourceType ?? "github"
        const counts = new Map<string, number>()
        for (const b of mockStore().bookmarks) {
          if (b.deleted_at || !b.owner || b.source_type !== filterType) continue
          if (q?.trim() && !b.owner.toLowerCase().includes(q.trim().toLowerCase())) {
            continue
          }
          counts.set(b.owner, (counts.get(b.owner) ?? 0) + 1)
        }
        return Array.from(counts.entries())
          .map(([name, usage_count]) => ({ name, usage_count }))
          .sort((a, b) => a.name.localeCompare(b.name))
      }
      throw err
    }
  },

  async getSites(q?: string): Promise<BookmarkSite[]> {
    try {
      const search = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""
      const res = await request<{
        items: Array<{ name: string; usage_count?: number }>
      }>(`/api/bookmarks/sites${search}`)
      return res.items.map((o) => ({
        name: o.name,
        usage_count: o.usage_count ?? 0,
      }))
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const counts = new Map<string, number>()
        for (const b of mockStore().bookmarks) {
          if (b.deleted_at || b.source_type !== "url") continue
          const label = b.site_name || b.owner
          if (!label) continue
          if (q?.trim() && !label.toLowerCase().includes(q.trim().toLowerCase())) {
            continue
          }
          counts.set(label, (counts.get(label) ?? 0) + 1)
        }
        return Array.from(counts.entries())
          .map(([name, usage_count]) => ({ name, usage_count }))
          .sort((a, b) => a.name.localeCompare(b.name))
      }
      throw err
    }
  },

  // Feed ---------------------------------------------------------------
  async getFeed(): Promise<UpdateEvent[]> {
    try {
      const res = await request<
        Paginated<{
          id: string
          bookmark_id: string
          event_type: UpdateEvent["event_type"]
          payload: unknown
          detected_at: string
          bookmark: { title: string; external_id: string | null } | null
        }>
      >("/api/feed?pageSize=100")
      return res.items.map((e) => ({
        id: e.id,
        bookmark_id: e.bookmark_id,
        bookmark_title: e.bookmark?.title,
        bookmark_external_id: e.bookmark?.external_id ?? undefined,
        event_type: e.event_type,
        payload_json: JSON.stringify(e.payload ?? {}),
        detected_at: e.detected_at,
      }))
    } catch (err) {
      if (shouldFallbackToMock(err)) return mockStore().events
      throw err
    }
  },

  // Insights -----------------------------------------------------------
  async getInsights(range: InsightsRange = "30d"): Promise<InsightsResponse> {
    try {
      return await request<InsightsResponse>(
        `/api/insights?range=${encodeURIComponent(range)}`,
      )
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        return emptyInsights(range)
      }
      throw err
    }
  },

  // Settings -----------------------------------------------------------
  async updateDeepSeekSettings(data: {
    api_key?: string
    model?: string
  }): Promise<DeepSeekSettings> {
    try {
      const res = await request<{
        deepseek_configured: boolean
        deepseek_last4: string | null
        deepseek_model: string
      }>("/api/settings/deepseek", {
        method: "PUT",
        body: JSON.stringify({
          ...(data.api_key ? { apiKey: data.api_key } : {}),
          ...(data.model ? { model: data.model } : {}),
        }),
      })
      return {
        configured: res.deepseek_configured,
        last4: res.deepseek_last4,
        model: res.deepseek_model,
      }
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (store.user) {
          store.user.deepseek_configured = !!data.api_key || store.user.deepseek_configured
          if (data.api_key) store.user.deepseek_last4 = data.api_key.slice(-4)
          if (data.model) store.user.deepseek_model = data.model
          saveMockStore()
        }
        return {
          configured: !!store.user?.deepseek_configured,
          last4: store.user?.deepseek_last4 ?? null,
          model: store.user?.deepseek_model || "deepseek-v4-flash",
        }
      }
      throw err
    }
  },

  async clearDeepSeekKey(): Promise<void> {
    try {
      await request("/api/settings/deepseek", { method: "DELETE" })
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (store.user) {
          store.user.deepseek_configured = false
          store.user.deepseek_last4 = null
          saveMockStore()
        }
        return
      }
      throw err
    }
  },

  async testDeepSeekConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await request<{ ok: boolean; error?: string }>(
        "/api/settings/deepseek/test",
        { method: "POST" }
      )
      return {
        success: res.ok,
        message: res.ok ? "DeepSeek API 连接正常。" : res.error || "DeepSeek API 测试失败",
      }
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        return { success: false, message: "后端未就绪，无法测试 DeepSeek 连接。" }
      }
      throw err
    }
  },

  async updateAnySearchSettings(data: {
    api_key: string
  }): Promise<AnySearchSettings> {
    try {
      const res = await request<{
        anysearch_configured: boolean
        anysearch_last4: string | null
      }>("/api/settings/anysearch", {
        method: "PUT",
        body: JSON.stringify({ apiKey: data.api_key }),
      })
      return { configured: res.anysearch_configured, last4: res.anysearch_last4 }
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (store.user) {
          store.user.anysearch_configured = true
          store.user.anysearch_last4 = data.api_key.slice(-4)
          saveMockStore()
        }
        return { configured: true, last4: data.api_key.slice(-4) }
      }
      throw err
    }
  },

  async clearAnySearchKey(): Promise<void> {
    try {
      await request("/api/settings/anysearch", { method: "DELETE" })
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (store.user) {
          store.user.anysearch_configured = false
          store.user.anysearch_last4 = null
          saveMockStore()
        }
        return
      }
      throw err
    }
  },

  async testAnySearchConnection(): Promise<{
    success: boolean
    message: string
  }> {
    try {
      const res = await request<{ ok: boolean; error?: string }>(
        "/api/settings/anysearch/test",
        { method: "POST" }
      )
      return {
        success: res.ok,
        message: res.ok
          ? "AnySearch 连接正常。"
          : res.error || "AnySearch 测试失败",
      }
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        return { success: false, message: "后端未就绪，无法测试 AnySearch 连接。" }
      }
      throw err
    }
  },

  async updateGithubPat(data: {
    pat?: string
  }): Promise<{ configured: boolean; last4?: string }> {
    try {
      const res = await request<{ github_pat_configured: boolean }>(
        "/api/settings/github-pat",
        {
          method: "PUT",
          body: JSON.stringify(data.pat ? { pat: data.pat } : { clear: true }),
        }
      )
      return {
        configured: res.github_pat_configured,
        last4: data.pat ? data.pat.slice(-4) : undefined,
      }
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (store.user) {
          store.user.github_pat_configured = !!data.pat
          store.user.github_pat_last4 = data.pat ? data.pat.slice(-4) : null
          saveMockStore()
        }
        return {
          configured: !!data.pat,
          last4: data.pat ? data.pat.slice(-4) : undefined,
        }
      }
      throw err
    }
  },

  async updateTrackingSettings(data: {
    hot_within_days?: number
    stale_after_days?: number
  }): Promise<{ hot_within_days: number; stale_after_days: number }> {
    try {
      return await request<{
        hot_within_days: number
        stale_after_days: number
      }>("/api/settings/tracking", {
        method: "PUT",
        body: JSON.stringify({
          ...(data.hot_within_days !== undefined
            ? { hotWithinDays: data.hot_within_days }
            : {}),
          ...(data.stale_after_days !== undefined
            ? { staleAfterDays: data.stale_after_days }
            : {}),
        }),
      })
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (store.user) {
          if (data.hot_within_days !== undefined) {
            store.user.hot_within_days = data.hot_within_days
          }
          if (data.stale_after_days !== undefined) {
            store.user.stale_after_days = data.stale_after_days
          }
          saveMockStore()
        }
        return {
          hot_within_days: store.user?.hot_within_days ?? 30,
          stale_after_days: store.user?.stale_after_days ?? 180,
        }
      }
      throw err
    }
  },

  async changePassword(data: {
    current_password: string
    new_password: string
  }): Promise<void> {
    try {
      await request("/api/settings/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: data.current_password,
          newPassword: data.new_password,
        }),
      })
    } catch (err) {
      if (shouldFallbackToMock(err)) return
      throw err
    }
  },

  async updatePublicBrowsing(data: {
    enabled: boolean
  }): Promise<{ public_browsing_enabled: boolean }> {
    try {
      return await request<{ public_browsing_enabled: boolean }>(
        "/api/settings/public-browsing",
        {
          method: "PUT",
          body: JSON.stringify({ enabled: data.enabled }),
        },
      )
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        if (store.user) {
          store.user.public_browsing_enabled = data.enabled
          saveMockStore()
        }
        return { public_browsing_enabled: data.enabled }
      }
      throw err
    }
  },

  async updateBookmarkPagination(
    data: Partial<BookmarkPaginationSettings>,
  ): Promise<BookmarkPaginationSettings> {
    try {
      // 请求体走 camelCase、响应走 snake_case，与 tracking 等既有设置接口一致
      return await request<BookmarkPaginationSettings>(
        "/api/settings/bookmark-pagination",
        {
          method: "PUT",
          body: JSON.stringify({
            paginationMode: data.bookmark_pagination_mode,
            pageSize: data.bookmark_page_size,
          }),
        },
      )
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        const next: BookmarkPaginationSettings = {
          bookmark_pagination_mode:
            data.bookmark_pagination_mode ??
            store.user?.bookmark_pagination_mode ??
            DEFAULT_BOOKMARK_PAGINATION_MODE,
          bookmark_page_size:
            data.bookmark_page_size ??
            store.user?.bookmark_page_size ??
            DEFAULT_BOOKMARK_PAGE_SIZE,
        }
        if (store.user) {
          Object.assign(store.user, next)
          saveMockStore()
        }
        return next
      }
      throw err
    }
  },

  // 收藏库对话存档 ------------------------------------------------------
  // 不做 mock 回退：后端不可用时历史本就无处可取，
  // 再引一套 localStorage 存档会变成两个互相打架的真相源。
  async getKbConversations(): Promise<KbConversationSummary[]> {
    const res = await request<{ items: KbConversationSummary[] }>(
      "/api/kb/conversations",
    )
    return res.items
  },

  async getKbConversation(id: string): Promise<KbConversationDetail> {
    return await request<KbConversationDetail>(
      `/api/kb/conversations/${encodeURIComponent(id)}`,
    )
  },

  async saveKbConversation(
    id: string,
    messages: KbStoredMessage[],
  ): Promise<KbConversationSummary> {
    return await request<KbConversationSummary>(
      `/api/kb/conversations/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify({ messages }) },
    )
  },

  async deleteKbConversation(id: string): Promise<void> {
    await request(`/api/kb/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  },

  async clearKbConversations(): Promise<void> {
    await request("/api/kb/conversations", { method: "DELETE" })
  },

  async getExportData(): Promise<ExportData> {
    try {
      return await request<ExportData>("/api/export")
    } catch (err) {
      if (shouldFallbackToMock(err)) {
        const store = mockStore()
        return {
          exported_at: new Date().toISOString(),
          version: 2,
          bookmarks: store.bookmarks,
          folders: store.folders,
          tags: store.tags,
        }
      }
      throw err
    }
  },
}

export const __testing = { toBookmark, toBookmarksQuery, normalizeSlug }
