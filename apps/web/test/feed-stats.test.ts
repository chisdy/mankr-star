import { bookmarks, createDb, updateEvents } from "@mankr/db"
import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"
const UPDATE_TYPES = ["push", "release", "stars_delta", "meta_change"] as const

interface FeedStatsBody {
  range: string
  summary: {
    total_events: number
    today_events: number
    active_bookmarks: number
    tracked_bookmarks: number
  }
  events_by_type: Array<{ event_type: string; count: number }>
  daily: Array<{ date: string; count: number }>
}

let client: TestClient
let outbound: OutboundMock

async function addRepo(fullName: string): Promise<string> {
  outbound.json(`${GITHUB}${fullName}`, githubRepoPayload(fullName))
  outbound.json(`${GITHUB}${fullName}/releases/latest`, {}, 404)
  outbound.text(`${GITHUB}${fullName}/readme`, "# readme")
  const res = await client.post<{ id: string }>("/api/bookmarks", {
    url: `https://github.com/${fullName}`,
  })
  expect(res.status).toBe(201)
  return res.body.id
}

async function insertEvent(input: {
  bookmarkId: string
  eventType: string
  dedupeKey: string
  detectedAt: string
}) {
  const db = createDb(env)
  await db.insert(updateEvents).values({
    id: crypto.randomUUID(),
    bookmarkId: input.bookmarkId,
    eventType: input.eventType,
    dedupeKey: input.dedupeKey,
    payloadJson: "{}",
    detectedAt: input.detectedAt,
  })
}

