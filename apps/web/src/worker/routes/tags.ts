import { bookmarkTags, tags } from "@mankr/db"
import { asc, count, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { authByMethod } from "../middleware/auth"

export const tagRoutes = new Hono<AppEnv>()

tagRoutes.use("/tags", authByMethod())
tagRoutes.use("/tags/*", authByMethod())

tagRoutes.get("/tags", async (c) => {
  const db = c.get("db")

  const usageCount = count(bookmarkTags.bookmarkId).as("usage_count")

  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
      created_at: tags.createdAt,
      usage_count: usageCount,
    })
    .from(tags)
    .leftJoin(bookmarkTags, eq(tags.id, bookmarkTags.tagId))
    .groupBy(tags.id)
    .orderBy(desc(usageCount), asc(tags.name))

  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      usage_count: Number(r.usage_count),
      created_at: r.created_at,
    })),
  })
})
