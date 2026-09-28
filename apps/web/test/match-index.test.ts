import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  OWNER,
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"

type MatchItem = {
  id: string
  source_type: string
  canonical_url: string
  external_id: string
  archived: boolean
}

type MatchIndex = {
  revision: number
  items: MatchItem[]
}

let client: TestClient
let outbound: OutboundMock

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

async function readIndex(headers?: HeadersInit) {
  const res = await client.fetch("/api/bookmarks/match-index", { headers })
  const text = await res.text()
  return { res, text }
}

describe("GET /api/bookmarks/match-index", () => {
  it("不会被 /bookmarks/:id 抢走，创建后版本为 1", async () => {
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    expect(created.status).toBe(201)

    const { res, text } = await readIndex()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("etag")).toBe('"1"')
    const body = JSON.parse(text) as MatchIndex
    expect(body.revision).toBe(1)
    expect(body.items).toEqual([
      {
        id: created.body.id,
        source_type: "github",
        canonical_url: "https://github.com/facebook/react",
        external_id: "facebook/react",
        archived: false,
      },
    ])
  })

  it("版本未变时 304，响应体没有 items", async () => {
    await client.post("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })

    const { res, text } = await readIndex({ "If-None-Match": '"1"' })
    expect(res.status).toBe(304)
    expect(text).toBe("")
    expect(res.headers.get("etag")).toBe('"1"')
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("改笔记、改文件夹、批量改定价不增加版本", async () => {
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const id = created.body.id

    const notes = await client.patch(`/api/bookmarks/${id}`, {
      notes: "只是笔记",
    })
    expect(notes.status).toBe(200)

    const folder = await client.post<{ id: string }>("/api/folders", {
      name: "夹",
      slug: "match-index-folder",
    })
    expect(folder.status).toBe(201)
    const moved = await client.patch(`/api/bookmarks/${id}`, {
      folderId: folder.body.id,
    })
    expect(moved.status).toBe(200)

    const priced = await client.post("/api/bookmarks/batch", {
      ids: [id],
      action: { type: "setPricing", pricing: "free" },
    })
    expect(priced.status).toBe(200)

    const { res, text } = await readIndex({ "If-None-Match": '"1"' })
    expect(res.status).toBe(304)
    expect(text).toBe("")
  })

  it("归档后版本增加且 archived 为 true，删除后不再出现", async () => {
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const id = created.body.id

    const archived = await client.patch(`/api/bookmarks/${id}`, {
      archived: true,
    })
    expect(archived.status).toBe(200)

    const afterArchive = await readIndex()
    expect(afterArchive.res.status).toBe(200)
    const archivedBody = JSON.parse(afterArchive.text) as MatchIndex
    expect(archivedBody.revision).toBe(2)
    expect(archivedBody.items).toEqual([
      expect.objectContaining({ id, archived: true }),
    ])

    const removed = await client.delete(`/api/bookmarks/${id}`)
    expect(removed.status).toBe(200)

    const afterDelete = await readIndex({ "If-None-Match": '"2"' })
    expect(afterDelete.res.status).toBe(200)
    const deletedBody = JSON.parse(afterDelete.text) as MatchIndex
    expect(deletedBody.revision).toBe(3)
    expect(deletedBody.items).toEqual([])
  })

  it("重复收藏不增加版本", async () => {
    await client.post("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const again = await client.post("/api/bookmarks", {
      url: "https://github.com/facebook/react/issues/1",
    })
    expect(again.status).toBe(409)

    const { res } = await readIndex({ "If-None-Match": '"1"' })
    expect(res.status).toBe(304)
  })

  it("未登录返回 401", async () => {
    const anon = new TestClient()
    const res = await anon.fetch("/api/bookmarks/match-index")
    expect(res.status).toBe(401)
  })

  it("GitHub 主页与 X 主页不会成为身份表里的行", async () => {
    const profile = await client.post("/api/bookmarks", {
      url: "https://github.com/facebook",
    })
    expect(profile.status).toBe(400)

    const timeline = await client.post("/api/bookmarks", {
      url: "https://x.com/someone",
    })
    expect(timeline.status).toBe(400)

    const { res, text } = await readIndex()
    expect(res.status).toBe(200)
    const body = JSON.parse(text) as MatchIndex
    expect(body.revision).toBe(0)
    expect(body.items).toEqual([])
  })

  it("清空数据后旧版本号不再命中 304", async () => {
    await client.post("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })

    const cleared = await client.post("/api/settings/clear-data")
    expect(cleared.status).toBe(200)

    const again = new TestClient()
    const login = await again.post("/api/auth/login", {
      username: OWNER.username,
      password: OWNER.password,
    })
    expect(login.status).toBe(200)

    const res = await again.fetch("/api/bookmarks/match-index", {
      headers: { "If-None-Match": '"1"' },
    })
    const text = await res.text()
    expect(res.status).toBe(200)
    const body = JSON.parse(text) as MatchIndex
    expect(body.revision).toBe(2)
    expect(body.items).toEqual([])
  })

  it("MCP 重复传入相同 archived 不增加版本，变化时才增加", async () => {
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const id = created.body.id

    const same = await client.post("/api/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "update_bookmark",
        arguments: { id, archived: false },
      },
    })
    expect(same.status).toBe(200)

    const unchanged = await readIndex({ "If-None-Match": '"1"' })
    expect(unchanged.res.status).toBe(304)

    const changed = await client.post("/api/mcp", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "update_bookmark",
        arguments: { id, archived: true },
      },
    })
    expect(changed.status).toBe(200)

    const after = await readIndex()
    expect(after.res.status).toBe(200)
    const body = JSON.parse(after.text) as MatchIndex
    expect(body.revision).toBe(2)
    expect(body.items).toEqual([expect.objectContaining({ id, archived: true })])
  })

  it("删除空文件夹不增加版本，删掉其中收藏时增加一次", async () => {
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const empty = await client.post<{ id: string }>("/api/folders", {
      name: "空",
      slug: "empty-match",
    })
    expect(empty.status).toBe(201)
    const removedEmpty = await client.delete(`/api/folders/${empty.body.id}`, {
      bookmarkAction: "delete",
    })
    expect(removedEmpty.status).toBe(200)

    const still = await readIndex({ "If-None-Match": '"1"' })
    expect(still.res.status).toBe(304)

    const filled = await client.post<{ id: string }>("/api/folders", {
      name: "有",
      slug: "filled-match",
    })
    expect(filled.status).toBe(201)
    const moved = await client.patch(`/api/bookmarks/${created.body.id}`, {
      folderId: filled.body.id,
    })
    expect(moved.status).toBe(200)

    const removedFilled = await client.delete(`/api/folders/${filled.body.id}`, {
      bookmarkAction: "delete",
    })
    expect(removedFilled.status).toBe(200)

    const after = await readIndex({ "If-None-Match": '"1"' })
    expect(after.res.status).toBe(200)
    const body = JSON.parse(after.text) as MatchIndex
    expect(body.revision).toBe(2)
    expect(body.items).toEqual([])
  })

  it("公开浏览开启时匿名拉取仍是 401", async () => {
    const enabled = await client.put("/api/settings/public-browsing", {
      enabled: true,
    })
    expect(enabled.status).toBe(200)

    const anon = new TestClient()
    const res = await anon.fetch("/api/bookmarks/match-index")
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("UNAUTHORIZED")
  })
})
