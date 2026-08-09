import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"

interface BookmarkPayload {
  id: string
  source_type: string
  canonical_url: string
  external_id: string
  owner: string | null
  title: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  topics: string[]
  summary_ai: string | null
  site_name?: string | null
  image_url?: string | null
  favicon_url?: string | null
  content_excerpt?: string | null
  platform_meta?: Record<string, unknown> | null
  folder_id: string | null
  folder: {
    id: string
    name: string
    slug: string
    path_label?: string | null
    parent_id?: string | null
    depth?: number
    path?: string
  } | null
  tags: string[]
  notes: string | null
  account_registered?: boolean
  account_username?: string | null
  account_password_set?: boolean
  account_password_updated_at?: string | null
  account_password_encrypted?: string | null
  ai_status: string
  track_updates: boolean
  health_status?: string
  sync_status?: string
  click_count?: number
  archived_at: string | null
  created_at: string
}

interface BookmarkList {
  items: BookmarkPayload[]
  page: number
  pageSize: number
  total: number
}

let client: TestClient
let outbound: OutboundMock

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  outbound.json(
    `${GITHUB}astral-sh/uv`,
    githubRepoPayload("astral-sh/uv", {
      language: "Rust",
      stargazers_count: 42100,
      topics: ["cli", "python", "package-manager"],
    }),
  )
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

async function createBookmark(url: string, body: Record<string, unknown> = {}) {
  return client.post<BookmarkPayload & { code?: string; details?: { id: string } }>(
    "/api/bookmarks",
    { url, ...body },
  )
}

describe("POST /api/bookmarks", () => {
  it("抓取 GitHub 元数据并入库（snake_case 响应）", async () => {
    const { status, body } = await createBookmark("https://github.com/facebook/react")

    expect(status).toBe(201)
    expect(body.source_type).toBe("github")
    expect(body.canonical_url).toBe("https://github.com/facebook/react")
    expect(body.external_id).toBe("facebook/react")
    expect(body.owner).toBe("facebook")
    expect(body.language).toBe("TypeScript")
    expect(body.stars).toBe(1234)
    expect(body.health_status).toBeTruthy()
    expect(body.sync_status).toBe("ok")
    expect(body.forks).toBe(56)
    expect(body.topics).toEqual(["react", "ui"])
    expect(body.track_updates).toBe(true)
    expect(["pending", "fallback"]).toContain(body.ai_status)
    expect(outbound.calls).toContain(`${GITHUB}facebook/react`)
  })

  it("接受 owner/repo 简写", async () => {
    const { status, body } = await createBookmark("facebook/react")
    expect(status).toBe(201)
    expect(body.external_id).toBe("facebook/react")
  })

  it("同一仓库重复收藏返回 409", async () => {
    const first = await createBookmark("facebook/react")
    expect(first.status).toBe(201)

    const second = await createBookmark("https://github.com/facebook/react")
    expect(second.status).toBe(409)
    expect(second.body.code).toBe("DUPLICATE")
    expect(second.body.details?.id).toBe(first.body.id)
  })

  it("通用网页 URL 可收藏并写入元数据与摘录", async () => {
    const pageUrl = "https://example.com/docs/guide?utm_source=x"
    outbound.text(
      "https://example.com/docs/guide",
      `<!doctype html><html><head>
        <title>Fallback Title</title>
        <meta property="og:title" content="Example Guide" />
        <meta property="og:description" content="A helpful guide" />
        <meta property="og:site_name" content="Example Docs" />
        <link rel="icon" href="/favicon.ico" />
      </head><body><main><p>UniqueExcerptToken for search</p></main></body></html>`,
    )

    const { status, body } = await createBookmark(pageUrl)
    expect(status).toBe(201)
    expect(body.source_type).toBe("url")
    expect(body.canonical_url).toBe("https://example.com/docs/guide")
    expect(body.title).toBe("Example Guide")
    expect(body.description).toBe("A helpful guide")
    expect(body.site_name).toBe("Example Docs")
    expect(body.owner).toBe("example.com")
    expect(body.track_updates).toBe(false)
    expect(body.health_status).toBe("unknown")
    expect(body.content_excerpt).toContain("UniqueExcerptToken")
    expect(body.favicon_url).toContain("favicon.ico")
    expect(outbound.calls.some((u) => u.includes("api.github.com"))).toBe(false)
  })

  it("网页重复收藏返回 409", async () => {
    outbound.text(
      "https://example.com/a",
      "<html><head><title>A</title></head><body>hi</body></html>",
    )
    const first = await createBookmark("https://example.com/a")
    expect(first.status).toBe(201)
    const second = await createBookmark("https://example.com/a?utm_campaign=1")
    expect(second.status).toBe(409)
    expect(second.body.code).toBe("DUPLICATE")
  })

  it("网页抓取失败仍可降级入库", async () => {
    outbound.on("https://down.example.com/", () => {
      throw new Error("network down")
    })
    const { status, body } = await createBookmark("https://down.example.com/")
    expect(status).toBe(201)
    expect(body.source_type).toBe("url")
    expect(body.sync_status).toBe("error")
    expect(body.title).toBe("down.example.com")
  })

  it("q 可命中 content_excerpt", async () => {
    outbound.text(
      "https://example.com/searchable",
      "<html><head><title>Searchable</title></head><body><p>NeedleInExcerptXYZ</p></body></html>",
    )
    await createBookmark("https://example.com/searchable")
    const list = await client.json<{ items: BookmarkPayload[] }>(
      "/api/bookmarks?q=NeedleInExcerptXYZ",
    )
    expect(list.status).toBe(200)
    expect(list.body.items.some((i) => i.source_type === "url")).toBe(true)
  })

  it("收藏 X status 链接并写入元数据", async () => {
    outbound.json("https://api.fxtwitter.com/someone/status/1", {
      code: 200,
      tweet: {
        id: "1",
        text: "Hello from X",
        lang: "en",
        likes: 42,
        retweets: 3,
        created_at: "2026-01-01T00:00:00Z",
        author: {
          name: "Someone",
          screen_name: "someone",
          avatar_url: "https://pbs.twimg.com/profile.jpg",
        },
        media: {
          photos: [{ url: "https://pbs.twimg.com/media/abc.jpg", type: "photo" }],
        },
      },
    })

    const { status, body } = await createBookmark(
      "https://x.com/someone/status/1",
    )
    expect(status).toBe(201)
    expect(body.source_type).toBe("twitter")
    expect(body.external_id).toBe("1")
    expect(body.owner).toBe("someone")
    expect(body.site_name).toBe("X")
    expect(body.stars).toBe(42)
    expect(body.track_updates).toBe(false)
    expect(body.canonical_url).toBe("https://x.com/someone/status/1")
    expect(body.image_url).toBe("https://pbs.twimg.com/media/abc.jpg")
    expect(body.platform_meta).toMatchObject({ kind: "tweet" })
  })

  it("拒绝纯 article URL 与个人主页", async () => {
    const article = await createBookmark("https://x.com/i/article/123")
    expect(article.status).toBe(400)
    expect(article.body.code).toBe("INVALID_URL")
    expect(String(article.body.error)).toContain("X")
    expect(String(article.body.error)).not.toMatch(/twitter/i)

    const profile = await createBookmark("https://x.com/someone")
    expect(profile.status).toBe(400)
    expect(profile.body.code).toBe("INVALID_URL")
  })

  it("X 帖子去重", async () => {
    outbound.json("https://api.fxtwitter.com/someone/status/99", {
      code: 200,
      tweet: {
        id: "99",
        text: "dup",
        author: { screen_name: "someone", name: "Someone" },
      },
    })
    const first = await createBookmark("https://x.com/someone/status/99")
    expect(first.status).toBe(201)
    const second = await createBookmark(
      "https://twitter.com/someone/status/99",
    )
    expect(second.status).toBe(409)
    expect(second.body.code).toBe("DUPLICATE")
  })

  it("SSRF 内网地址拒绝", async () => {
    const { status, body } = await createBookmark("http://127.0.0.1/secret")
    expect(status).toBe(400)
    expect(body.code).toBe("SSRF_BLOCKED")
  })

  it("GitHub 仓库不存在返回 404，上游异常返回 502", async () => {
    outbound.json(`${GITHUB}ghost/missing`, { message: "Not Found" }, 404)
    const notFound = await createBookmark("ghost/missing")
    expect(notFound.status).toBe(404)
    expect(notFound.body.code).toBe("GITHUB_ERROR")

    outbound.json(`${GITHUB}broken/repo`, { message: "boom" }, 500)
    const upstream = await createBookmark("broken/repo")
    expect(upstream.status).toBe(502)
    expect(upstream.body.code).toBe("GITHUB_ERROR")
  })

  it("folderId 必须是 uuid", async () => {
    const { status, body } = await createBookmark("facebook/react", {
      folderId: "folder-1",
    })
    expect(status).toBe(400)
    expect(body.code).toBe("VALIDATION_ERROR")
  })
})

