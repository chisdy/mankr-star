import type { Db } from "@mankr/db"
import { KB_CHAT_FOLDER_DIGEST_LIMIT } from "@mankr/shared"
import { sql } from "drizzle-orm"
import { escapeLike, loadHits, type KbBookmarkHit } from "./kb-search"

/**
 * 收藏库的分类结构。FTS 只索引收藏自身的文字，文件夹名与标签名从不参与检索，
 * 所以「「其他」里有什么」这类提问单靠关键词检索必然答不上来 —— 结构得单独喂。
 */
export type KbFolderEntry = {
  id: string
  /** 含父级的显示路径，如「前端 / React」 */
  path: string
  count: number
}

export type KbFolderDigest = {
  entries: KbFolderEntry[]
  /** 未归类收藏数 */
  unfiled: number
  /** 因上限被省略的分类数 */
  omitted: number
}

/** 目录查询失败时的降级值：结构缺失不该让整轮对话失败 */
export const EMPTY_FOLDER_DIGEST: KbFolderDigest = {
  entries: [],
  unfiled: 0,
  omitted: 0,
}

/**
 * 分类目录随每轮 prompt 常驻：它只有几十行、几百 token，
 * 而「我有哪些分类」「归类是否合理」这类问题都依赖它，按需取反而要多一次往返。
 */
export async function loadFolderDigest(
  db: Db,
  limit = KB_CHAT_FOLDER_DIGEST_LIMIT,
): Promise<KbFolderDigest> {
  const [rows, unfiledRows] = await Promise.all([
    db.all<{ id: string; name: string; parent_id: string | null; n: number }>(sql`
      SELECT f.id AS id, f.name AS name, f.parent_id AS parent_id,
             COUNT(b.id) AS n
      FROM folders f
      LEFT JOIN bookmarks b
        ON b.folder_id = f.id
       AND b.deleted_at IS NULL
       AND b.archived_at IS NULL
      GROUP BY f.id
    `),
    db.all<{ n: number }>(sql`
      SELECT COUNT(*) AS n
      FROM bookmarks
      WHERE folder_id IS NULL
        AND deleted_at IS NULL
        AND archived_at IS NULL
    `),
  ])

  const nameById = new Map(rows.map((r) => [r.id, r.name]))
  const parentById = new Map(rows.map((r) => [r.id, r.parent_id]))

  const all: KbFolderEntry[] = rows.map((row) => ({
    id: row.id,
    path: folderPath(row.id, nameById, parentById),
    count: Number(row.n),
  }))

  // 超限时按收藏数留下信息量最大的那些，再按路径排序输出
  const kept = [...all]
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, limit)
    .sort((a, b) => a.path.localeCompare(b.path))

  return {
    entries: kept,
    unfiled: Number(unfiledRows[0]?.n ?? 0),
    omitted: all.length - kept.length,
  }
}

/** 沿 parent_id 往上拼显示路径；遇到环或缺失父级就地截断 */
function folderPath(
  id: string,
  nameById: Map<string, string>,
  parentById: Map<string, string | null>,
): string {
  const names: string[] = []
  const seen = new Set<string>()
  let cursor: string | null = id

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const name = nameById.get(cursor)
    if (!name) break
    names.unshift(name)
    cursor = parentById.get(cursor) ?? null
  }

  return names.join(" / ")
}

/** 目录的 prompt 表示；库里没有任何分类时返回空串，调用方据此省掉整个区块 */
export function formatFolderDigest(digest: KbFolderDigest): string {
  if (digest.entries.length === 0 && digest.unfiled === 0) return ""

  const lines = digest.entries.map((e) => `- ${e.path}：${e.count} 条`)
  if (digest.unfiled > 0) lines.push(`- （未归类）：${digest.unfiled} 条`)
  if (digest.omitted > 0) lines.push(`- （另有 ${digest.omitted} 个分类未列出）`)
  return lines.join("\n")
}

/**
 * 工具用：把模型给的分类名（或 id）解析成一个确定的文件夹。
 * 目录里子分类显示成「父 / 子」，模型照抄整条路径是常事，
 * 整串匹配不到时退一步只用最后一段，省掉一轮无效调用。
 */
export async function resolveFolder(
  db: Db,
  nameOrId: string,
): Promise<{ id: string; name: string } | null> {
  const needle = nameOrId.trim()
  if (!needle) return null

  const direct = await lookupFolder(db, needle)
  if (direct) return direct

  const leaf = needle.split("/").at(-1)?.trim()
  return leaf && leaf !== needle ? lookupFolder(db, leaf) : null
}

async function lookupFolder(
  db: Db,
  needle: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await db.all<{ id: string; name: string }>(sql`
    SELECT id, name FROM folders
    WHERE id = ${needle}
       OR lower(name) = ${needle.toLowerCase()}
       OR lower(name) LIKE ${`%${escapeLike(needle.toLowerCase())}%`} ESCAPE '\\'
    ORDER BY
      CASE WHEN id = ${needle} THEN 0
           WHEN lower(name) = ${needle.toLowerCase()} THEN 1
           ELSE 2 END,
      length(name) ASC
    LIMIT 1
  `)
  return rows[0] ?? null
}

/** 工具用：列出某文件夹下的收藏 */
export async function listFolderBookmarks(
  db: Db,
  folderId: string,
  limit: number,
): Promise<KbBookmarkHit[]> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM bookmarks
    WHERE folder_id = ${folderId}
      AND deleted_at IS NULL
      AND archived_at IS NULL
    ORDER BY click_count DESC, created_at DESC
    LIMIT ${limit}
  `)
  return loadHits(
    db,
    rows.map((r) => r.id),
  )
}

