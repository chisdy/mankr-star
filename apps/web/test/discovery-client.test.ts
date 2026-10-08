import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/react-query"
import { discoveryResponseSchema } from "@mankr/shared"
import { queryKeys } from "../src/lib/query-keys"
import { resolveDiscoveryAccess } from "../src/features/discovery/discovery-access"
import { createMockDiscovery } from "../src/features/discovery/mock-data"
import {
  filterDiscoveryItems,
  resolveDiscoverySource,
} from "../src/features/discovery/discovery-source-filter"

describe("发现来源平台筛选", () => {
  it("URL 中的固定来源有效，缺省或未知值回退全部", () => {
    for (const source of ["github", "hn", "rss"] as const)
      expect(resolveDiscoverySource(source)).toBe(source)
    for (const value of [null, "all", "", "x", "GitHub", " github "])
      expect(resolveDiscoverySource(value)).toBe("all")
  })

  it("合并条目匹配每个证据平台一次，并保留全部证据与收藏状态", () => {
    const [repo, article] = createMockDiscovery("ai", [], true).items
    const merged = {
      ...repo!,
      savedBookmarkId: "saved-merged",
      evidence: [
        ...repo!.evidence,
        ...article!.evidence,
        article!.evidence[0]!,
      ],
    }
    for (const source of ["github", "hn", "rss"] as const) {
      const result = filterDiscoveryItems([merged], source)
      expect(result).toEqual([merged])
      expect(result[0]!.evidence).toEqual(merged.evidence)
      expect(result[0]!.savedBookmarkId).toBe("saved-merged")
    }
  })

  it("平台按来源证据匹配，不按收藏的 GitHub 或普通 URL 类型匹配", () => {
    const [repo, article] = createMockDiscovery("ai", [], true).items
    const repoFromNews = { ...repo!, evidence: article!.evidence }
    const articleFromGithub = { ...article!, evidence: repo!.evidence }
    const items = [repoFromNews, articleFromGithub]

    expect(filterDiscoveryItems(items, "github")).toEqual([articleFromGithub])
    expect(filterDiscoveryItems(items, "hn")).toEqual([repoFromNews])
    expect(filterDiscoveryItems(items, "rss")).toEqual([repoFromNews])
  })

  it("平台没有匹配条目或原始列表为空时返回空列表", () => {
    const items = createMockDiscovery("tools", [], true).items
    expect(filterDiscoveryItems(items, "rss")).toEqual([])
    expect(filterDiscoveryItems([], "all")).toEqual([])
    expect(filterDiscoveryItems([], "github")).toEqual([])
  })

  it("筛选保留输入顺序与原榜单排名，不修改条目、证据或原始列表", () => {
    const [repo, article] = createMockDiscovery("ai", [], true).items
    const items = [{ ...article!, id: "later-news", rank: 15 }, repo!, article!]
    const original = structuredClone(items)
    for (const item of items) {
      for (const evidence of item.evidence) Object.freeze(evidence)
      Object.freeze(item.evidence)
      Object.freeze(item)
    }
    Object.freeze(items)

    const result = filterDiscoveryItems(items, "hn")
    expect(result.map(({ id, rank }) => ({ id, rank }))).toEqual([
      { id: "later-news", rank: 15 },
      { id: article!.id, rank: 2 },
    ])
    expect(items).toEqual(original)
  })

  it("全部来源返回独立列表，修改列表不会改变原始数据", () => {
    const items = createMockDiscovery("ai", [], true).items
    const original = [...items]
    const result = filterDiscoveryItems(items, "all")

    expect(result).toEqual(items)
    expect(result).not.toBe(items)
    expect(result[0]).toBe(items[0])
    result.pop()
    expect(items).toEqual(original)
  })
})