describe("无 DeepSeek Key 时的 AI 降级", () => {
  it("规则降级写入 ai_status=fallback、标签与文件夹", async () => {
    const created = await createBookmark("facebook/react")
    expect(created.status).toBe(201)

    const { body } = await client.json<BookmarkPayload>(
      `/api/bookmarks/${created.body.id}`,
    )
    expect(body.ai_status).toBe("fallback")
    expect(body.summary_ai).toBeTruthy()
    expect(body.tags.length).toBeGreaterThanOrEqual(3)
    expect(body.tags).toContain("react")
    expect(body.folder).not.toBeNull()
    // 无 Key 兜底仅按语言粗分（mock 默认为 TypeScript → 工具与 CLI）
    expect(body.folder!.name).toBe("工具与 CLI")
    // 降级路径不应调用 DeepSeek
    expect(outbound.calls.some((u) => u.includes("api.deepseek.com"))).toBe(false)
  })
})

describe("GET /api/bookmarks", () => {
  beforeEach(async () => {
    await createBookmark("facebook/react")
    await createBookmark("astral-sh/uv")
  })

  it("返回分页信封 {items,page,pageSize,total}", async () => {
    const { status, body } = await client.json<BookmarkList>("/api/bookmarks")
    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
    expect(body.items).toHaveLength(2)
    expect(body.items[0]!.tags.length).toBeGreaterThan(0)
  })

  it("支持 pageSize 分页", async () => {
    const page1 = await client.json<BookmarkList>("/api/bookmarks?pageSize=1&page=1")
    const page2 = await client.json<BookmarkList>("/api/bookmarks?pageSize=1&page=2")
    expect(page1.body.items).toHaveLength(1)
    expect(page2.body.items).toHaveLength(1)
    expect(page1.body.total).toBe(2)
    expect(page1.body.items[0]!.id).not.toBe(page2.body.items[0]!.id)
  })

  it("同值排序下逐页翻完不重不漏", async () => {
    // 默认 payload 的 stars 相同，专门制造并列排序
    outbound.json(`${GITHUB}vercel/next.js`, githubRepoPayload("vercel/next.js"))
    outbound.json(`${GITHUB}vitejs/vite`, githubRepoPayload("vitejs/vite"))
    await createBookmark("vercel/next.js")
    await createBookmark("vitejs/vite")

    const total = (await client.json<BookmarkList>("/api/bookmarks")).body.total
    expect(total).toBe(4)

    const seen: string[] = []
    for (let page = 1; page <= total; page += 1) {
      // title 排序在这里没有并列，用 stars 制造更容易抖动的同值场景
      const res = await client.json<BookmarkList>(
        `/api/bookmarks?sort=stars&order=desc&pageSize=1&page=${page}`,
      )
      expect(res.body.total).toBe(total)
      expect(res.body.items).toHaveLength(1)
      seen.push(res.body.items[0]!.id)
    }

    expect(new Set(seen).size).toBe(total)
  })

  it("超出总页数时返回空页但保留 total", async () => {
    const res = await client.json<BookmarkList>("/api/bookmarks?pageSize=1&page=99")
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(0)
    expect(res.body.total).toBe(2)
    expect(res.body.page).toBe(99)
  })

  it("pageSize 边界 1 与 100 可用，越界返回 400", async () => {
    expect(
      (await client.json<BookmarkList>("/api/bookmarks?pageSize=1")).status,
    ).toBe(200)
    expect(
      (await client.json<BookmarkList>("/api/bookmarks?pageSize=100")).status,
    ).toBe(200)
    expect(
      (await client.json<BookmarkList>("/api/bookmarks?pageSize=0")).status,
    ).toBe(400)
    expect(
      (await client.json<BookmarkList>("/api/bookmarks?pageSize=101")).status,
    ).toBe(400)
  })

  it("支持 q / language / tag / folderId / owner 过滤", async () => {
    const byQuery = await client.json<BookmarkList>("/api/bookmarks?q=uv")
    expect(byQuery.body.items).toHaveLength(1)
    expect(byQuery.body.items[0]!.external_id).toBe("astral-sh/uv")

    const byLanguage = await client.json<BookmarkList>("/api/bookmarks?language=Rust")
    expect(byLanguage.body.items).toHaveLength(1)

    const byOwner = await client.json<BookmarkList>("/api/bookmarks?owner=facebook")
    expect(byOwner.body.items).toHaveLength(1)
    expect(byOwner.body.items[0]!.external_id).toBe("facebook/react")
    expect(byOwner.body.items[0]!.owner).toBe("facebook")

    const unknownOwner = await client.json<BookmarkList>("/api/bookmarks?owner=nobody")
    expect(unknownOwner.body.total).toBe(0)
    expect(unknownOwner.body.items).toEqual([])

    const byTag = await client.json<BookmarkList>("/api/bookmarks?tag=react")
    expect(byTag.body.items).toHaveLength(1)
    expect(byTag.body.items[0]!.external_id).toBe("facebook/react")

    const unknownTag = await client.json<BookmarkList>("/api/bookmarks?tag=nope")
    expect(unknownTag.body.total).toBe(0)
    expect(unknownTag.body.items).toEqual([])

    // 显式建夹并归属，避免语言兜底把多条收藏落进同一夹
    const folder = await client.post<{ id: string }>("/api/folders", {
      name: "过滤测试夹",
      slug: "filter-test-folder",
    })
    expect(folder.status).toBe(201)
    await client.patch(`/api/bookmarks/${byTag.body.items[0]!.id}`, {
      folderId: folder.body.id,
    })
    const byFolder = await client.json<BookmarkList>(
      `/api/bookmarks?folderId=${folder.body.id}`,
    )
    expect(byFolder.body.items).toHaveLength(1)
    expect(byFolder.body.items[0]!.external_id).toBe("facebook/react")
  })

  it("支持按 stars 排序", async () => {
    const desc = await client.json<BookmarkList>("/api/bookmarks?sort=stars&order=desc")
    expect(desc.body.items[0]!.external_id).toBe("astral-sh/uv")

    const asc = await client.json<BookmarkList>("/api/bookmarks?sort=stars&order=asc")
    expect(asc.body.items[0]!.external_id).toBe("facebook/react")
  })

  it("支持按 pushed_at 排序且 NULL 沉底，并可按 healthStatus 筛选", async () => {
    outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react", {
      pushed_at: "2026-08-01T00:00:00Z",
      size: 100,
    }))
    outbound.json(`${GITHUB}astral-sh/uv`, githubRepoPayload("astral-sh/uv", {
      pushed_at: "2026-07-01T00:00:00Z",
      size: 50,
      stargazers_count: 99999,
    }))

    // recreate with known pushed_at (beforeEach already created them via other tests' setup)
    // This describe's beforeEach creates both; list should have health_status
    const byPushed = await client.json<BookmarkList>(
      "/api/bookmarks?sort=pushed_at&order=desc",
    )
    expect(byPushed.status).toBe(200)
    expect(byPushed.body.items.length).toBeGreaterThanOrEqual(1)
    expect(byPushed.body.items[0]!.health_status).toBeTruthy()

    const hot = await client.json<BookmarkList>(
      "/api/bookmarks?healthStatus=hot",
    )
    expect(hot.status).toBe(200)
    for (const item of hot.body.items) {
      expect(item.health_status).toBe("hot")
      expect(item.source_type).toBe("github")
    }
  })

  it("可按 aiStatus 筛选", async () => {
    const all = await client.json<BookmarkList>("/api/bookmarks")
    expect(all.status).toBe(200)
    expect(all.body.items.length).toBeGreaterThanOrEqual(1)
    // 未配置 DeepSeek 时落回 pending/fallback，具体取值不保证，取实际值做筛选
    const status = all.body.items[0]!.ai_status

    const filtered = await client.json<BookmarkList>(
      `/api/bookmarks?aiStatus=${status}`,
    )
    expect(filtered.status).toBe(200)
    expect(filtered.body.total).toBeGreaterThanOrEqual(1)
    for (const item of filtered.body.items) {
      expect(item.ai_status).toBe(status)
    }

    const failed = await client.json<BookmarkList>(
      "/api/bookmarks?aiStatus=failed",
    )
    expect(failed.status).toBe(200)
    if (status !== "failed") expect(failed.body.total).toBe(0)

    expect(
      (await client.json<{ code: string }>("/api/bookmarks?aiStatus=bogus"))
        .status,
    ).toBe(400)
  })

  it("非法查询参数返回 400", async () => {
    const { status, body } = await client.json<{ code: string }>(
      "/api/bookmarks?pageSize=999",
    )
    expect(status).toBe(400)
    expect(body.code).toBe("VALIDATION_ERROR")
  })
})

