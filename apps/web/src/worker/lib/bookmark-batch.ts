import { bookmarkTags, bookmarks, folders, tags, type Db } from "@mankr/db"
import type { BatchBookmarksInput } from "@mankr/shared"
import { and, eq, inArray, isNull } from "drizzle-orm"
import type { Env } from "../env"
import { runAiForBookmark } from "./ai-service"
import { nowIso, slugify } from "./utils"

export type BatchBookmarksResult =
  | {
      ok: true
      status: 200
      body: {
        ok: boolean
        processed: number
        failed: Array<{ id: string; code: string }>
      }
    }
  | {
      ok: false
      status: 404 | 500
      body: { error: string; code: string }
    }

async function addTagsToBookmark(
  db: Db,
  bookmarkId: string,
  tagNames: string[],
) {
  const unique = Array.from(
    new Set(tagNames.map((t) => t.trim()).filter(Boolean)),
  )
  for (const name of unique) {
    const slug = slugify(name)
    let tag = await db.select().from(tags).where(eq(tags.slug, slug)).get()
    if (!tag) {
      const tagId = crypto.randomUUID()
      const createdAt = nowIso()
      await db.insert(tags).values({
        id: tagId,
        name,
        slug,
        createdAt,
      })
      tag = { id: tagId, name, slug, createdAt }
    }
    const existing = await db
      .select()
      .from(bookmarkTags)
      .where(
        and(
          eq(bookmarkTags.bookmarkId, bookmarkId),
          eq(bookmarkTags.tagId, tag.id),
        ),
      )
      .get()
    if (!existing) {
      await db.insert(bookmarkTags).values({
        bookmarkId,
        tagId: tag.id,
      })
    }
  }
}

/**
 * 批量收藏操作。调用方已完成 schema 校验与鉴权。
 * workIds 为空时不执行 SQL（避免 IN ()）。
 */
export async function runBookmarkBatch(
  db: Db,
  env: Env,
  input: BatchBookmarksInput,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<BatchBookmarksResult> {
  const { ids, action } = input
  const uniqueIds = Array.from(new Set(ids))
  const now = nowIso()
  const failed: Array<{ id: string; code: string }> = []
  let processed = 0

  const existingRows = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(inArray(bookmarks.id, uniqueIds), isNull(bookmarks.deletedAt)))
  const existingSet = new Set(existingRows.map((r) => r.id))

  for (const id of uniqueIds) {
    if (!existingSet.has(id)) {
      failed.push({ id, code: "NOT_FOUND" })
    }
  }
  const workIds = uniqueIds.filter((id) => existingSet.has(id))

  if (action.type === "moveFolder" && action.folderId) {
    const folder = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.id, action.folderId))
      .get()
    if (!folder) {
      return {
        ok: false,
        status: 404,
        body: { error: "文件夹不存在", code: "FOLDER_NOT_FOUND" },
      }
    }
  }

  if (workIds.length === 0) {
    return {
      ok: true,
      status: 200,
      body: { ok: failed.length === 0, processed: 0, failed },
    }
  }

  try {
    switch (action.type) {
      case "archive":
        await db
          .update(bookmarks)
          .set({ archivedAt: now, updatedAt: now })
          .where(inArray(bookmarks.id, workIds))
        processed = workIds.length
        break
      case "unarchive":
        await db
          .update(bookmarks)
          .set({ archivedAt: null, updatedAt: now })
          .where(inArray(bookmarks.id, workIds))
        processed = workIds.length
        break
      case "delete":
        await db
          .update(bookmarks)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(bookmarks.id, workIds))
        processed = workIds.length
        break
      case "moveFolder":
        await db
          .update(bookmarks)
          .set({ folderId: action.folderId, updatedAt: now })
          .where(inArray(bookmarks.id, workIds))
        processed = workIds.length
        break
      case "setFeatured":
        await db
          .update(bookmarks)
          .set({ featured: action.featured, updatedAt: now })
          .where(inArray(bookmarks.id, workIds))
        processed = workIds.length
        break
      case "setPricing":
        await db
          .update(bookmarks)
          .set({ pricing: action.pricing, updatedAt: now })
          .where(inArray(bookmarks.id, workIds))
        processed = workIds.length
        break
      case "addTags": {
        for (const id of workIds) {
          try {
            await addTagsToBookmark(db, id, action.tags)
            processed += 1
          } catch {
            failed.push({ id, code: "TAG_ERROR" })
          }
        }
        break
      }
      case "regenerateAi": {
        await db
          .update(bookmarks)
          .set({ aiStatus: "pending", updatedAt: now })
          .where(inArray(bookmarks.id, workIds))
        for (const id of workIds) {
          waitUntil(
            runAiForBookmark(db, env, id, {
              overwriteFolder: true,
              overwriteCategory: true,
            }),
          )
        }
        processed = workIds.length
        break
      }
    }
  } catch (err) {
    console.error("[bookmarks/batch]", err)
    return {
      ok: false,
      status: 500,
      body: { error: "批量操作失败", code: "BATCH_FAILED" },
    }
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: failed.length === 0,
      processed,
      failed,
    },
  }
}
