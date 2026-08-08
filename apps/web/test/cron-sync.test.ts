import { bookmarks, createDb, updateEvents } from "@mankr/db"
import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { syncUpdates } from "../src/worker/cron/sync"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"

let client: TestClient
let outbound: OutboundMock

/** 注册一条 GitHub 收藏，返回它的 id */
async function addRepo(fullName: string): Promise<string> {
  const res = await client.post<{ id: string }>("/api/bookmarks", {
    url: `https://github.com/${fullName}`,
  })
  expect(res.status).toBe(201)
  return res.body.id
}

function mockRepo(fullName: string, overrides: Record<string, unknown> = {}) {
  // 仓库前缀会吃掉 readme / releases 子路径，靠「后注册者优先」把它们盖回来
  outbound.json(`${GITHUB}${fullName}`, githubRepoPayload(fullName, overrides))
  outbound.json(`${GITHUB}${fullName}/releases/latest`, {}, 404)
  outbound.text(`${GITHUB}${fullName}/readme`, "# readme\n正文")
}

async function eventsOf(bookmarkId: string) {
  const db = createDb(env)
  return db
    .select()
    .from(updateEvents)
    .where(eq(updateEvents.bookmarkId, bookmarkId))
}

beforeEach(async () => {
  outbound = mockOutboundFetch()
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

describe("syncUpdates 动态订阅开关", () => {
  it("默认写入 push 事件", async () => {
    mockRepo("facebook/react")
    const id = await addRepo("facebook/react")

    // 换个 pushed_at，制造一次新推送
    mockRepo("facebook/react", { pushed_at: "2026-08-06T00:00:00Z" })
    await syncUpdates(env)

    const rows = await eventsOf(id)
    expect(rows.map((r) => r.eventType)).toContain("push")
  })

  it("关闭 eventPush 后不再写入 push 事件", async () => {
    mockRepo("facebook/react")
    const id = await addRepo("facebook/react")

    const saved = await client.put("/api/settings/tracking", { eventPush: false })
    expect(saved.status).toBe(200)

    mockRepo("facebook/react", { pushed_at: "2026-08-06T00:00:00Z" })
    await syncUpdates(env)

    const rows = await eventsOf(id)
    expect(rows.map((r) => r.eventType)).not.toContain("push")
  })
})

describe("syncUpdates 仓库改名", () => {
  it("full_name 变化时改写坐标并记一条 renamed 事件", async () => {
    mockRepo("old-owner/tool")
    const id = await addRepo("old-owner/tool")

    // 旧地址被 GitHub 重定向到新仓库：响应里的 full_name 已是新坐标
    mockRepo("old-owner/tool", { full_name: "new-owner/tool" })
    await syncUpdates(env)

    const db = createDb(env)
    const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
    expect(row?.externalId).toBe("new-owner/tool")
    expect(row?.canonicalUrl).toBe("https://github.com/new-owner/tool")
    expect(row?.owner).toBe("new-owner")
    expect(row?.title).toBe("new-owner/tool")

    const renamed = (await eventsOf(id)).find(
      (r) => r.dedupeKey === "meta:renamed:old-owner/tool->new-owner/tool",
    )
    expect(renamed).toBeTruthy()
    expect(JSON.parse(renamed!.payloadJson)).toMatchObject({
      kind: "renamed",
      from: "old-owner/tool",
      to: "new-owner/tool",
    })
  })

  it("关闭 eventMetaChange 时仍改名，但不写事件", async () => {
    mockRepo("old-owner/lib")
    const id = await addRepo("old-owner/lib")

    await client.put("/api/settings/tracking", { eventMetaChange: false })

    mockRepo("old-owner/lib", { full_name: "new-owner/lib" })
    await syncUpdates(env)

    const db = createDb(env)
    const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
    expect(row?.externalId).toBe("new-owner/lib")

    const rows = await eventsOf(id)
    expect(rows.map((r) => r.eventType)).not.toContain("meta_change")
  })

  it("新坐标已被其他收藏占用时放弃改写", async () => {
    mockRepo("dup/new")
    await addRepo("dup/new")

    mockRepo("dup/old")
    const id = await addRepo("dup/old")

    mockRepo("dup/old", { full_name: "dup/new" })
    await syncUpdates(env)

    const db = createDb(env)
    const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
    expect(row?.externalId).toBe("dup/old")
    expect(row?.canonicalUrl).toBe("https://github.com/dup/old")
  })
})

describe("syncUpdates README 缓存", () => {
  it("同步后写入 readme_excerpt", async () => {
    mockRepo("facebook/react")
    const id = await addRepo("facebook/react")

    mockRepo("facebook/react", { pushed_at: "2026-08-06T00:00:00Z" })
    await syncUpdates(env)

    const db = createDb(env)
    const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
    expect(row?.readmeExcerpt).toContain("# readme")
  })

  it("README 404 时写入空串，避免每轮空打", async () => {
    outbound.json(`${GITHUB}acme/empty`, githubRepoPayload("acme/empty"))
    outbound.json(`${GITHUB}acme/empty/releases/latest`, {}, 404)
    outbound.text(`${GITHUB}acme/empty/readme`, "", 404)

    const id = await addRepo("acme/empty")
    await syncUpdates(env)

    const db = createDb(env)
    const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
    expect(row?.readmeExcerpt).toBe("")

    // 再同步一次：不应再请求 readme（mock 未再注册也会因未请求而不失败）
    outbound.json(
      `${GITHUB}acme/empty`,
      githubRepoPayload("acme/empty", { pushed_at: row?.pushedAt ?? undefined }),
    )
    outbound.json(`${GITHUB}acme/empty/releases/latest`, {}, 404)
    await syncUpdates(env)
    const again = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
    expect(again?.readmeExcerpt).toBe("")
  })
})
