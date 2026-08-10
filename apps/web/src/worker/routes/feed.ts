import { bookmarks, updateEvents } from "@mankr/db"
import {
  DEFAULT_INSIGHTS_RANGE,
  UPDATE_EVENT_TYPES,
  type InsightsRange,
  feedQuerySchema,
  insightsQuerySchema,
} from "@mankr/shared"
import { and, asc, count, desc, eq, gte, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { authByMethod } from "../middleware/auth"

export const feedRoutes = new Hono<AppEnv>()

feedRoutes.use("/feed", authByMethod())
feedRoutes.use("/feed/*", authByMethod())

/** 回推 N 天并对齐 UTC 零点，保证 daily 柱合计与 total_events 一致 */
function rangeStartIso(range: InsightsRange): string | null {
  if (range === "all") return null
  const days = range === "7d" ? 7 : 30
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function utcDateString(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function fillDailySeries(
  range: InsightsRange,
  since: string | null,
  rows: Array<{ date: string; count: number }>,
): Array<{ date: string; count: number }> {
  // all：只返回有事件的日期，避免无限补零
  if (range === "all" || !since) {
    return rows
  }

  const byDate = new Map(rows.map((r) => [r.date, r.count]))
  const start = new Date(`${since.slice(0, 10)}T00:00:00.000Z`)
  const end = new Date(`${utcDateString()}T00:00:00.000Z`)
  const filled: Array<{ date: string; count: number }> = []
  for (
    let cur = new Date(start);
    cur.getTime() <= end.getTime();
    cur.setUTCDate(cur.getUTCDate() + 1)
  ) {
    const key = cur.toISOString().slice(0, 10)
    filled.push({ date: key, count: byDate.get(key) ?? 0 })
  }
  return filled
}

feedRoutes.get("/feed", async (c) => {
  const db = c.get("db")
  const query = feedQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: query.error.flatten(),
      },
      400,
    )
  }

  const { page, pageSize, eventType, bookmarkId } = query.data
  const conditions = []
  if (eventType) conditions.push(eq(updateEvents.eventType, eventType))
  if (bookmarkId) conditions.push(eq(updateEvents.bookmarkId, bookmarkId))
  const where = conditions.length ? and(...conditions) : undefined

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(updateEvents)
    .where(where)

  const rows = await db
    .select({
      id: updateEvents.id,
      bookmark_id: updateEvents.bookmarkId,
      event_type: updateEvents.eventType,
      payload_json: updateEvents.payloadJson,
      detected_at: updateEvents.detectedAt,
      bookmark_title: bookmarks.title,
      bookmark_url: bookmarks.canonicalUrl,
      external_id: bookmarks.externalId,
    })
    .from(updateEvents)
    .leftJoin(bookmarks, eq(updateEvents.bookmarkId, bookmarks.id))
    .where(where)
    .orderBy(desc(updateEvents.detectedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return c.json({
    items: rows.map((r) => {
      let payload: unknown = {}
      try {
        payload = JSON.parse(r.payload_json || "{}")
      } catch {
        /* ignore */
      }
      return {
        id: r.id,
        bookmark_id: r.bookmark_id,
        event_type: r.event_type,
        payload,
        detected_at: r.detected_at,
        bookmark: r.bookmark_title
          ? {
              title: r.bookmark_title,
              canonical_url: r.bookmark_url,
              external_id: r.external_id,
            }
          : null,
      }
    }),
    page,
    pageSize,
    total,
  })
})

feedRoutes.get("/feed/stats", async (c) => {
  const db = c.get("db")
  const parsed = insightsQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      400,
    )
  }

  const range = parsed.data.range ?? DEFAULT_INSIGHTS_RANGE
  const since = rangeStartIso(range)
  const today = utcDateString()
  const eventWhere = since ? gte(updateEvents.detectedAt, since) : undefined

  const [
    [{ total_events }],
    [{ today_events }],
    [{ active_bookmarks }],
    [{ tracked_bookmarks }],
    eventRows,
    dailyRows,
  ] = await Promise.all([
    db
      .select({ total_events: count() })
      .from(updateEvents)
      .where(eventWhere),
    db
      .select({ today_events: count() })
      .from(updateEvents)
      .where(sql`substr(${updateEvents.detectedAt}, 1, 10) = ${today}`),
    db
      .select({
        active_bookmarks: sql<number>`count(distinct ${updateEvents.bookmarkId})`,
      })
      .from(updateEvents)
      .where(eventWhere),
    db
      .select({ tracked_bookmarks: count() })
      .from(bookmarks)
      .where(and(eq(bookmarks.trackUpdates, true), isNull(bookmarks.deletedAt))),
    db
      .select({
        event_type: updateEvents.eventType,
        count: count(),
      })
      .from(updateEvents)
      .where(eventWhere)
      .groupBy(updateEvents.eventType),
    db
      .select({
        date: sql<string>`substr(${updateEvents.detectedAt}, 1, 10)`,
        count: count(),
      })
      .from(updateEvents)
      .where(eventWhere)
      .groupBy(sql`substr(${updateEvents.detectedAt}, 1, 10)`)
      .orderBy(asc(sql`substr(${updateEvents.detectedAt}, 1, 10)`)),
  ])

  const countByType = new Map(
    eventRows.map((r) => [r.event_type, Number(r.count)]),
  )
  const events_by_type = UPDATE_EVENT_TYPES.map((event_type) => ({
    event_type,
    count: countByType.get(event_type) ?? 0,
  }))

  const daily = fillDailySeries(
    range,
    since,
    dailyRows.map((r) => ({ date: r.date, count: Number(r.count) })),
  )

  return c.json({
    range,
    summary: {
      total_events: Number(total_events),
      today_events: Number(today_events),
      active_bookmarks: Number(active_bookmarks),
      tracked_bookmarks: Number(tracked_bookmarks),
    },
    events_by_type,
    daily,
  })
})