beforeEach(async () => {
  outbound = mockOutboundFetch()
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

describe("GET /api/feed/stats", () => {
  it("未登录返回 401", async () => {
    const guest = new TestClient()
    const res = await guest.json("/api/feed/stats")
    expect(res.status).toBe(401)
  })

  it("空库返回零值与四类补零", async () => {
    const { status, body } = await client.json<FeedStatsBody>("/api/feed/stats")
    expect(status).toBe(200)
    expect(body.range).toBe("30d")
    expect(body.summary).toEqual({
      total_events: 0,
      today_events: 0,
      active_bookmarks: 0,
      tracked_bookmarks: 0,
    })
    expect(body.events_by_type.map((r) => r.event_type)).toEqual([
      ...UPDATE_TYPES,
    ])
    expect(body.events_by_type.every((r) => r.count === 0)).toBe(true)
    expect(body.daily).toHaveLength(31) // since 30d 回推到今天共 31 个日期点
  })

  it("非法 range 返回 400", async () => {
    const { status, body } = await client.json<{ code: string }>(
      "/api/feed/stats?range=90d",
    )
    expect(status).toBe(400)
    expect(body.code).toBe("VALIDATION_ERROR")
  })

  it("聚合事件类型、活跃仓库与今日计数", async () => {
    const reactId = await addRepo("facebook/react")
    const vueId = await addRepo("vuejs/core")

    const today = new Date().toISOString().slice(0, 10)
    const todayIso = `${today}T12:00:00.000Z`
    const twoDaysAgo = new Date()
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2)
    const olderIso = `${twoDaysAgo.toISOString().slice(0, 10)}T08:00:00.000Z`
    const fortyDaysAgo = new Date()
    fortyDaysAgo.setUTCDate(fortyDaysAgo.getUTCDate() - 40)
    const outOfRangeIso = fortyDaysAgo.toISOString()

    await insertEvent({
      bookmarkId: reactId,
      eventType: "push",
      dedupeKey: "push:today",
      detectedAt: todayIso,
    })
    await insertEvent({
      bookmarkId: reactId,
      eventType: "release",
      dedupeKey: "release:today",
      detectedAt: todayIso,
    })
    await insertEvent({
      bookmarkId: vueId,
      eventType: "push",
      dedupeKey: "push:older",
      detectedAt: olderIso,
    })
    await insertEvent({
      bookmarkId: vueId,
      eventType: "stars_delta",
      dedupeKey: "stars:old",
      detectedAt: outOfRangeIso,
    })

    const { status, body } = await client.json<FeedStatsBody>(
      "/api/feed/stats?range=7d",
    )
    expect(status).toBe(200)
    expect(body.range).toBe("7d")
    expect(body.summary.total_events).toBe(3)
    expect(body.summary.today_events).toBe(2)
    expect(body.summary.active_bookmarks).toBe(2)
    expect(body.summary.tracked_bookmarks).toBe(2)

    const byType = Object.fromEntries(
      body.events_by_type.map((r) => [r.event_type, r.count]),
    )
    expect(byType.push).toBe(2)
    expect(byType.release).toBe(1)
    expect(byType.stars_delta).toBe(0)
    expect(byType.meta_change).toBe(0)

    expect(body.daily).toHaveLength(8)
    expect(body.daily.every((d) => typeof d.date === "string")).toBe(true)
    const todayRow = body.daily.find((d) => d.date === today)
    expect(todayRow?.count).toBe(2)
    expect(body.daily.reduce((sum, d) => sum + d.count, 0)).toBe(
      body.summary.total_events,
    )
  })

  it("range=all 只返回有事件的日期，不无限补零", async () => {
    const id = await addRepo("facebook/react")
    await insertEvent({
      bookmarkId: id,
      eventType: "meta_change",
      dedupeKey: "meta:1",
      detectedAt: "2025-01-15T10:00:00.000Z",
    })
    await insertEvent({
      bookmarkId: id,
      eventType: "push",
      dedupeKey: "push:1",
      detectedAt: "2025-03-01T10:00:00.000Z",
    })

    const { status, body } = await client.json<FeedStatsBody>(
      "/api/feed/stats?range=all",
    )
    expect(status).toBe(200)
    expect(body.summary.total_events).toBe(2)
    expect(body.daily).toEqual([
      { date: "2025-01-15", count: 1 },
      { date: "2025-03-01", count: 1 },
    ])
  })

  it("since 对齐 UTC 零点：首日边界事件计入，前日不计入，daily 合计等于 total", async () => {
    const id = await addRepo("facebook/react")

    const start = new Date()
    start.setUTCDate(start.getUTCDate() - 7)
    start.setUTCHours(0, 0, 0, 0)
    const startDay = start.toISOString().slice(0, 10)

    const beforeStart = new Date(start)
    beforeStart.setUTCDate(beforeStart.getUTCDate() - 1)
    beforeStart.setUTCHours(23, 59, 0, 0)

    await insertEvent({
      bookmarkId: id,
      eventType: "push",
      dedupeKey: "push:before-window",
      detectedAt: beforeStart.toISOString(),
    })
    await insertEvent({
      bookmarkId: id,
      eventType: "release",
      dedupeKey: "release:start-boundary",
      detectedAt: `${startDay}T00:00:01.000Z`,
    })
    await insertEvent({
      bookmarkId: id,
      eventType: "meta_change",
      dedupeKey: "meta:mid",
      detectedAt: new Date().toISOString(),
    })

    const { status, body } = await client.json<FeedStatsBody>(
      "/api/feed/stats?range=7d",
    )
    expect(status).toBe(200)
    expect(body.summary.total_events).toBe(2)
    expect(body.daily.reduce((sum, d) => sum + d.count, 0)).toBe(
      body.summary.total_events,
    )
    expect(body.daily[0]?.date).toBe(startDay)
    expect(body.daily[0]?.count).toBe(1)
  })

  it("软删收藏不计入 tracked_bookmarks", async () => {
    const id = await addRepo("facebook/react")
    const before = await client.json<FeedStatsBody>("/api/feed/stats")
    expect(before.body.summary.tracked_bookmarks).toBe(1)

    await client.delete(`/api/bookmarks/${id}`)
    const after = await client.json<FeedStatsBody>("/api/feed/stats")
    expect(after.body.summary.tracked_bookmarks).toBe(0)

    const db = createDb(env)
    const softDeleted = await db
      .select({ deletedAt: bookmarks.deletedAt })
      .from(bookmarks)
      .where(eq(bookmarks.id, id))
      .get()
    expect(softDeleted?.deletedAt).toBeTruthy()
  })
})
