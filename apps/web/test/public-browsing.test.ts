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
      "/api/feed/stats",
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
      items: Array<{
        id: string
        notes: string | null
        pricing?: string | null
        featured?: boolean
        account_username?: string | null
        account_registered?: boolean
        account_password_set?: boolean
      }>
    }>("/api/bookmarks")
    expect(list.status).toBe(200)
    expect(list.body.items.length).toBeGreaterThan(0)
    expect(list.body.items[0]!.notes).toBeNull()
    expect(list.body.items[0]!.pricing).toBeNull()
    expect(list.body.items[0]!.featured).toBe(false)
    expect(list.body.items[0]!.account_username).toBeUndefined()
    expect(list.body.items[0]!.account_registered).toBeUndefined()
    expect(list.body.items[0]!.account_password_set).toBeUndefined()

    const detail = await guest.json<{
      notes: string | null
      pricing?: string | null
      featured?: boolean
      account_username?: string | null
      account_registered?: boolean
      account_password_set?: boolean
    }>(`/api/bookmarks/${bookmarkId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.notes).toBeNull()
    expect(detail.body.pricing).toBeNull()
    expect(detail.body.featured).toBe(false)
    expect(detail.body.account_username).toBeUndefined()
    expect(detail.body.account_registered).toBeUndefined()
    expect(detail.body.account_password_set).toBeUndefined()

    const folders = await guest.json("/api/folders")
    expect(folders.status).toBe(200)

    const tags = await guest.json("/api/tags")
    expect(tags.status).toBe(200)

    const feed = await guest.json("/api/feed")
    expect(feed.status).toBe(200)

    const feedStats = await guest.json("/api/feed/stats")
    expect(feedStats.status).toBe(200)

    const create = await guest.post<{ code?: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    expect(create.status).toBe(401)

    const open = await guest.post<{
      click_count?: number
      notes?: string | null
      account_username?: string | null
      account_password_set?: boolean
      code?: string
    }>(`/api/bookmarks/${bookmarkId}/open`)
    expect(open.status).toBe(200)
    expect(open.body.click_count).toBe(1)
    expect(open.body.notes).toBeNull()
    expect(open.body.account_username).toBeUndefined()
    expect(open.body.account_password_set).toBeUndefined()

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

  it("公开浏览忽略 hasAccount，且账号字段不暴露", async () => {
    outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
    outbound.text(
      "https://vault-public.example.com/",
      "<html><head><title>Vault Public</title></head><body>ok</body></html>",
    )
    const created = await owner.post<{ id: string }>("/api/bookmarks", {
      url: "https://vault-public.example.com/",
    })
    expect(created.status).toBe(201)
    const urlId = created.body.id
    await owner.patch(`/api/bookmarks/${urlId}`, {
      accountUsername: "guest-must-not-see",
      accountPassword: "hidden-pass",
      accountRegistered: true,
    })

    await owner.put("/api/settings/public-browsing", { enabled: true })

    const withFilter = await guest.json<{
      items: Array<{
        id: string
        source_type: string
        account_username?: string | null
        account_password_set?: boolean
      }>
      total: number
    }>("/api/bookmarks?hasAccount=true")
    expect(withFilter.status).toBe(200)
    // 忽略 hasAccount 后应仍能看到 github 收藏，不能只剩「有账号」的 url
    expect(withFilter.body.items.some((i) => i.source_type === "github")).toBe(
      true,
    )
    expect(
      withFilter.body.items.every(
        (i) =>
          i.account_username === undefined &&
          i.account_password_set === undefined,
      ),
    ).toBe(true)

    const byUserQ = await guest.json<{ items: unknown[] }>(
      `/api/bookmarks?q=${encodeURIComponent("guest-must-not-see")}`,
    )
    expect(byUserQ.status).toBe(200)
    expect(byUserQ.body.items.length).toBe(0)

    const copy = await guest.post<{ code?: string }>(
      `/api/bookmarks/${urlId}/account-password/copy`,
    )
    expect(copy.status).toBe(401)
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