describe("发现访问范围与收藏缓存", () => {
  const guest = {
    isLoading: false,
    isAuthenticated: false,
    user: null,
    status: { authenticated: false },
    statusQuery: { isError: false },
    meQuery: { isError: false },
    publicBrowsingEnabled: true,
  }

  it("等待身份确认、status 失败和已确认会话的 me 401 都停止显示缓存", () => {
    expect(resolveDiscoveryAccess({ ...guest, isLoading: true }).canRead).toBe(
      false
    )
    expect(resolveDiscoveryAccess({ ...guest, status: null }).canRead).toBe(
      false
    )
    expect(
      resolveDiscoveryAccess({ ...guest, statusQuery: { isError: true } })
        .canRead
    ).toBe(false)
    expect(
      resolveDiscoveryAccess({
        ...guest,
        status: { authenticated: true },
        user: { id: "private" },
        meQuery: { isError: true },
      }).canRead
    ).toBe(false)
  })

  it("失效会话的旧 me 用户不能开启私人访问，关闭公开浏览则禁止读取", () => {
    const access = resolveDiscoveryAccess({
      ...guest,
      user: { id: "previous-user" },
      publicBrowsingEnabled: false,
    })
    expect(access).toEqual({
      canRead: false,
      accessScope: "guest",
      publicReadEnabled: false,
    })
    const loggedIn = resolveDiscoveryAccess({
      ...guest,
      isAuthenticated: true,
      status: { authenticated: true },
      user: { id: "user-b" },
    })
    expect(loggedIn.accessScope).toBe("user-b")
    expect(loggedIn.canRead).toBe(true)
  })

  it("频道、用户、访客和公开开关分别缓存，所有频道随收藏前缀失效", async () => {
    const client = new QueryClient()
    const keys = [
      queryKeys.bookmarks.discovery("ai", "guest", true),
      queryKeys.bookmarks.discovery("ai", "user-a", true),
      queryKeys.bookmarks.discovery("ai", "user-b", true),
      queryKeys.bookmarks.discovery("frontend", "user-a", true),
      queryKeys.bookmarks.discovery("ai", "user-a", false),
    ]
    for (const [index, key] of keys.entries())
      client.setQueryData(key, { index })
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(5)
    for (const [index, key] of keys.entries())
      expect(client.getQueryData(key)).toEqual({ index })
    const channelsKey = queryKeys.discovery.channels("user-a", true)
    client.setQueryData(channelsKey, { enabled: true, ready: true })
    await client.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
    for (const key of keys)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryState(channelsKey)?.isInvalidated).toBe(false)
    client.clear()
  })

  it("示例数据遵循共享契约且保留 null、零和负增长", () => {
    for (const channel of ["ai", "frontend", "backend", "tools"] as const) {
      const response = createMockDiscovery(channel, [], false)
      expect(discoveryResponseSchema.safeParse(response).success).toBe(true)
      expect(response.items.every((item) => !("savedBookmarkId" in item))).toBe(
        true
      )
    }
    expect(
      createMockDiscovery("ai", [], true).items[0]!.evidence[0]!.growth
    ).toBeNull()
    expect(
      createMockDiscovery("frontend", [], true).items[0]!.evidence[0]!.growth
    ).toBe(0)
    expect(
      createMockDiscovery("backend", [], true).items[0]!.evidence[0]!.growth
    ).toBe(-2)
  })
})

