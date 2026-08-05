import { bookmarks, updateEvents } from "@mankr/db"
import { feedQuerySchema } from "@mankr/shared"
import { and, count, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { authByMethod } from "../middleware/auth"

export const feedRoutes = new Hono<AppEnv>()

feedRoutes.use("/feed", authByMethod())

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