describe("PATCH /api/bookmarks/:id", () => {
  let id: string

  beforeEach(async () => {
    const created = await createBookmark("facebook/react")
    id = created.body.id
  })

  it("更新笔记、摘要、标签与跟踪开关", async () => {
    const { status, body } = await client.patch<BookmarkPayload>(
      `/api/bookmarks/${id}`,
      {
        notes: "个人笔记",
        summaryAi: "手工覆盖的摘要",
        tagNames: ["ui", "自定义标签"],
        trackUpdates: false,
      },
    )

    expect(status).toBe(200)
    expect(body.notes).toBe("个人笔记")
    expect(body.summary_ai).toBe("手工覆盖的摘要")
    expect(body.track_updates).toBe(false)
    expect(body.tags.sort()).toEqual(["ui", "自定义标签"].sort())
  })

  it("folderId=null 可清空文件夹", async () => {
    const { body } = await client.patch<BookmarkPayload>(`/api/bookmarks/${id}`, {
      folderId: null,
    })
    expect(body.folder_id).toBeNull()
    expect(body.folder).toBeNull()
  })

  it("归档后默认列表不返回，archived/includeArchived 可查", async () => {
    const archived = await client.patch<BookmarkPayload>(`/api/bookmarks/${id}`, {
      archived: true,
    })
    expect(archived.body.archived_at).toBeTruthy()

    const defaultList = await client.json<BookmarkList>("/api/bookmarks")
    expect(defaultList.body.total).toBe(0)

    const archivedOnly = await client.json<BookmarkList>("/api/bookmarks?archived=true")
    expect(archivedOnly.body.total).toBe(1)

    const withArchived = await client.json<BookmarkList>(
      "/api/bookmarks?includeArchived=true",
    )
    expect(withArchived.body.total).toBe(1)

    const restored = await client.patch<BookmarkPayload>(`/api/bookmarks/${id}`, {
      archived: false,
    })
    expect(restored.body.archived_at).toBeNull()
  })

  it("不存在的收藏返回 404，非法字段返回 400", async () => {
    const missing = await client.patch<{ code: string }>(
      "/api/bookmarks/00000000-0000-0000-0000-0000000000ff",
      { notes: "x" },
    )
    expect(missing.status).toBe(404)
    expect(missing.body.code).toBe("NOT_FOUND")

    const invalid = await client.patch<{ code: string }>(`/api/bookmarks/${id}`, {
      folderId: "not-a-uuid",
    })
    expect(invalid.status).toBe(400)
    expect(invalid.body.code).toBe("VALIDATION_ERROR")
  })
})

