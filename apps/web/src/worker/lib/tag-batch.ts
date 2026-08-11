import { bookmarkTags, bookmarks, tags, type Db } from "@mankr/db"
import type { BatchTagsInput } from "@mankr/shared"
import { and, count, eq, inArray, isNull } from "drizzle-orm"

export type BatchTagsResult =
  | {
      ok: true
      status: 200
      body: {
        ok: boolean
        processed: number
        failed: Array<{ id: string; code: string }>
        target?: { id: string; usage_count: number }
      }
    }
  | {
      ok: false
      status: 404 | 400
      body: { error: string; code: string }
    }

export type MergeTagsPreview = {
  unique_count: number
  additive_count: number
  per_tag: Array<{ id: string; usage_count: number }>
}

/** 与列表默认 ?tag= 口径一致：未软删且未归档 */
export async function usageCountForTag(
  db: Db,
  tagId: string,
): Promise<number> {
  const row = await db
    .select({ usage_count: count(bookmarks.id) })
    .from(bookmarkTags)
    .innerJoin(bookmarks, eq(bookmarkTags.bookmarkId, bookmarks.id))
    .where(
      and(
        eq(bookmarkTags.tagId, tagId),
        isNull(bookmarks.deletedAt),
        isNull(bookmarks.archivedAt),
      ),
    )
    .get()
  return Number(row?.usage_count ?? 0)
}

/** 合并前预览：标签计数相加 vs 收藏去重后的真实数量 */
export async function previewMergeTags(
  db: Db,
  sourceIds: string[],
  targetId: string,
): Promise<MergeTagsPreview> {
  const tagIds = Array.from(new Set([...sourceIds, targetId]))
  const per_tag: Array<{ id: string; usage_count: number }> = []
  for (const id of tagIds) {
    per_tag.push({ id, usage_count: await usageCountForTag(db, id) })
  }
  const additive_count = per_tag.reduce((sum, row) => sum + row.usage_count, 0)

  const links = await db
    .select({ bookmarkId: bookmarkTags.bookmarkId })
    .from(bookmarkTags)
    .innerJoin(bookmarks, eq(bookmarkTags.bookmarkId, bookmarks.id))
    .where(
      and(
        inArray(bookmarkTags.tagId, tagIds),
        isNull(bookmarks.deletedAt),
        isNull(bookmarks.archivedAt),
      ),
    )
  const unique_count = new Set(links.map((row) => row.bookmarkId)).size

  return { unique_count, additive_count, per_tag }
}

/** 将单个源标签的收藏关联迁移到目标，并删除源标签 */
export async function mergeTagIntoTarget(
  db: Db,
  sourceId: string,
  targetId: string,
): Promise<void> {
  const sourceLinks = await db
    .select()
    .from(bookmarkTags)
    .where(eq(bookmarkTags.tagId, sourceId))

  for (const link of sourceLinks) {
    const already = await db
      .select()
      .from(bookmarkTags)
      .where(
        and(
          eq(bookmarkTags.bookmarkId, link.bookmarkId),
          eq(bookmarkTags.tagId, targetId),
        ),
      )
      .get()

    // 先删源关联，再按需插入目标关联，避免 UPDATE 撞上 (bookmark_id, tag_id) 唯一约束
    await db
      .delete(bookmarkTags)
      .where(
        and(
          eq(bookmarkTags.bookmarkId, link.bookmarkId),
          eq(bookmarkTags.tagId, sourceId),
        ),
      )

    if (!already) {
      await db.insert(bookmarkTags).values({
        bookmarkId: link.bookmarkId,
        tagId: targetId,
      })
    }
  }

  await db.delete(tags).where(eq(tags.id, sourceId))
}

/**
 * 批量标签操作。调用方已完成 schema 校验与鉴权。
 */
export async function runTagBatch(
  db: Db,
  input: BatchTagsInput,
): Promise<BatchTagsResult> {
  const { ids, action } = input
  const uniqueIds = Array.from(new Set(ids)).filter(
    (id) => id !== action.targetId,
  )
  const failed: Array<{ id: string; code: string }> = []
  let processed = 0

  if (action.type === "merge") {
    const target = await db
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.id, action.targetId))
      .get()
    if (!target) {
      return {
        ok: false,
        status: 404,
        body: { error: "目标标签不存在", code: "NOT_FOUND" },
      }
    }

    const existingRows =
      uniqueIds.length === 0
        ? []
        : await db
            .select({ id: tags.id })
            .from(tags)
            .where(inArray(tags.id, uniqueIds))
    const existingSet = new Set(existingRows.map((r) => r.id))

    for (const id of uniqueIds) {
      if (!existingSet.has(id)) {
        failed.push({ id, code: "NOT_FOUND" })
      }
    }
    const workIds = uniqueIds.filter((id) => existingSet.has(id))

    for (const sourceId of workIds) {
      try {
        await mergeTagIntoTarget(db, sourceId, action.targetId)
        processed += 1
      } catch {
        failed.push({ id: sourceId, code: "MERGE_ERROR" })
      }
    }

    const usage_count = await usageCountForTag(db, action.targetId)
    return {
      ok: true,
      status: 200,
      body: {
        ok: failed.length === 0,
        processed,
        failed,
        target: { id: action.targetId, usage_count },
      },
    }
  }

  return {
    ok: true,
    status: 200,
    body: { ok: failed.length === 0, processed, failed },
  }
}
