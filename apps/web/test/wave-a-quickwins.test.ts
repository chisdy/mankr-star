import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"
const SECRET_NOTE = "SecretNotesOnlyTokenXYZ99"

let client: TestClient
let outbound: OutboundMock

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}vercel/next.js`, githubRepoPayload("vercel/next.js"))
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  outbound.text("https://example.com/", "<html><body>hello</body></html>")
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

describe("Wave A: list FTS / tag merge / batch", () => {
  it("列表 q 可按 owner 命中（FTS）", async () => {
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/vercel/next.js",
    })
    expect(created.status).toBe(201)

    const list = await client.json<{
      items: Array<{ id: string; owner?: string | null }>
    }>("/api/bookmarks?q=vercel")
    expect(list.status).toBe(200)
    expect(list.body.items.some((b) => b.id === created.body.id)).toBe(true)
  })

  it("公开浏览时 q 不因 notes 命中", async () => {
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
      notes: SECRET_NOTE,
    })
    expect(created.status).toBe(201)

    const pub = await client.put("/api/settings/public-browsing", {
      enabled: true,
    })
    expect(pub.status).toBe(200)

    const guest = new TestClient()
    const hit = await guest.json<{ items: unknown[] }>(
      `/api/bookmarks?q=${encodeURIComponent(SECRET_NOTE)}`,
    )
    expect(hit.status).toBe(200)
    expect(hit.body.items).toHaveLength(0)

    const ownerHit = await client.json<{ items: Array<{ id: string }> }>(
      `/api/bookmarks?q=${encodeURIComponent(SECRET_NOTE)}`,
    )
    expect(ownerHit.status).toBe(200)
    expect(ownerHit.body.items.some((b) => b.id === created.body.id)).toBe(
      true,
    )
  })

  it("合并标签迁移关联并删除源标签", async () => {
    const a = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    expect(a.status).toBe(201)

    await client.patch(`/api/bookmarks/${a.body.id}`, {
      tagNames: ["alpha", "beta"],
    })

    const tags = await client.json<{
      items: Array<{ id: string; name: string; usage_count: number }>
    }>("/api/tags")
    expect(tags.status).toBe(200)
    const source = tags.body.items.find((t) => t.name === "alpha")
    const target = tags.body.items.find((t) => t.name === "beta")
    expect(source && target).toBeTruthy()

    const merged = await client.post<{
      id: string
      name: string
      usage_count: number
    }>("/api/tags/merge", {
      sourceId: source!.id,
      targetId: target!.id,
    })
    expect(merged.status).toBe(200)
    expect(merged.body.name).toBe("beta")
    expect(merged.body.usage_count).toBeGreaterThanOrEqual(1)

    const after = await client.json<{
      items: Array<{ id: string; name: string }>
    }>("/api/tags")
    expect(after.body.items.some((t) => t.name === "alpha")).toBe(false)
    expect(after.body.items.some((t) => t.name === "beta")).toBe(true)

    const detail = await client.json<{ tags: string[] }>(
      `/api/bookmarks/${a.body.id}`,
    )
    expect(detail.body.tags).toContain("beta")
    expect(detail.body.tags).not.toContain("alpha")
  })

  it("合并后按目标标签列表能筛到两侧收藏", async () => {
    const a = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const b = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/vercel/next.js",
    })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)

    await client.patch(`/api/bookmarks/${a.body.id}`, {
      tagNames: ["src-only"],
    })
    await client.patch(`/api/bookmarks/${b.body.id}`, {
      tagNames: ["dst-only"],
    })

    const tags = await client.json<{
      items: Array<{ id: string; name: string; usage_count: number }>
    }>("/api/tags")
    const source = tags.body.items.find((t) => t.name === "src-only")
    const target = tags.body.items.find((t) => t.name === "dst-only")
    expect(source && target).toBeTruthy()

    const merged = await client.post<{ usage_count: number }>("/api/tags/merge", {
      sourceId: source!.id,
      targetId: target!.id,
    })
    expect(merged.status).toBe(200)
    expect(merged.body.usage_count).toBe(2)

    const list = await client.json<{
      items: Array<{ id: string; tags: string[] }>
      total: number
    }>(`/api/bookmarks?tag=${encodeURIComponent("dst-only")}`)
    expect(list.status).toBe(200)
    expect(list.body.total).toBe(2)
    expect(list.body.items.map((i) => i.id).sort()).toEqual(
      [a.body.id, b.body.id].sort(),
    )
  })

  it("批量合并多个源标签到同一目标", async () => {
    const a = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const b = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/vercel/next.js",
    })
    const c = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://example.com/batch-merge-target",
    })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(c.status).toBe(201)

    await client.patch(`/api/bookmarks/${a.body.id}`, {
      tagNames: ["batch-src-a"],
    })
    await client.patch(`/api/bookmarks/${b.body.id}`, {
      tagNames: ["batch-src-b"],
    })
    await client.patch(`/api/bookmarks/${c.body.id}`, {
      tagNames: ["batch-dst"],
    })

    const tags = await client.json<{
      items: Array<{ id: string; name: string; usage_count: number }>
    }>("/api/tags")
    const sourceA = tags.body.items.find((t) => t.name === "batch-src-a")
    const sourceB = tags.body.items.find((t) => t.name === "batch-src-b")
    const target = tags.body.items.find((t) => t.name === "batch-dst")
    expect(sourceA && sourceB && target).toBeTruthy()

    const merged = await client.post<{
      ok: boolean
      processed: number
      failed: Array<{ id: string; code: string }>
    }>("/api/tags/batch", {
      ids: [sourceA!.id, sourceB!.id],
      action: { type: "merge", targetId: target!.id },
    })
    expect(merged.status).toBe(200)
    expect(merged.body.ok).toBe(true)
    expect(merged.body.processed).toBe(2)
    expect(merged.body.failed).toEqual([])

    const after = await client.json<{
      items: Array<{ id: string; name: string; usage_count: number }>
    }>("/api/tags")
    expect(after.body.items.some((t) => t.name === "batch-src-a")).toBe(false)
    expect(after.body.items.some((t) => t.name === "batch-src-b")).toBe(false)
    expect(after.body.items.find((t) => t.name === "batch-dst")?.usage_count).toBe(
      3,
    )

    const list = await client.json<{
      items: Array<{ id: string }>
      total: number
    }>(`/api/bookmarks?tag=${encodeURIComponent("batch-dst")}`)
    expect(list.status).toBe(200)
    expect(list.body.total).toBe(3)
  })


  it("三源并入目标后 usage_count 与筛选一致", async () => {
    const mk = async (url: string, tagNames: string[]) => {
      const created = await client.post<{ id: string }>("/api/bookmarks", { url })
      expect(created.status).toBe(201)
      await client.patch(`/api/bookmarks/${created.body.id}`, { tagNames })
      return created.body.id
    }
    await mk("https://github.com/facebook/react", ["cnt-a"])
    await mk("https://github.com/vercel/next.js", ["cnt-b"])
    await mk("https://example.com/cnt-c", ["cnt-c"])
    await mk("https://example.com/cnt-dst", ["cnt-dst"])

    const tags = await client.json<{
      items: Array<{ id: string; name: string; usage_count: number }>
    }>("/api/tags")
    const a = tags.body.items.find((t) => t.name === "cnt-a")!
    const b = tags.body.items.find((t) => t.name === "cnt-b")!
    const c = tags.body.items.find((t) => t.name === "cnt-c")!
    const dst = tags.body.items.find((t) => t.name === "cnt-dst")!
    expect(a && b && c && dst).toBeTruthy()
    expect(a.usage_count).toBe(1)
    expect(dst.usage_count).toBe(1)

    const merged = await client.post<{ processed: number }>("/api/tags/batch", {
      ids: [a.id, b.id, c.id],
      action: { type: "merge", targetId: dst.id },
    })
    expect(merged.status).toBe(200)
    expect(merged.body.processed).toBe(3)

    const after = await client.json<{
      items: Array<{ name: string; usage_count: number }>
    }>("/api/tags")
    expect(after.body.items.find((t) => t.name === "cnt-dst")?.usage_count).toBe(4)

    const list = await client.json<{ total: number }>(
      `/api/bookmarks?tag=${encodeURIComponent("cnt-dst")}`,
    )
    expect(list.body.total).toBe(4)
  })


  it("A3_B1_C1 合并后应为 5", async () => {
    const mk = async (url: string, tagNames: string[]) => {
      const created = await client.post<{ id: string }>("/api/bookmarks", { url })
      expect(created.status).toBe(201)
      await client.patch(`/api/bookmarks/${created.body.id}`, { tagNames })
      return created.body.id
    }
    const a1 = await mk("https://example.com/a1", ["tag-a"])
    const a2 = await mk("https://example.com/a2", ["tag-a"])
    const a3 = await mk("https://example.com/a3", ["tag-a"])
    const b1 = await mk("https://example.com/b1", ["tag-b"])
    const c1 = await mk("https://example.com/c1", ["tag-c"])

    const tags = await client.json<{
      items: Array<{ id: string; name: string; usage_count: number }>
    }>("/api/tags")
    const tagA = tags.body.items.find((t) => t.name === "tag-a")!
    const tagB = tags.body.items.find((t) => t.name === "tag-b")!
    const tagC = tags.body.items.find((t) => t.name === "tag-c")!
    expect(tagA.usage_count).toBe(3)
    expect(tagB.usage_count).toBe(1)
    expect(tagC.usage_count).toBe(1)

    const merged = await client.post<{
      ok: boolean
      processed: number
      failed: unknown[]
      target?: { id: string; usage_count: number }
    }>("/api/tags/batch", {
      ids: [tagA.id, tagB.id],
      action: { type: "merge", targetId: tagC.id },
    })
    expect(merged.status).toBe(200)
    expect(merged.body.ok).toBe(true)
    expect(merged.body.processed).toBe(2)
    expect(merged.body.target?.usage_count).toBe(5)

    const after = await client.json<{
      items: Array<{ name: string; usage_count: number }>
    }>("/api/tags")
    expect(after.body.items.find((t) => t.name === "tag-a")).toBeUndefined()
    expect(after.body.items.find((t) => t.name === "tag-b")).toBeUndefined()
    expect(after.body.items.find((t) => t.name === "tag-c")?.usage_count).toBe(5)

    const list = await client.json<{
      total: number
      items: Array<{ id: string; tags: string[] }>
    }>(`/api/bookmarks?tag=${encodeURIComponent("tag-c")}&pageSize=50`)
    expect(list.body.total).toBe(5)
    const ids = list.body.items.map((i) => i.id).sort()
    expect(ids).toEqual([a1, a2, a3, b1, c1].sort())
    for (const item of list.body.items) {
      expect(item.tags).toContain("tag-c")
    }
  })


  it("合并预览会提示去重后的真实收藏数", async () => {
    const mk = async (url: string, tagNames: string[]) => {
      const created = await client.post<{ id: string }>("/api/bookmarks", { url })
      expect(created.status).toBe(201)
      await client.patch(`/api/bookmarks/${created.body.id}`, { tagNames })
      return created.body.id
    }
    // 3 个收藏：A 全覆盖；B/C 是 A 的子集 → 相加 5，去重 3
    await mk("https://example.com/ov-1", ["ov-a", "ov-b", "ov-c"])
    await mk("https://example.com/ov-2", ["ov-a"])
    await mk("https://example.com/ov-3", ["ov-a"])

    const tags = await client.json<{
      items: Array<{ id: string; name: string; usage_count: number }>
    }>("/api/tags")
    const a = tags.body.items.find((t) => t.name === "ov-a")!
    const b = tags.body.items.find((t) => t.name === "ov-b")!
    const c = tags.body.items.find((t) => t.name === "ov-c")!
    expect(a.usage_count).toBe(3)
    expect(b.usage_count).toBe(1)
    expect(c.usage_count).toBe(1)

    const preview = await client.post<{
      unique_count: number
      additive_count: number
    }>("/api/tags/merge/preview", {
      sourceIds: [a.id, b.id],
      targetId: c.id,
    })
    expect(preview.status).toBe(200)
    expect(preview.body.additive_count).toBe(5)
    expect(preview.body.unique_count).toBe(3)

    const merged = await client.post<{
      target?: { usage_count: number }
    }>("/api/tags/batch", {
      ids: [a.id, b.id],
      action: { type: "merge", targetId: c.id },
    })
    expect(merged.status).toBe(200)
    expect(merged.body.target?.usage_count).toBe(3)
  })

  it("标签计数与筛选均忽略软删收藏", async () => {
    const live = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const gone = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/vercel/next.js",
    })
    expect(live.status).toBe(201)
    expect(gone.status).toBe(201)

    await client.patch(`/api/bookmarks/${live.body.id}`, {
      tagNames: ["keep-me"],
    })
    await client.patch(`/api/bookmarks/${gone.body.id}`, {
      tagNames: ["keep-me"],
    })
    await client.delete(`/api/bookmarks/${gone.body.id}`)

    const tags = await client.json<{
      items: Array<{ name: string; usage_count: number }>
    }>("/api/tags")
    const row = tags.body.items.find((t) => t.name === "keep-me")
    expect(row?.usage_count).toBe(1)

    const list = await client.json<{
      items: Array<{ id: string }>
      total: number
    }>("/api/bookmarks?tag=keep-me")
    expect(list.body.total).toBe(1)
    expect(list.body.items.map((i) => i.id)).toEqual([live.body.id])
  })

  it("标签计数与默认筛选均忽略已归档收藏", async () => {
    const live = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const archived = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/vercel/next.js",
    })
    expect(live.status).toBe(201)
    expect(archived.status).toBe(201)

    await client.patch(`/api/bookmarks/${live.body.id}`, {
      tagNames: ["flux-like"],
    })
    await client.patch(`/api/bookmarks/${archived.body.id}`, {
      tagNames: ["flux-like"],
      archived: true,
    })

    const tags = await client.json<{
      items: Array<{ name: string; usage_count: number }>
    }>("/api/tags")
    expect(tags.body.items.find((t) => t.name === "flux-like")?.usage_count).toBe(
      1,
    )

    const list = await client.json<{ total: number; items: Array<{ id: string }> }>(
      "/api/bookmarks?tag=flux-like",
    )
    expect(list.body.total).toBe(1)
    expect(list.body.items.map((i) => i.id)).toEqual([live.body.id])

    const archivedList = await client.json<{ total: number }>(
      "/api/bookmarks?tag=flux-like&archived=true",
    )
    expect(archivedList.body.total).toBe(1)
  })

  it("批量归档与软删", async () => {
    const a = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const b = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/vercel/next.js",
    })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)

    const archived = await client.post<{
      ok: boolean
      processed: number
      failed: unknown[]
    }>("/api/bookmarks/batch", {
      ids: [a.body.id, b.body.id],
      action: { type: "archive" },
    })
    expect(archived.status).toBe(200)
    expect(archived.body.processed).toBe(2)
    expect(archived.body.failed).toHaveLength(0)

    const archivedList = await client.json<{ items: Array<{ id: string }> }>(
      "/api/bookmarks?archived=true",
    )
    expect(archivedList.body.items.map((i) => i.id).sort()).toEqual(
      [a.body.id, b.body.id].sort(),
    )

    const deleted = await client.post<{ processed: number }>(
      "/api/bookmarks/batch",
      {
        ids: [a.body.id],
        action: { type: "delete" },
      },
    )
    expect(deleted.status).toBe(200)
    expect(deleted.body.processed).toBe(1)

    const gone = await client.json<{ code?: string }>(
      `/api/bookmarks/${a.body.id}`,
    )
    expect(gone.status).toBe(404)
  })

  it("批量 ids 全不存在时返回 failed 且不 500", async () => {
    const res = await client.post<{
      ok: boolean
      processed: number
      failed: Array<{ id: string; code: string }>
    }>("/api/bookmarks/batch", {
      ids: ["00000000-0000-4000-8000-000000000001"],
      action: { type: "archive" },
    })
    expect(res.status).toBe(200)
    expect(res.body.processed).toBe(0)
    expect(res.body.failed).toEqual([
      { id: "00000000-0000-4000-8000-000000000001", code: "NOT_FOUND" },
    ])
  })
})
