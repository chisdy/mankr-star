import { bookmarkTags, bookmarks, tags } from "@mankr/db"
import {
  DEFAULT_FACET_PAGE_SIZE,
  batchTagsSchema,
  listTagsQuerySchema,
  mergeTagsPreviewSchema,
  mergeTagsSchema,
  updateTagSchema,
} from "@mankr/shared"
import { and, asc, count, desc, eq, inArray, isNull, like, ne, or } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { mergeTagIntoTarget, previewMergeTags, runTagBatch, usageCountForTag } from "../lib/tag-batch"
import { slugify } from "../lib/utils"
import { authByMethod } from "../middleware/auth"

export const tagRoutes = new Hono<AppEnv>()

tagRoutes.use("/tags", authByMethod())
tagRoutes.use("/tags/*", authByMethod())

tagRoutes.get("/tags", async (c) => {
  const db = c.get("db")
  const query = listTagsQuerySchema.safeParse(c.req.query())
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

  const { q, page, pageSize = DEFAULT_FACET_PAGE_SIZE } = query.data
  // 只有显式带 page 才分页；缺省仍返回全量，兼容标签管理页等调用方
  const paginated = page !== undefined

  const filter = q
    ? or(like(tags.name, `%${q}%`), like(tags.slug, `%${q}%`))
    : undefined

  // count(bookmarks.id)：软删/归档收藏在 join 条件外，id 为 null，不计入
  const usageCount = count(bookmarks.id).as("usage_count")

  const listQuery = db
    .select({
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
      created_at: tags.createdAt,
      usage_count: usageCount,
    })
    .from(tags)
    .leftJoin(bookmarkTags, eq(tags.id, bookmarkTags.tagId))
    .leftJoin(
      bookmarks,
      and(
        eq(bookmarkTags.bookmarkId, bookmarks.id),
        isNull(bookmarks.deletedAt),
        isNull(bookmarks.archivedAt),
      ),
    )
    .where(filter)
    .groupBy(tags.id)
    .orderBy(desc(usageCount), asc(tags.name))

  const rows = paginated
    ? await listQuery.limit(pageSize).offset((page - 1) * pageSize)
    : await listQuery

  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    usage_count: Number(r.usage_count),
    created_at: r.created_at,
  }))

  if (!paginated) return c.json({ items, total: items.length })

  // 分组数 = 匹配的标签数，直接数 tags 表，避免把 join 行数当总数
  const [totalRow] = await db
    .select({ value: count() })
    .from(tags)
    .where(filter)

  return c.json({
    items,
    page,
    pageSize,
    total: Number(totalRow?.value ?? 0),
  })
})

tagRoutes.patch("/tags/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = updateTagSchema.safeParse(body)
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

  const existing = await db.select().from(tags).where(eq(tags.id, id)).get()
  if (!existing) {
    return c.json({ error: "标签不存在", code: "NOT_FOUND" }, 404)
  }

  const nextName = parsed.data.name
  const nextSlug = slugify(nextName)

  if (nextName === existing.name && nextSlug === existing.slug) {
    const usage_count = await usageCountForTag(db, id)
    return c.json({
      id: existing.id,
      name: existing.name,
      slug: existing.slug,
      usage_count,
      created_at: existing.createdAt,
    })
  }

  const conflict = await db
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(
        ne(tags.id, id),
        or(eq(tags.name, nextName), eq(tags.slug, nextSlug)),
      ),
    )
    .get()

  if (conflict) {
    return c.json({ error: "标签名称或标识已存在", code: "DUPLICATE" }, 409)
  }

  await db
    .update(tags)
    .set({ name: nextName, slug: nextSlug })
    .where(eq(tags.id, id))

  const usage_count = await usageCountForTag(db, id)
  return c.json({
    id,
    name: nextName,
    slug: nextSlug,
    usage_count,
    created_at: existing.createdAt,
  })
})

tagRoutes.post("/tags/merge", async (c) => {
  const db = c.get("db")
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = mergeTagsSchema.safeParse(body)
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

  const { sourceId, targetId } = parsed.data

  const source = await db.select().from(tags).where(eq(tags.id, sourceId)).get()
  if (!source) {
    return c.json({ error: "源标签不存在", code: "NOT_FOUND" }, 404)
  }
  const target = await db.select().from(tags).where(eq(tags.id, targetId)).get()
  if (!target) {
    return c.json({ error: "目标标签不存在", code: "NOT_FOUND" }, 404)
  }

  await mergeTagIntoTarget(db, sourceId, targetId)

  const usage_count = await usageCountForTag(db, targetId)
  return c.json({
    id: target.id,
    name: target.name,
    slug: target.slug,
    usage_count,
    created_at: target.createdAt,
  })
})

tagRoutes.post("/tags/merge/preview", async (c) => {
  const db = c.get("db")
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = mergeTagsPreviewSchema.safeParse(body)
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

  const { sourceIds, targetId } = parsed.data
  const target = await db.select().from(tags).where(eq(tags.id, targetId)).get()
  if (!target) {
    return c.json({ error: "目标标签不存在", code: "NOT_FOUND" }, 404)
  }
  const sources = await db
    .select({ id: tags.id })
    .from(tags)
    .where(inArray(tags.id, sourceIds))
  if (sources.length !== sourceIds.length) {
    return c.json({ error: "源标签不存在", code: "NOT_FOUND" }, 404)
  }

  const preview = await previewMergeTags(db, sourceIds, targetId)
  return c.json(preview)
})

tagRoutes.post("/tags/batch", async (c) => {
  const db = c.get("db")
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = batchTagsSchema.safeParse(body)
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

  const result = await runTagBatch(db, parsed.data)
  return c.json(result.body, result.status)
})

// Must register before DELETE /tags/:id so "empty" is not treated as an id.
tagRoutes.delete("/tags/empty", async (c) => {
  const db = c.get("db")

  const usageCount = count(bookmarks.id).as("usage_count")
  const rows = await db
    .select({
      id: tags.id,
      usage_count: usageCount,
    })
    .from(tags)
    .leftJoin(bookmarkTags, eq(tags.id, bookmarkTags.tagId))
    .leftJoin(
      bookmarks,
      and(
        eq(bookmarkTags.bookmarkId, bookmarks.id),
        isNull(bookmarks.deletedAt),
        isNull(bookmarks.archivedAt),
      ),
    )
    .groupBy(tags.id)

  const emptyIds = rows
    .filter((r) => Number(r.usage_count) === 0)
    .map((r) => r.id)

  if (emptyIds.length === 0) {
    return c.json({ ok: true, deleted: 0 })
  }

  await db.delete(tags).where(inArray(tags.id, emptyIds))
  return c.json({ ok: true, deleted: emptyIds.length })
})

tagRoutes.delete("/tags/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")

  const existing = await db.select().from(tags).where(eq(tags.id, id)).get()
  if (!existing) {
    return c.json({ error: "标签不存在", code: "NOT_FOUND" }, 404)
  }

  await db.delete(tags).where(eq(tags.id, id))
  return c.json({ ok: true })
})