describe("发现 API mock 共用收藏存储", () => {
  let mockApi: typeof import("../src/lib/api").api

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv("VITE_ENABLE_MOCK", "true")
    const storage = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal("window", { setTimeout: () => 0 })
    vi.stubGlobal("fetch", async () => {
      throw new Error("mock backend unavailable")
    })
    mockApi = (await import("../src/lib/api")).api
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("每日热点开关持久化并控制读接口，重新开启保留原内容与收藏", async () => {
    expect(await mockApi.getDiscoverySettings()).toEqual({
      enabled: true,
      ready: true,
    })
    const before = await mockApi.getDiscovery("tools")
    const saved = await mockApi.createBookmark({ url: before.items[0]!.url })
    expect(await mockApi.updateDiscoverySettings({ enabled: false })).toEqual({
      enabled: false,
      ready: false,
    })
    expect(await mockApi.getDiscoveryChannels()).toMatchObject({
      enabled: false,
      ready: false,
    })
    expect(await mockApi.getDiscovery("tools")).toMatchObject({
      enabled: false,
      state: "disabled",
      edition: null,
      items: [],
      sources: [],
    })

    vi.resetModules()
    mockApi = (await import("../src/lib/api")).api
    expect(await mockApi.getDiscoverySettings()).toEqual({
      enabled: false,
      ready: false,
    })
    expect(await mockApi.updateDiscoverySettings({ enabled: true })).toEqual({
      enabled: true,
      ready: true,
    })
    const restored = await mockApi.getDiscovery("tools")
    expect(restored.items.map((item) => item.id)).toEqual(
      before.items.map((item) => item.id),
    )
    expect(restored.items[0]!.savedBookmarkId).toBe(saved.id)
    expect((await mockApi.getDiscoveryChannels()).ready).toBe(true)
  })

  it("公开浏览允许读热点，但访客不能读取或修改每日热点设置", async () => {
    await mockApi.updatePublicBrowsing({ enabled: true })
    await mockApi.logout()
    expect((await mockApi.getDiscovery("ai")).enabled).toBe(true)
    await expect(mockApi.getDiscoverySettings()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    })
    await expect(
      mockApi.updateDiscoverySettings({ enabled: false }),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" })
    await mockApi.login({ username: "demo_user", password: "mock" })
    expect((await mockApi.getDiscoverySettings()).enabled).toBe(true)
  })

  it("每日热点设置使用真实 GET/PUT 契约并拒绝错误响应而不回退 mock", async () => {
    const fetch = vi.fn(async (_endpoint: string, options?: RequestInit) =>
      new Response(
        JSON.stringify({ enabled: options?.method !== "PUT", ready: false }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetch)
    expect(await mockApi.getDiscoverySettings()).toEqual({
      enabled: true,
      ready: false,
    })
    expect(fetch.mock.calls[0]![0]).toBe("/api/settings/discovery")
    expect(await mockApi.updateDiscoverySettings({ enabled: false })).toEqual({
      enabled: false,
      ready: false,
    })
    expect(fetch.mock.calls[1]![1]).toMatchObject({
      method: "PUT",
      body: '{"enabled":false}',
      credentials: "include",
    })

    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ enabled: "true", ready: false }), {
        headers: { "content-type": "application/json" },
      }),
    )
    await expect(mockApi.getDiscoverySettings()).rejects.toThrow()
    await expect(
      mockApi.updateDiscoverySettings({ enabled: true }),
    ).rejects.toThrow()
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: "expired", code: "UNAUTHORIZED" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    )
    await expect(mockApi.getDiscoverySettings()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    })
  })

  it("GitHub 收藏保留原返回形状；重复和删除立即反映到发现", async () => {
    const response = await mockApi.getDiscovery("tools")
    const item = response.items.find(
      (candidate) => candidate.sourceType === "github"
    )!
    expect(item.savedBookmarkId).toBeNull()
    const bookmark = await mockApi.createBookmark({ url: item.url })
    expect(bookmark).toMatchObject({
      source_type: "github",
      external_id: "cli/cli",
      canonical_url: "https://github.com/cli/cli",
      owner: "cli",
      title: "cli/cli",
      ai_status: "pending",
    })
    expect(
      (await mockApi.getDiscovery("tools")).items[0]!.savedBookmarkId
    ).toBe(bookmark.id)
    await expect(
      mockApi.createBookmark({ url: "cli/cli" })
    ).rejects.toMatchObject({
      status: 409,
      code: "DUPLICATE",
      details: { id: bookmark.id },
    })
    await mockApi.deleteBookmark(bookmark.id)
    expect(
      (await mockApi.getDiscovery("tools")).items[0]!.savedBookmarkId
    ).toBeNull()
  })

  it("RSS/HN 文章保存普通 URL，规范化追踪参数并按相同身份处理重复", async () => {
    const response = await mockApi.getDiscovery("ai")
    const item = response.items.find(
      (candidate) => candidate.sourceType === "url"
    )!
    const bookmark = await mockApi.createBookmark({
      url: `${item.url}?utm_source=discovery#section`,
    })
    expect(bookmark).toMatchObject({
      source_type: "url",
      canonical_url: item.url,
      owner: "huggingface.co",
      site_name: "huggingface.co",
    })
    expect(bookmark.canonical_url).not.toContain("github.com")
    expect((await mockApi.getDiscovery("ai")).items[1]!.savedBookmarkId).toBe(
      bookmark.id
    )
    await expect(
      mockApi.createBookmark({ url: item.url })
    ).rejects.toMatchObject({
      status: 409,
      code: "DUPLICATE",
      details: { id: bookmark.id },
    })
    await mockApi.updateBookmark(bookmark.id, { archived: true })
    expect((await mockApi.getDiscovery("ai")).items[1]!.savedBookmarkId).toBe(
      bookmark.id
    )
    await mockApi.deleteBookmark(bookmark.id)
    expect(
      (await mockApi.getDiscovery("ai")).items[1]!.savedBookmarkId
    ).toBeNull()
    expect((await mockApi.createBookmark({ url: item.url })).source_type).toBe(
      "url"
    )
  })

  it("退出后访客省略私人收藏字段，关闭公开浏览读和收藏均 401", async () => {
    await mockApi.updatePublicBrowsing({ enabled: true })
    await mockApi.logout()
    expect((await mockApi.getInstanceStatus()).authenticated).toBe(false)
    const response = await mockApi.getDiscovery("frontend")
    expect(response.items.every((item) => !("savedBookmarkId" in item))).toBe(
      true
    )
    await expect(
      mockApi.createBookmark({ url: response.items[0]!.url })
    ).rejects.toMatchObject({ status: 401 })
    await mockApi.login({ username: "demo_user", password: "mock" })
    expect(
      (await mockApi.getDiscovery("frontend")).items[0]!.savedBookmarkId
    ).toBe("bm-1")
    await mockApi.updatePublicBrowsing({ enabled: false })
    await mockApi.logout()
    await expect(mockApi.getDiscoveryChannels()).rejects.toMatchObject({
      status: 401,
    })
    await expect(mockApi.getDiscovery("frontend")).rejects.toMatchObject({
      status: 401,
    })
  })

  it("软删除的普通 URL 重新收藏复用已有 ID，并刷新发现中的收藏状态", async () => {
    const item = (await mockApi.getDiscovery("ai")).items[1]!
    const bookmark = await mockApi.createBookmark({ url: item.url })
    const stored = JSON.parse(
      localStorage.getItem("mankr_star_mock_data")!
    ) as { bookmarks: Array<{ id: string; deleted_at?: string | null }> }
    stored.bookmarks.find(
      (candidate) => candidate.id === bookmark.id
    )!.deleted_at = new Date().toISOString()
    localStorage.setItem("mankr_star_mock_data", JSON.stringify(stored))
    vi.resetModules()
    mockApi = (await import("../src/lib/api")).api
    expect(
      (await mockApi.getDiscovery("ai")).items[1]!.savedBookmarkId
    ).toBeNull()
    const restored = await mockApi.createBookmark({
      url: `${item.url}#section`,
    })
    expect(restored.id).toBe(bookmark.id)
    expect(restored.deleted_at).toBeNull()
    expect((await mockApi.getDiscovery("ai")).items[1]!.savedBookmarkId).toBe(
      bookmark.id
    )
  })

  it("其他入口批量归档仍算已收藏，批量删除使不同频道的状态收敛", async () => {
    const repo = (await mockApi.getDiscovery("tools")).items[0]!
    const article = (await mockApi.getDiscovery("ai")).items[1]!
    const savedRepo = await mockApi.createBookmark({ url: repo.url })
    const savedArticle = await mockApi.createBookmark({ url: article.url })
    const ids = [savedRepo.id, savedArticle.id]

    expect(await mockApi.batchBookmarks(ids, { type: "archive" })).toEqual({
      ok: true,
      processed: 2,
      failed: [],
    })
    expect(
      (await mockApi.getDiscovery("tools")).items[0]!.savedBookmarkId
    ).toBe(savedRepo.id)
    expect((await mockApi.getDiscovery("ai")).items[1]!.savedBookmarkId).toBe(
      savedArticle.id
    )
    await mockApi.batchBookmarks(ids, { type: "unarchive" })
    await mockApi.batchBookmarks(ids, { type: "delete" })
    expect(
      (await mockApi.getDiscovery("tools")).items[0]!.savedBookmarkId
    ).toBeNull()
    expect(
      (await mockApi.getDiscovery("ai")).items[1]!.savedBookmarkId
    ).toBeNull()
  })

  it("GitHub 大小写重复与软删除恢复沿用同一收藏身份", async () => {
    const item = (await mockApi.getDiscovery("tools")).items[0]!
    const bookmark = await mockApi.createBookmark({ url: item.url })
    await expect(
      mockApi.createBookmark({ url: "https://github.com/CLI/CLI.git" })
    ).rejects.toMatchObject({
      status: 409,
      code: "DUPLICATE",
      details: { id: bookmark.id },
    })
    const stored = JSON.parse(
      localStorage.getItem("mankr_star_mock_data")!
    ) as { bookmarks: Array<{ id: string; deleted_at?: string | null }> }
    stored.bookmarks.find(
      (candidate) => candidate.id === bookmark.id
    )!.deleted_at = new Date().toISOString()
    localStorage.setItem("mankr_star_mock_data", JSON.stringify(stored))
    vi.resetModules()
    mockApi = (await import("../src/lib/api")).api
    expect(
      (await mockApi.getDiscovery("tools")).items[0]!.savedBookmarkId
    ).toBeNull()
    const restored = await mockApi.createBookmark({ url: "CLI/CLI" })
    expect(restored.id).toBe(bookmark.id)
    expect(restored.deleted_at).toBeNull()
    expect(
      (await mockApi.getDiscovery("tools")).items[0]!.savedBookmarkId
    ).toBe(bookmark.id)
  })

  it("真实 401 不进入 mock；频道响应读取 shared schema 并拒绝无效契约", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ error: "expired", code: "UNAUTHORIZED" }),
          { status: 401, headers: { "content-type": "application/json" } }
        )
    )
    await expect(mockApi.getDiscovery("ai")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
      backendUnavailable: false,
    })
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            enabled: true,
            ready: false,
            channels: [
              { id: "ai" },
              { id: "frontend" },
              { id: "backend" },
              { id: "tools" },
            ],
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
    expect(await mockApi.getDiscoveryChannels()).toMatchObject({
      enabled: true,
      ready: false,
    })
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ enabled: true, ready: false, channels: [] }),
          { headers: { "content-type": "application/json" } }
        )
    )
    await expect(mockApi.getDiscoveryChannels()).rejects.toThrow()
  })
})
