import type { Db } from "@mankr/db"
import { sql } from "drizzle-orm"
import {
  buildMatchExpression,
  escapeLike,
  extractQueryTerms,
} from "./kb-search"

/** FTS5 可检索列（不含 unindexed 的 bookmark_id） */
const FTS_COLUMNS_WITH_NOTES = [
  "title",
  "description",
  "summary_ai",
  "notes",
  "content_excerpt",
  "external_id",
  "owner",
  "site_name",
] as const

const FTS_COLUMNS_PUBLIC = FTS_COLUMNS_WITH_NOTES.filter((c) => c !== "notes")

/** 列表检索兜底上限：个人库体量下足够，避免无界 IN */
const DEFAULT_ID_LIMIT = 5000

/**
 * 公开浏览：列限定 MATCH，不查 notes。
 * 登录用户：整行 MATCH（含 notes）。
 */
export function buildColumnMatchExpression(
  terms: string[],
  includeNotes: boolean,
): string {
  const columns = includeNotes ? FTS_COLUMNS_WITH_NOTES : FTS_COLUMNS_PUBLIC
  const parts: string[] = []
  for (const term of terms) {
    const phrase = `"${term.replace(/"/g, '""')}"`
    for (const col of columns) {
      parts.push(`${col}:${phrase}`)
    }
  }
  return parts.join(" OR ")
}

/**
 * 按 q 查 bookmarks_fts，返回命中 id（已去重、按 bm25 排序）。
 * 短词走 LIKE 兜底；公开浏览 LIKE 不含 notes。
 */
export async function queryBookmarkIdsByFts(
  db: Db,
  opts: {
    q: string
    includeNotes: boolean
    limit?: number
  },
): Promise<string[]> {
  const q = opts.q.trim()
  if (!q) return []

  const limit = opts.limit ?? DEFAULT_ID_LIMIT
  const terms = extractQueryTerms(q)
  const ids: string[] = []

  if (terms.fts.length > 0) {
    const match = opts.includeNotes
      ? buildMatchExpression(terms.fts)
      : buildColumnMatchExpression(terms.fts, false)
    try {
      const rows = await db.all<{ id: string }>(sql`
        SELECT f.bookmark_id AS id
        FROM bookmarks_fts f
        JOIN bookmarks b ON b.id = f.bookmark_id
        WHERE bookmarks_fts MATCH ${match}
          AND b.deleted_at IS NULL
        ORDER BY bm25(bookmarks_fts, 0, 10.0, 5.0, 5.0, 3.0, 2.0, 2.0, 1.0, 1.0)
        LIMIT ${limit}
      `)
      for (const row of rows) {
        if (!ids.includes(row.id)) ids.push(row.id)
      }
    } catch (err) {
      console.error("[bookmark-fts] match failed", err)
    }
  }

  const hasShortTerms = terms.all.length > terms.fts.length
  const needLike =
    ids.length === 0 || (hasShortTerms && ids.length < limit)

  if (needLike && terms.all.length > 0) {
    const likeIds = await likeFallbackIds(db, {
      terms: terms.all,
      includeNotes: opts.includeNotes,
      limit,
    })
    for (const id of likeIds) {
      if (ids.length >= limit) break
      if (!ids.includes(id)) ids.push(id)
    }
  }

  // 若分词后为空（极短输入），仍对原始 q 做一次 LIKE
  if (ids.length === 0 && terms.all.length === 0 && q.length > 0) {
    return likeFallbackIds(db, {
      terms: [q.toLowerCase()],
      includeNotes: opts.includeNotes,
      limit,
    })
  }

  return ids
}

async function likeFallbackIds(
  db: Db,
  opts: {
    terms: string[]
    includeNotes: boolean
    limit: number
  },
): Promise<string[]> {
  const patterns = opts.terms.map((t) => `%${escapeLike(t.toLowerCase())}%`)
  const blob = opts.includeNotes ? LIST_BLOB_WITH_NOTES : LIST_BLOB_PUBLIC
  const clause = sql.join(
    patterns.map((p) => sql`${blob} LIKE ${p} ESCAPE '\\'`),
    sql` OR `,
  )
  const rows = await db.all<{ id: string }>(sql`
    SELECT b.id AS id
    FROM bookmarks b
    WHERE b.deleted_at IS NULL
      AND (${clause})
    ORDER BY b.created_at DESC
    LIMIT ${opts.limit}
  `)
  return rows.map((r) => r.id)
}

const LIST_BLOB_WITH_NOTES = sql`lower(
  b.title || ' ' ||
  coalesce(b.description, '') || ' ' ||
  coalesce(b.summary_ai, '') || ' ' ||
  coalesce(b.notes, '') || ' ' ||
  coalesce(b.content_excerpt, '') || ' ' ||
  coalesce(b.external_id, '') || ' ' ||
  coalesce(b.owner, '') || ' ' ||
  coalesce(b.site_name, '')
)`

const LIST_BLOB_PUBLIC = sql`lower(
  b.title || ' ' ||
  coalesce(b.description, '') || ' ' ||
  coalesce(b.summary_ai, '') || ' ' ||
  coalesce(b.content_excerpt, '') || ' ' ||
  coalesce(b.external_id, '') || ' ' ||
  coalesce(b.owner, '') || ' ' ||
  coalesce(b.site_name, '')
)`