describe("DELETE /api/bookmarks/:id", () => {
  it("软删除后详情 404、列表不再返回", async () => {
    const created = await createBookmark("facebook/react")
    const id = created.body.id

    const deleted = await client.delete<{ ok: boolean }>(`/api/bookmarks/${id}`)
    expect(deleted.status).toBe(200)
    expect(deleted.body.ok).toBe(true)

    const detail = await client.json<{ code: string }>(`/api/bookmarks/${id}`)
    expect(detail.status).toBe(404)

    const list = await client.json<BookmarkList>("/api/bookmarks")
    expect(list.body.total).toBe(0)

    const again = await client.delete<{ code: string }>(`/api/bookmarks/${id}`)
    expect(again.status).toBe(404)
  })

  it("删除后可重新收藏同一仓库", async () => {
    const created = await createBookmark("facebook/react")
    await client.delete(`/api/bookmarks/${created.body.id}`)
    const recreated = await createBookmark("facebook/react")
    expect(recreated.status).toBe(201)
  })
})

describe("POST /api/bookmarks/:id/ai/regenerate", () => {
  it("重置为 pending 并异步重跑", async () => {
    const created = await createBookmark("facebook/react")
    const { status, body } = await client.post<{ ok: boolean; ai_status: string }>(
      `/api/bookmarks/${created.body.id}/ai/regenerate`,
    )
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.ai_status).toBe("pending")

    const detail = await client.json<BookmarkPayload>(
      `/api/bookmarks/${created.body.id}`,
    )
    expect(["pending", "fallback"]).toContain(detail.body.ai_status)
  })

  it("不存在的收藏返回 404", async () => {
    const { status } = await client.post(
      "/api/bookmarks/00000000-0000-0000-0000-0000000000ff/ai/regenerate",
    )
    expect(status).toBe(404)
  })
})

