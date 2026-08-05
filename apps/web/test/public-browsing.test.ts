import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"
const SECRET_NOTE = "private-note-token-xyz-only-in-notes"

let owner: TestClient
let guest: TestClient
let outbound: OutboundMock
let bookmarkId: string

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  owner = await registerOwner()
  guest = new TestClient()

  const created = await owner.post<{ id: string }>("/api/bookmarks", {
    url: "https://github.com/facebook/react",
    notes: SECRET_NOTE,
  })
  expect(created.status).toBe(201)
  bookmarkId = created.body.id
})

afterEach(() => {
  outbound.restore()
})

describe("公开浏览", () => {
  it("默认关闭：访客 GET 业务接口返回 401", async () => {
    const status = await guest.json<{
      initialized: boolean
      public_browsing_enabled: boolean
      authenticated: boolean
    }>("/api/auth/status")
    expect(status.status).toBe(200)
    expect(status.body.initialized).toBe(true)
    expect(status.body.public_browsing_enabled).toBe(false)
    expect(status.body.authenticated).toBe(false)

    for (const path of [
      "/api/bookmarks",
      `/api/bookmarks/${bookmarkId}`,
      "/api/folders",
      "/api/tags",
      "/api/feed",
    ]) {
      const res = await guest.json<{ code?: string }>(path)
      expect(res.status).toBe(401)
      expect(res.body.code).toBe("UNAUTHORIZED")
    }

    const open = await guest.post<{ code?: string }>(
      `/api/bookmarks/${bookmarkId}/open`,
    )
    expect(open.status).toBe(401)
    expect(open.body.code).toBe("UNAUTHORIZED")
  })

  it("开启后访客可读，notes 为 null；写操作仍 401", async () => {
    const put = await owner.put<{ public_browsing_enabled: boolean }>(
      "/api/settings/public-browsing",
      { enabled: true },
    )
    expect(put.status).toBe(200)
    expect(put.body.public_browsing_enabled).toBe(true)

    const status = await guest.json<{ public_browsing_enabled: boolean }>(
      "/api/auth/status",
    )
    expect(status.body.public_browsing_enabled).toBe(true)

    const me = await owner.json<{ public_browsing_enabled: boolean }>("/api/me")
    expect(me.body.public_browsing_enabled).toBe(true)

    const list = await guest.json<{
      items: Array<{ id: string; notes: string | null }>
    }>("/api/bookmarks")
    expect(list.status).toBe(200)
    expect(list.body.items.length).toBeGreaterThan(0)
    expect(list.body.items[0]!.notes).toBeNull()

    const detail = await guest.json<{ notes: string | null }>(
      `/api/bookmarks/${bookmarkId}`,
    )
    expect(detail.status).toBe(200)
    expect(detail.body.notes).toBeNull()

    const folders = await guest.json("/api/folders")
    expect(folders.status).toBe(200)

    const tags = await guest.json("/api/tags")
    expect(tags.status).toBe(200)

    const feed = await guest.json("/api/feed")
    expect(feed.status).toBe(200)

    const create = await guest.post<{ code?: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    expect(create.status).toBe(401)

    const open = await guest.post<{
      click_count?: number
      notes?: string | null
      code?: string
    }>(`/api/bookmarks/${bookmarkId}/open`)
    expect(open.status).toBe(200)
    expect(open.body.click_count).toBe(1)
    expect(open.body.notes).toBeNull()

    const folder = await guest.post<{ code?: string }>("/api/folders", {
      name: "访客不可建",
    })
    expect(folder.status).toBe(401)
  })

  it("开启后访客搜索不能命中仅存在于 notes 的关键词", async () => {
    await owner.put("/api/settings/public-browsing", { enabled: true })

    const asOwner = await owner.json<{ items: unknown[] }>(
      `/api/bookmarks?q=${encodeURIComponent(SECRET_NOTE)}`,
    )
    expect(asOwner.status).toBe(200)
    expect(asOwner.body.items.length).toBe(1)

    const asGuest = await guest.json<{ items: unknown[] }>(
      `/api/bookmarks?q=${encodeURIComponent(SECRET_NOTE)}`,
    )
    expect(asGuest.status).toBe(200)
    expect(asGuest.body.items.length).toBe(0)
  })

  it("关闭后访客再次 401", async () => {
    await owner.put("/api/settings/public-browsing", { enabled: true })
    await owner.put("/api/settings/public-browsing", { enabled: false })

    const status = await guest.json<{ public_browsing_enabled: boolean }>(
      "/api/auth/status",
    )
    expect(status.body.public_browsing_enabled).toBe(false)

    const list = await guest.json<{ code?: string }>("/api/bookmarks")
    expect(list.status).toBe(401)
    expect(list.body.code).toBe("UNAUTHORIZED")
  })

  it("未登录不可改公开浏览设置", async () => {
    const res = await guest.put<{ code?: string }>(
      "/api/settings/public-browsing",
      { enabled: true },
    )
    expect(res.status).toBe(401)
  })
})
