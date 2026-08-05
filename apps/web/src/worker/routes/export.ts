import {
  bookmarkTags,
  bookmarks,
  folders,
  tags,
  updateEvents,
} from "@mankr/db"
import { isNull } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { requireAuth } from "../middleware/auth"

export const exportRoutes = new Hono<AppEnv>()

exportRoutes.use("/export", requireAuth)

exportRoutes.get("/export", async (c) => {
  const db = c.get("db")

  const bookmarkRows = await db
    .select()
    .from(bookmarks)
    .where(isNull(bookmarks.deletedAt))

  const folderRows = await db.select().from(folders)
  const tagRows = await db.select().from(tags)
  const linkRows = await db.select().from(bookmarkTags)
  const eventRows = await db.select().from(updateEvents)

  const tagsByBookmark = new Map<string, string[]>()
  const tagNameById = new Map(tagRows.map((t) => [t.id, t.name]))
  for (const link of linkRows) {
    const name = tagNameById.get(link.tagId)
    if (!name) continue
    const list = tagsByBookmark.get(link.bookmarkId) ?? []
    list.push(name)
    tagsByBookmark.set(link.bookmarkId, list)
  }

  return c.json({
    exported_at: new Date().toISOString(),
    version: 2,
    folders: folderRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      color: r.color,
      sort_order: r.sortOrder,
      description: r.description,
      parent_id: r.parentId,
      depth: r.depth,
      path: r.path,
    })),
    tags: tagRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
    })),
    bookmarks: bookmarkRows.map((b) => ({
      id: b.id,
      source_type: b.sourceType,
      canonical_url: b.canonicalUrl,
      external_id: b.externalId,
      owner: b.owner,
      title: b.title,
      description: b.description,
      language: b.language,
      stars: b.stars,
      forks: b.forks,
      summary_ai: b.summaryAi,
      folder_id: b.folderId,
      notes: b.notes,
      ai_status: b.aiStatus,
      topics: JSON.parse(b.topicsJson || "[]"),
      tags: tagsByBookmark.get(b.id) ?? [],
      track_updates: b.trackUpdates,
      archived_at: b.archivedAt,
      click_count: b.clickCount,
      created_at: b.createdAt,
      updated_at: b.updatedAt,
    })),
    update_events: eventRows.map((e) => ({
      id: e.id,
      bookmark_id: e.bookmarkId,
      event_type: e.eventType,
      payload: JSON.parse(e.payloadJson || "{}"),
      detected_at: e.detectedAt,
    })),
  })
})