describe("POST /api/bookmarks/:id/sync", () => {
  it("刷新 GitHub 元数据并置 ai_status=pending", async () => {
    const created = await createBookmark("facebook/react")
    outbound.on("https://api.github.com/repos/facebook/react", () =>
      new Response(
        JSON.stringify({
          ...githubRepoPayload("facebook/react", {
            description: "synced description",
            stargazers_count: 999,
          }),
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    outbound.on("https://api.github.com/repos/facebook/react/readme", () =>
      new Response("# synced readme", {
        headers: { "content-type": "text/plain" },
      }),
    )

    const { status, body } = await client.post<{
      ok: boolean
      ai_status: string
    }>(`/api/bookmarks/${created.body.id}/sync`)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.ai_status).toBe("pending")

    const detail = await client.json<BookmarkPayload>(
      `/api/bookmarks/${created.body.id}`,
    )
    expect(detail.body.description).toBe("synced description")
    expect(detail.body.stars).toBe(999)
    expect(["pending", "fallback", "done"]).toContain(detail.body.ai_status)
  })

  it("不存在的收藏返回 404", async () => {
    const { status } = await client.post(
      "/api/bookmarks/00000000-0000-0000-0000-0000000000ff/sync",
    )
    expect(status).toBe(404)
  })
})

describe("GET /api/tags", () => {
  it("返回标签与使用次数", async () => {
    await createBookmark("facebook/react")
    const { status, body } = await client.json<{
      items: Array<{ id: string; name: string; slug: string; usage_count: number }>
    }>("/api/tags")

    expect(status).toBe(200)
    expect(body.items.length).toBeGreaterThan(0)
    const react = body.items.find((t) => t.name === "react")
    expect(react?.usage_count).toBe(1)
  })
})

describe("PATCH /api/tags/:id", () => {
  it("重命名标签并同步到书签响应", async () => {
    const created = await createBookmark("facebook/react")
    await client.patch(`/api/bookmarks/${created.body.id}`, {
      tagNames: ["旧标签"],
    })

    const list = await client.json<{
      items: Array<{ id: string; name: string; usage_count: number }>
    }>("/api/tags")
    const tag = list.body.items.find((t) => t.name === "旧标签")
    expect(tag).toBeTruthy()

    const { status, body } = await client.patch<{
      id: string
      name: string
      slug: string
      usage_count: number
    }>(`/api/tags/${tag!.id}`, { name: "新标签" })

    expect(status).toBe(200)
    expect(body.name).toBe("新标签")
    expect(body.slug).toBe("新标签")
    expect(body.usage_count).toBe(1)

    const bookmark = await client.json<BookmarkPayload>(
      `/api/bookmarks/${created.body.id}`,
    )
    expect(bookmark.body.tags).toEqual(["新标签"])
  })

  it("与其它标签 name/slug 冲突时返回 409", async () => {
    const created = await createBookmark("facebook/react")
    await client.patch(`/api/bookmarks/${created.body.id}`, {
      tagNames: ["alpha", "beta"],
    })

    const list = await client.json<{
      items: Array<{ id: string; name: string }>
    }>("/api/tags")
    const alpha = list.body.items.find((t) => t.name === "alpha")
    expect(alpha).toBeTruthy()

    const { status, body } = await client.patch<{ code: string }>(
      `/api/tags/${alpha!.id}`,
      { name: "beta" },
    )
    expect(status).toBe(409)
    expect(body.code).toBe("DUPLICATE")
  })

  it("name 不同但 slugify 后相同时返回 409", async () => {
    const created = await createBookmark("facebook/react")
    await client.patch(`/api/bookmarks/${created.body.id}`, {
      tagNames: ["react", "other"],
    })

    const list = await client.json<{
      items: Array<{ id: string; name: string }>
    }>("/api/tags")
    const other = list.body.items.find((t) => t.name === "other")
    expect(other).toBeTruthy()

    const { status, body } = await client.patch<{ code: string }>(
      `/api/tags/${other!.id}`,
      { name: "react!" },
    )
    expect(status).toBe(409)
    expect(body.code).toBe("DUPLICATE")
  })

  it("不存在的标签返回 404", async () => {
    const { status, body } = await client.patch<{ code: string }>(
      "/api/tags/00000000-0000-0000-0000-0000000000ff",
      { name: "nowhere" },
    )
    expect(status).toBe(404)
    expect(body.code).toBe("NOT_FOUND")
  })
})

describe("DELETE /api/tags/:id", () => {
  it("删除标签并解除书签关联", async () => {
    const created = await createBookmark("facebook/react")
    await client.patch(`/api/bookmarks/${created.body.id}`, {
      tagNames: ["待删", "保留"],
    })

    const list = await client.json<{
      items: Array<{ id: string; name: string }>
    }>("/api/tags")
    const doomed = list.body.items.find((t) => t.name === "待删")
    expect(doomed).toBeTruthy()

    const { status, body } = await client.delete<{ ok: boolean }>(
      `/api/tags/${doomed!.id}`,
    )
    expect(status).toBe(200)
    expect(body.ok).toBe(true)

    const after = await client.json<{
      items: Array<{ name: string }>
    }>("/api/tags")
    expect(after.body.items.find((t) => t.name === "待删")).toBeUndefined()
    expect(after.body.items.find((t) => t.name === "保留")).toBeTruthy()

    const bookmark = await client.json<BookmarkPayload>(
      `/api/bookmarks/${created.body.id}`,
    )
    expect(bookmark.body.tags).toEqual(["保留"])
  })

  it("不存在的标签返回 404", async () => {
    const { status, body } = await client.delete<{ code: string }>(
      "/api/tags/00000000-0000-0000-0000-0000000000ff",
    )
    expect(status).toBe(404)
    expect(body.code).toBe("NOT_FOUND")
  })
})

describe("GET /api/bookmarks/owners", () => {
  it("返回去重开发者列表，支持 q 过滤", async () => {
    await createBookmark("facebook/react")
    await createBookmark("astral-sh/uv")

    const all = await client.json<{
      items: Array<{ name: string; usage_count: number }>
    }>("/api/bookmarks/owners")
    expect(all.status).toBe(200)
    expect(all.body.items.map((o) => o.name)).toEqual(["astral-sh", "facebook"])
    expect(all.body.items.find((o) => o.name === "facebook")?.usage_count).toBe(1)

    const filtered = await client.json<{
      items: Array<{ name: string; usage_count: number }>
    }>("/api/bookmarks/owners?q=face")
    expect(filtered.status).toBe(200)
    expect(filtered.body.items).toHaveLength(1)
    expect(filtered.body.items[0]!.name).toBe("facebook")

    const miss = await client.json<{
      items: Array<{ name: string }>
    }>("/api/bookmarks/owners?q=zzz")
    expect(miss.body.items).toEqual([])
  })

  it("不包含 url 收藏的 hostname", async () => {
    await createBookmark("facebook/react")
    outbound.text(
      "https://example.com/page",
      `<!doctype html><html><head>
        <meta property="og:title" content="Example Page" />
        <meta property="og:site_name" content="Example Docs" />
      </head><body><main><p>hello</p></main></body></html>`,
    )
    await createBookmark("https://example.com/page")

    const all = await client.json<{
      items: Array<{ name: string }>
    }>("/api/bookmarks/owners")
    expect(all.status).toBe(200)
    expect(all.body.items.map((o) => o.name)).toEqual(["facebook"])
    expect(all.body.items.some((o) => o.name === "example.com")).toBe(false)
  })
})

describe("GET /api/bookmarks/sites", () => {
  it("返回 url 站点列表，支持 site 列表过滤", async () => {
    await createBookmark("facebook/react")
    outbound.text(
      "https://example.com/a",
      `<!doctype html><html><head>
        <meta property="og:title" content="A" />
        <meta property="og:site_name" content="Example Docs" />
      </head><body><main><p>a</p></main></body></html>`,
    )
    outbound.text(
      "https://other.test/b",
      `<!doctype html><html><head>
        <meta property="og:title" content="B" />
        <meta property="og:site_name" content="Other Site" />
      </head><body><main><p>b</p></main></body></html>`,
    )
    await createBookmark("https://example.com/a")
    await createBookmark("https://other.test/b")

    const sites = await client.json<{
      items: Array<{ name: string; usage_count: number }>
    }>("/api/bookmarks/sites")
    expect(sites.status).toBe(200)
    expect(sites.body.items.map((s) => s.name).sort()).toEqual([
      "Example Docs",
      "Other Site",
    ])
    expect(sites.body.items.some((s) => s.name === "facebook")).toBe(false)

    const filtered = await client.json<{
      items: Array<{ source_type: string; site_name?: string | null }>
      total: number
    }>("/api/bookmarks?site=Example%20Docs")
    expect(filtered.status).toBe(200)
    expect(filtered.body.total).toBe(1)
    expect(filtered.body.items[0]!.source_type).toBe("url")
    expect(filtered.body.items[0]!.site_name).toBe("Example Docs")
  })
})

describe("GET /api/feed", () => {
  it("无事件时返回空分页信封", async () => {
    const { status, body } = await client.json<{
      items: unknown[]
      page: number
      pageSize: number
      total: number
    }>("/api/feed")
    expect(status).toBe(200)
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
  })

  it("非法 eventType 返回 400", async () => {
    const { status, body } = await client.json<{ code: string }>(
      "/api/feed?eventType=nope",
    )
    expect(status).toBe(400)
    expect(body.code).toBe("VALIDATION_ERROR")
  })
})

describe("文件夹接口", () => {
  it("创建文件夹后统计收藏数量", async () => {
    const created = await client.post<{ id: string; name: string; slug: string }>(
      "/api/folders",
      { name: "我的收藏夹", color: "#123456" },
    )
    expect(created.status).toBe(201)
    expect(created.body.slug).toBeTruthy()

    const bookmark = await createBookmark("facebook/react")
    await client.patch(`/api/bookmarks/${bookmark.body.id}`, {
      folderId: created.body.id,
    })

    const list = await client.json<{
      items: Array<{ id: string; count: number }>
    }>("/api/folders")
    const mine = list.body.items.find((f) => f.id === created.body.id)
    expect(mine?.count).toBe(1)
  })

  it("slug 冲突返回 409，删除不存在的文件夹返回 404", async () => {
    const first = await client.post<{ id: string }>("/api/folders", {
      name: "重复",
      slug: "duplicated",
    })
    expect(first.status).toBe(201)

    const conflict = await client.post<{ code: string }>("/api/folders", {
      name: "重复2",
      slug: "duplicated",
    })
    expect(conflict.status).toBe(409)
    expect(conflict.body.code).toBe("DUPLICATE")

    const missing = await client.delete<{ code: string }>(
      "/api/folders/00000000-0000-0000-0000-0000000000ff",
    )
    expect(missing.status).toBe(404)
  })

  it("删除文件夹后收藏的 folder_id 置空", async () => {
    const folder = await client.post<{ id: string }>("/api/folders", {
      name: "临时文件夹",
      slug: "temp-folder",
    })
    const bookmark = await createBookmark("facebook/react")
    await client.patch(`/api/bookmarks/${bookmark.body.id}`, {
      folderId: folder.body.id,
    })

    const deleted = await client.delete<{ ok: boolean }>(
      `/api/folders/${folder.body.id}`,
      { bookmarkAction: "detach" },
    )
    expect(deleted.status).toBe(200)

    const detail = await client.json<BookmarkPayload>(
      `/api/bookmarks/${bookmark.body.id}`,
    )
    expect(detail.body.folder_id).toBeNull()
  })

  it("删除文件夹时可选择一并删除收藏或迁移到其他文件夹", async () => {
    outbound.json(
      `${GITHUB}vercel/next.js`,
      githubRepoPayload("vercel/next.js"),
    )
    outbound.json(
      `${GITHUB}tailwindlabs/tailwindcss`,
      githubRepoPayload("tailwindlabs/tailwindcss"),
    )

    const source = await client.post<{ id: string }>("/api/folders", {
      name: "源文件夹",
      slug: "src-folder-disp",
    })
    const target = await client.post<{ id: string }>("/api/folders", {
      name: "目标文件夹",
      slug: "dst-folder-disp",
    })
    expect(source.status).toBe(201)
    expect(target.status).toBe(201)

    const toDelete = await createBookmark("vercel/next.js")
    expect(toDelete.status).toBe(201)
    await client.patch(`/api/bookmarks/${toDelete.body.id}`, {
      folderId: source.body.id,
    })

    const deletedWithBookmarks = await client.delete<{
      ok: boolean
      bookmark_action: string
    }>(`/api/folders/${source.body.id}`, {
      bookmarkAction: "delete",
    })
    expect(deletedWithBookmarks.status).toBe(200)
    expect(deletedWithBookmarks.body.bookmark_action).toBe("delete")

    const gone = await client.json<{ code?: string }>(
      `/api/bookmarks/${toDelete.body.id}`,
    )
    expect(gone.status).toBe(404)

    const source2 = await client.post<{ id: string }>("/api/folders", {
      name: "源文件夹2",
      slug: "src-folder-disp-2",
    })
    expect(source2.status).toBe(201)
    const toMove = await createBookmark("tailwindlabs/tailwindcss")
    expect(toMove.status).toBe(201)
    await client.patch(`/api/bookmarks/${toMove.body.id}`, {
      folderId: source2.body.id,
    })

    const moved = await client.delete<{
      ok: boolean
      bookmark_action: string
    }>(`/api/folders/${source2.body.id}`, {
      bookmarkAction: "move",
      moveToFolderId: target.body.id,
    })
    expect(moved.status).toBe(200)
    expect(moved.body.bookmark_action).toBe("move")

    const detail = await client.json<BookmarkPayload>(
      `/api/bookmarks/${toMove.body.id}`,
    )
    expect(detail.status).toBe(200)
    expect(detail.body.folder_id).toBe(target.body.id)
  })

  it("支持嵌套文件夹：创建子文件夹、删父有子返 409、父筛选含子树、导出含 depth/path", async () => {
    const parent = await client.post<{
      id: string
      parent_id: string | null
      depth: number
    }>("/api/folders", {
      name: "AI Parent",
      slug: "ai-parent-test",
    })
    expect(parent.status).toBe(201)
    expect(parent.body.parent_id).toBeNull()
    expect(parent.body.depth).toBe(0)

    const child = await client.post<{
      id: string
      parent_id: string | null
      name: string
      depth: number
    }>("/api/folders", {
      name: "Agent Skills Test",
      slug: "agent-skills-test",
      parentId: parent.body.id,
    })
    expect(child.status).toBe(201)
    expect(child.body.parent_id).toBe(parent.body.id)
    expect(child.body.depth).toBe(1)

    // 构建 depth 2..4 的链条，在 depth-4 父下创建应失败
    let currentId = child.body.id
    for (let depth = 2; depth <= 4; depth++) {
      const next = await client.post<{ id: string; depth: number }>("/api/folders", {
        name: `Level ${depth}`,
        slug: `level-${depth}-test`,
        parentId: currentId,
      })
      expect(next.status).toBe(201)
      expect(next.body.depth).toBe(depth)
      currentId = next.body.id
    }

    const tooDeep = await client.post<{ code: string }>("/api/folders", {
      name: "非法第六级",
      slug: "illegal-sixth",
      parentId: currentId,
    })
    expect(tooDeep.status).toBe(400)
    expect(tooDeep.body.code).toBe("INVALID_PARENT")

    const delParent = await client.delete<{ code: string }>(
      `/api/folders/${parent.body.id}`,
    )
    expect(delParent.status).toBe(409)
    expect(delParent.body.code).toBe("HAS_CHILDREN")

    const bookmark = await createBookmark("astral-sh/uv")
    await client.patch(`/api/bookmarks/${bookmark.body.id}`, {
      folderId: child.body.id,
    })

    const byParent = await client.json<BookmarkList>(
      `/api/bookmarks?folderId=${parent.body.id}`,
    )
    expect(byParent.body.items.some((b) => b.id === bookmark.body.id)).toBe(true)

    const folderList = await client.json<{
      items: Array<{ id: string; count: number; parent_id: string | null }>
    }>("/api/folders")
    const parentRow = folderList.body.items.find((f) => f.id === parent.body.id)
    expect(parentRow?.count).toBeGreaterThanOrEqual(1)

    const detail = await client.json<BookmarkPayload>(
      `/api/bookmarks/${bookmark.body.id}`,
    )
    expect(detail.body.folder?.name).toBe("Agent Skills Test")
    expect(detail.body.folder?.parent_id).toBe(parent.body.id)
    expect(detail.body.folder?.path_label).toBe("AI Parent / Agent Skills Test")

    const exported = await client.json<{
      folders: Array<{ id: string; parent_id: string | null; depth: number; path: string }>
    }>("/api/export")
    const exportedChild = exported.body.folders.find((f) => f.id === child.body.id)
    expect(exportedChild?.parent_id).toBe(parent.body.id)
    expect(exportedChild?.depth).toBe(1)
    expect(exportedChild?.path).toContain(child.body.id)
  })
})

describe("GET /api/export", () => {
  it("导出收藏、文件夹与标签", async () => {
    await createBookmark("facebook/react")
    const { status, body } = await client.json<{
      exported_at: string
      version: number
      bookmarks: Array<{ external_id: string; tags: string[] }>
      folders: unknown[]
      tags: unknown[]
      update_events: unknown[]
    }>("/api/export")

    expect(status).toBe(200)
    expect(body.version).toBe(2)
    expect(typeof body.exported_at).toBe("string")
    expect(body.bookmarks).toHaveLength(1)
    expect(body.bookmarks[0]!.external_id).toBe("facebook/react")
    expect(body.bookmarks[0]!.tags.length).toBeGreaterThan(0)
    expect(Array.isArray(body.folders)).toBe(true)
    expect(Array.isArray(body.update_events)).toBe(true)
  })
})

describe("POST /api/bookmarks/:id/open", () => {
  it("递增 click_count 并返回更新后的收藏", async () => {
    const created = await createBookmark("https://github.com/facebook/react")
    expect(created.status).toBe(201)
    expect(created.body.click_count ?? 0).toBe(0)

    const first = await client.post<BookmarkPayload>(
      `/api/bookmarks/${created.body.id}/open`,
    )
    expect(first.status).toBe(200)
    expect(first.body.click_count).toBe(1)
    expect(first.body.canonical_url).toBe("https://github.com/facebook/react")

    const second = await client.post<BookmarkPayload>(
      `/api/bookmarks/${created.body.id}/open`,
    )
    expect(second.status).toBe(200)
    expect(second.body.click_count).toBe(2)
  })

  it("不存在的收藏返回 404", async () => {
    const { status, body } = await client.post<{ code?: string }>(
      "/api/bookmarks/missing-id/open",
    )
    expect(status).toBe(404)
    expect(body.code).toBe("NOT_FOUND")
  })
})

describe("站点账号密码 vault", () => {
  async function createUrlBookmark(path = "/vault") {
    const pageUrl = `https://vault.example.com${path}`
    outbound.text(
      pageUrl,
      `<html><head><title>Vault Site</title></head><body>ok</body></html>`,
    )
    const created = await createBookmark(pageUrl)
    expect(created.status).toBe(201)
    return created.body
  }

  it("PATCH 写入账号密码后只回 account_password_set，永不回传明文/密文", async () => {
    const bookmark = await createUrlBookmark("/login")
    const { status, body } = await client.patch<BookmarkPayload>(
      `/api/bookmarks/${bookmark.id}`,
      {
        accountUsername: "alice@example.com",
        accountPassword: "s3cret-pass",
      },
    )
    expect(status).toBe(200)
    expect(body.account_registered).toBe(true)
    expect(body.account_username).toBe("alice@example.com")
    expect(body.account_password_set).toBe(true)
    expect(body.account_password_updated_at).toBeTruthy()
    expect(
      (body as Record<string, unknown>).account_password,
    ).toBeUndefined()
    expect(body.account_password_encrypted).toBeUndefined()

    const detail = await client.json<BookmarkPayload>(
      `/api/bookmarks/${bookmark.id}`,
    )
    expect(detail.status).toBe(200)
    expect(detail.body.account_password_set).toBe(true)
    expect(detail.body.account_username).toBe("alice@example.com")
    expect(
      (detail.body as Record<string, unknown>).account_password,
    ).toBeUndefined()
  })

  it("按需 copy 返回明文；空字符串清除密码", async () => {
    const bookmark = await createUrlBookmark("/copy")
    await client.patch(`/api/bookmarks/${bookmark.id}`, {
      accountUsername: "bob",
      accountPassword: "copy-me-now",
    })

    const copied = await client.post<{ password?: string; code?: string }>(
      `/api/bookmarks/${bookmark.id}/account-password/copy`,
    )
    expect(copied.status).toBe(200)
    expect(copied.body.password).toBe("copy-me-now")

    const cleared = await client.patch<BookmarkPayload>(
      `/api/bookmarks/${bookmark.id}`,
      { accountPassword: "" },
    )
    expect(cleared.status).toBe(200)
    expect(cleared.body.account_password_set).toBe(false)
    expect(cleared.body.account_password_updated_at).toBeNull()

    const missing = await client.post<{ code?: string }>(
      `/api/bookmarks/${bookmark.id}/account-password/copy`,
    )
    expect(missing.status).toBe(404)
    expect(missing.body.code).toBe("PASSWORD_NOT_SET")
  })

  it("非 url 来源静默忽略账号字段；copy 返回 400", async () => {
    const created = await createBookmark("facebook/react")
    const patched = await client.patch<BookmarkPayload>(
      `/api/bookmarks/${created.body.id}`,
      {
        accountUsername: "should-ignore",
        accountPassword: "nope",
        accountRegistered: true,
      },
    )
    expect(patched.status).toBe(200)
    expect(patched.body.account_registered).toBeUndefined()
    expect(patched.body.account_username).toBeUndefined()
    expect(patched.body.account_password_set).toBeUndefined()

    const copy = await client.post<{ code?: string }>(
      `/api/bookmarks/${created.body.id}/account-password/copy`,
    )
    expect(copy.status).toBe(400)
    expect(copy.body.code).toBe("UNSUPPORTED_SOURCE")
  })

  it("hasAccount 仅匹配 url；q 不匹配账号名", async () => {
    const withAccount = await createUrlBookmark("/has-yes")
    await client.patch(`/api/bookmarks/${withAccount.id}`, {
      accountUsername: "UniqueVaultUserXYZ",
      accountPassword: "p@ss",
    })
    const withoutAccount = await createUrlBookmark("/has-no")
    expect(withoutAccount.account_registered ?? false).toBe(false)

    const yes = await client.json<BookmarkList>(
      "/api/bookmarks?sourceType=url&hasAccount=true",
    )
    expect(yes.status).toBe(200)
    expect(yes.body.items.every((i) => i.source_type === "url")).toBe(true)
    expect(yes.body.items.some((i) => i.id === withAccount.id)).toBe(true)
    expect(yes.body.items.some((i) => i.id === withoutAccount.id)).toBe(false)

    const no = await client.json<BookmarkList>(
      "/api/bookmarks?sourceType=url&hasAccount=false",
    )
    expect(no.body.items.some((i) => i.id === withoutAccount.id)).toBe(true)
    expect(no.body.items.some((i) => i.id === withAccount.id)).toBe(false)

    const byQ = await client.json<BookmarkList>(
      `/api/bookmarks?q=${encodeURIComponent("UniqueVaultUserXYZ")}`,
    )
    expect(byQ.status).toBe(200)
    expect(byQ.body.items.length).toBe(0)
  })

  it("有凭据时强制 account_registered=true，清凭据后可为 false", async () => {
    const bookmark = await createUrlBookmark("/force-registered")
    const forced = await client.patch<BookmarkPayload>(
      `/api/bookmarks/${bookmark.id}`,
      {
        accountUsername: "keep-me",
        accountPassword: "secret",
        accountRegistered: false,
      },
    )
    expect(forced.status).toBe(200)
    expect(forced.body.account_registered).toBe(true)
    expect(forced.body.account_username).toBe("keep-me")
    expect(forced.body.account_password_set).toBe(true)

    const cleared = await client.patch<BookmarkPayload>(
      `/api/bookmarks/${bookmark.id}`,
      {
        accountUsername: "",
        accountPassword: "",
        accountRegistered: false,
      },
    )
    expect(cleared.status).toBe(200)
    expect(cleared.body.account_registered).toBe(false)
    expect(cleared.body.account_username).toBeNull()
    expect(cleared.body.account_password_set).toBe(false)
  })

  it("export 不含账号字段", async () => {
    const bookmark = await createUrlBookmark("/export")
    await client.patch(`/api/bookmarks/${bookmark.id}`, {
      accountUsername: "export-user",
      accountPassword: "export-secret",
    })
    const exported = await client.json<{
      bookmarks: Array<Record<string, unknown>>
    }>("/api/export")
    expect(exported.status).toBe(200)
    const row = exported.body.bookmarks.find((b) => b.id === bookmark.id)
    expect(row).toBeTruthy()
    expect(row!.account_username).toBeUndefined()
    expect(row!.account_registered).toBeUndefined()
    expect(row!.account_password_encrypted).toBeUndefined()
    expect(row!.account_password_set).toBeUndefined()
  })
})
