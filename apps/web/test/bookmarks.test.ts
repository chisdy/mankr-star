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

  it("非 GitHub 链接返回 400 UNSUPPORTED_SOURCE", async () => {
    const { status, body } = await createBookmark("https://gitlab.com/foo/bar")
    expect(status).toBe(400)
    expect(body.code).toBe("UNSUPPORTED_SOURCE")
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
