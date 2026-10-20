import type { Db } from "@mankr/db"
import { bookmarkTags, folders, tags } from "@mankr/db"
import {
  KB_AGENT_TOOL_RESULT_MAX_CHARS,
  KB_CHAT_FOLDER_DIGEST_LIMIT,
  KB_ORGANIZE_INDEX_DEFAULT,
  KB_ORGANIZE_INDEX_MAX,
  KB_ORGANIZE_INSPECT_FOLDER_LIMIT,
  KB_ORGANIZE_SAMPLE_TITLE_LIMIT,
  KB_ORGANIZE_SNAPSHOT_BOOKMARK_LIMIT,
  KB_ORGANIZE_SUMMARY_MAX_CHARS,
} from "@mankr/shared"
import { eq, inArray, sql } from "drizzle-orm"
import { normalizeFolderName } from "./deepseek"
import { buildPathLabel } from "./folder-utils"
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
  limit = KB_CHAT_FOLDER_DIGEST_LIMIT
): Promise<KbFolderDigest> {
  const [rows, unfiledRows] = await Promise.all([
    db.all<{
      id: string
      name: string
      parent_id: string | null
      n: number
    }>(sql`
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
  parentById: Map<string, string | null>
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
  if (digest.omitted > 0)
    lines.push(`- （另有 ${digest.omitted} 个分类未列出）`)
  return lines.join("\n")
}

/**
 * 工具用：把模型给的分类名（或 id）解析成一个确定的文件夹。
 * 目录里子分类显示成「父 / 子」，模型照抄整条路径是常事，
 * 整串匹配不到时退一步只用最后一段，省掉一轮无效调用。
 */
export async function resolveFolder(
  db: Db,
  nameOrId: string
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
  needle: string
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
  limit: number
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
    rows.map((r) => r.id)
  )
}

/** 没选文件夹时放进易变段，说明这次整理面对的是整库 */
export const KB_WHOLE_LIBRARY_SNAPSHOT =
  "范围：整个收藏库。整理可以跨文件夹调整归属。未归类条数见「收藏库分类」。"

const KB_MISSING_FOLDER_SNAPSHOT =
  "范围：指定的文件夹已不存在，按整个收藏库处理。未归类条数见「收藏库分类」。"

export type KbChatScope = {
  /** 易变段快照。只去掉尖括号，保留换行，不走 200 字的浏览上下文消毒 */
  snapshot: string
  /** 库里的文件夹名。客户端传来的名称不采用 */
  folderName?: string
}

export async function loadKbChatScope(
  db: Db,
  folderId?: string
): Promise<KbChatScope> {
  if (!folderId) return { snapshot: KB_WHOLE_LIBRARY_SNAPSHOT }
  const folder = await db
    .select()
    .from(folders)
    .where(eq(folders.id, folderId))
    .get()
  if (!folder) return { snapshot: KB_MISSING_FOLDER_SNAPSHOT }
  return {
    snapshot: await formatFolderSnapshot(db, folder),
    folderName: folder.name,
  }
}

type FolderRow = typeof folders.$inferSelect

/** 与收藏列表一致：这个文件夹子树里未删除、未归档的收藏 */
async function formatFolderSnapshot(
  db: Db,
  folder: FolderRow
): Promise<string> {
  const all = await db.select().from(folders)
  const byId = new Map(all.map((row) => [row.id, row]))
  const prefix = `${escapeLike(folder.path)}%`
  const [grouped, listed] = await Promise.all([
    db.all<{ id: string; n: number }>(sql`
      SELECT b.folder_id AS id, COUNT(*) AS n
      FROM bookmarks b
      JOIN folders f ON f.id = b.folder_id
      WHERE b.deleted_at IS NULL
        AND b.archived_at IS NULL
        AND f.path LIKE ${prefix} ESCAPE '\\'
      GROUP BY b.folder_id
    `),
    db.all<{
      id: string
      title: string
      summary_ai: string | null
      description: string | null
      folder_id: string
    }>(sql`
      SELECT b.id AS id, b.title AS title, b.summary_ai AS summary_ai,
             b.description AS description, b.folder_id AS folder_id
      FROM bookmarks b
      JOIN folders f ON f.id = b.folder_id
      WHERE b.deleted_at IS NULL
        AND b.archived_at IS NULL
        AND f.path LIKE ${prefix} ESCAPE '\\'
      ORDER BY b.click_count DESC, b.created_at DESC
      LIMIT ${KB_ORGANIZE_SNAPSHOT_BOOKMARK_LIMIT}
    `),
  ])

  const direct = new Map(grouped.map((row) => [row.id, Number(row.n)]))
  const subtreeCount = (path: string) => {
    let sum = 0
    for (const row of all) {
      if (row.path.startsWith(path)) sum += direct.get(row.id) ?? 0
    }
    return sum
  }
  const total = subtreeCount(folder.path)
  const tagNames = await loadTagNames(
    db,
    listed.map((row) => row.id)
  )
  const children = all
    .filter((row) => row.parentId === folder.id)
    .sort((a, b) => a.name.localeCompare(b.name))

  const lines = [
    `路径：${plain(buildPathLabel(folder, byId), 300)}`,
    `id：${folder.id}`,
    `简介：${plain(folder.description, 300)}`,
    children.length === 0
      ? "直接子文件夹：无"
      : [
          "直接子文件夹：",
          ...children.map(
            (child) =>
              `- ${plain(child.name, 64)}（${child.id}）子树 ${subtreeCount(child.path)} 条`
          ),
        ].join("\n"),
    `子树收藏（未删除、未归档）：${total} 条，列出 ${listed.length} 条`,
  ]
  for (const row of listed) {
    const place = byId.get(row.folder_id)
    lines.push(
      [
        row.id,
        plain(row.title, 80),
        plain(row.summary_ai || row.description, KB_ORGANIZE_SUMMARY_MAX_CHARS),
        tagNames.get(row.id)?.join("、") || "无",
        place ? plain(buildPathLabel(place, byId), 300) : "未归类",
      ].join(" | ")
    )
  }
  if (total > listed.length) {
    lines.push(
      `另有 ${total - listed.length} 条未列出。条数仍是子树总数，没有把正文摘录放进来。`
    )
  }
  return lines.join("\n")
}

export type DuplicateHintFolder = {
  name: string
  path: string
  count: number
}

/** 只产生提示文本，不生成合并操作 */
export function buildDuplicateHints(
  entries: readonly DuplicateHintFolder[]
): string[] {
  const hints: string[] = []
  const byName = new Map<string, DuplicateHintFolder[]>()
  for (const entry of entries) {
    const key = normalizeFolderName(entry.name)
    if (!key) continue
    const list = byName.get(key) ?? []
    list.push(entry)
    byName.set(key, list)
  }
  for (const list of byName.values()) {
    if (list.length < 2) continue
    hints.push(
      `名称「${plain(list[0]?.name, 64)}」归一化后相同：${list.map((entry) => entry.path).join("；")}`
    )
  }

  const named = entries
    .map((entry) => ({ ...entry, norm: normalizeFolderName(entry.name) }))
    .filter((entry) => entry.norm.length >= 2)
  for (const left of named) {
    for (const right of named) {
      if (left.path === right.path || left.norm === right.norm) continue
      if (left.count <= 0 || right.count <= 0) continue
      if (
        left.norm.length < right.norm.length &&
        right.norm.includes(left.norm)
      ) {
        hints.push(
          `「${left.path}」的名称被「${right.path}」包含，且两边都有收藏`
        )
      }
    }
  }
  return hints.slice(0, 12)
}

/** 只读检查：路径、简介、子树条数、少量标题，外加疑似重复提示 */
export async function inspectLibrary(db: Db): Promise<string> {
  const all = await db.select().from(folders)
  const byId = new Map(all.map((row) => [row.id, row]))
  const [grouped, samples, unfiledRows] = await Promise.all([
    db.all<{ id: string; n: number }>(sql`
      SELECT folder_id AS id, COUNT(*) AS n
      FROM bookmarks
      WHERE deleted_at IS NULL
        AND archived_at IS NULL
        AND folder_id IS NOT NULL
      GROUP BY folder_id
    `),
    db.all<{ folder_id: string; title: string }>(sql`
      SELECT folder_id, title
      FROM (
        SELECT folder_id, title,
               ROW_NUMBER() OVER (PARTITION BY folder_id ORDER BY title ASC) AS rn
        FROM bookmarks
        WHERE deleted_at IS NULL
          AND archived_at IS NULL
          AND folder_id IS NOT NULL
      ) AS sampled
      WHERE rn <= ${KB_ORGANIZE_SAMPLE_TITLE_LIMIT}
    `),
    db.all<{ n: number }>(sql`
      SELECT COUNT(*) AS n
      FROM bookmarks
      WHERE folder_id IS NULL
        AND deleted_at IS NULL
        AND archived_at IS NULL
    `),
  ])
  const direct = new Map(grouped.map((row) => [row.id, Number(row.n)]))
  const titlesByFolder = new Map<string, string[]>()
  for (const row of samples) {
    const list = titlesByFolder.get(row.folder_id) ?? []
    list.push(row.title)
    titlesByFolder.set(row.folder_id, list)
  }
  const subtreeCount = (path: string) => {
    let sum = 0
    for (const row of all) {
      if (row.path.startsWith(path)) sum += direct.get(row.id) ?? 0
    }
    return sum
  }
  const sampleTitles = (path: string) => {
    const titles: string[] = []
    for (const row of all) {
      if (!row.path.startsWith(path)) continue
      for (const title of titlesByFolder.get(row.id) ?? []) {
        titles.push(title)
        if (titles.length >= KB_ORGANIZE_SAMPLE_TITLE_LIMIT) return titles
      }
    }
    return titles
  }

  const entries = all
    .map((row) => ({
      row,
      path: buildPathLabel(row, byId),
      count: subtreeCount(row.path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const shown = entries.slice(0, KB_ORGANIZE_INSPECT_FOLDER_LIMIT)
  const hints = buildDuplicateHints(
    entries.map((entry) => ({
      name: entry.row.name,
      path: entry.path,
      count: entry.count,
    }))
  )

  const lines = [
    `共 ${entries.length} 个文件夹。条数是子树里未删除、未归档的收藏，和收藏列表一致。`,
    `未归类：${Number(unfiledRows[0]?.n ?? 0)} 条`,
    "",
  ]
  for (const entry of shown) {
    const titles = sampleTitles(entry.row.path).map((title) => plain(title, 40))
    lines.push(
      [
        `- ${entry.path}（${entry.row.id}）`,
        `  简介：${plain(entry.row.description, 80)}`,
        `  条数：${entry.count}`,
        `  样本：${titles.length > 0 ? titles.join("、") : "无"}`,
      ].join("\n")
    )
  }
  if (entries.length > shown.length) {
    lines.push(`另有 ${entries.length - shown.length} 个文件夹未列出。`)
  }
  lines.push("")
  lines.push("疑似重复（只是提示，不会自动合并）：")
  lines.push(
    hints.length > 0
      ? hints.map((hint) => `- ${hint}`).join("\n")
      : "- 没有发现"
  )
  return capToolText(lines.join("\n"))
}

/** 紧凑列表：id、标题、标签、短摘要。不登记为引用来源 */
export async function listBookmarkIndex(
  db: Db,
  input: { folderId?: string; limit?: number }
): Promise<string> {
  const limit = clampIndexLimit(input.limit)
  const folder = input.folderId
    ? await db
        .select()
        .from(folders)
        .where(eq(folders.id, input.folderId))
        .get()
    : undefined
  if (input.folderId && !folder) return "没有这个文件夹。"

  const prefix = folder ? `${escapeLike(folder.path)}%` : null
  const rows = await db.all<{
    id: string
    title: string
    summary_ai: string | null
    description: string | null
    folder_id: string | null
  }>(
    prefix
      ? sql`
          SELECT b.id AS id, b.title AS title, b.summary_ai AS summary_ai,
                 b.description AS description, b.folder_id AS folder_id
          FROM bookmarks b
          LEFT JOIN folders f ON f.id = b.folder_id
          WHERE b.deleted_at IS NULL
            AND b.archived_at IS NULL
            AND f.path LIKE ${prefix} ESCAPE '\\'
          ORDER BY b.click_count DESC, b.created_at DESC
          LIMIT ${limit}
        `
      : sql`
          SELECT id, title, summary_ai, description, folder_id
          FROM bookmarks
          WHERE deleted_at IS NULL
            AND archived_at IS NULL
          ORDER BY click_count DESC, created_at DESC
          LIMIT ${limit}
        `
  )
  const all = await db
    .select({ id: folders.id, name: folders.name, path: folders.path })
    .from(folders)
  const byId = new Map(all.map((row) => [row.id, row]))
  const tagNames = await loadTagNames(
    db,
    rows.map((row) => row.id)
  )
  const lines = rows.map((row) => {
    const place = row.folder_id ? byId.get(row.folder_id) : undefined
    return [
      row.id,
      plain(row.title, 80),
      tagNames.get(row.id)?.join("、") || "无",
      plain(row.summary_ai || row.description, KB_ORGANIZE_SUMMARY_MAX_CHARS),
      place ? plain(buildPathLabel(place, byId), 120) : "未归类",
    ].join(" | ")
  })
  const header = folder
    ? `「${plain(buildPathLabel(folder, byId), 120)}」子树里的收藏（未删除、未归档）：`
    : "整个收藏库的收藏（未删除、未归档）："
  return capLines([header, ...lines], KB_AGENT_TOOL_RESULT_MAX_CHARS - 400)
}

export function capLines(lines: readonly string[], maxChars: number): string {
  const kept: string[] = []
  let size = 0
  for (const line of lines) {
    const next = size + line.length + 1
    if (kept.length > 0 && next > maxChars) break
    kept.push(line)
    size = next
  }
  const omitted = lines.length - kept.length
  if (omitted > 0) kept.push(`另有 ${omitted} 条未列出，以免超出长度。`)
  return kept.join("\n")
}

function capToolText(text: string): string {
  const max = KB_AGENT_TOOL_RESULT_MAX_CHARS - 400
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n（其余内容已截断）`
}

function clampIndexLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return KB_ORGANIZE_INDEX_DEFAULT
  return Math.max(
    1,
    Math.min(
      Math.trunc(value ?? KB_ORGANIZE_INDEX_DEFAULT),
      KB_ORGANIZE_INDEX_MAX
    )
  )
}

async function loadTagNames(
  db: Db,
  bookmarkIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (bookmarkIds.length === 0) return map
  const rows = await db
    .select({ bookmarkId: bookmarkTags.bookmarkId, name: tags.name })
    .from(bookmarkTags)
    .innerJoin(tags, eq(tags.id, bookmarkTags.tagId))
    .where(inArray(bookmarkTags.bookmarkId, bookmarkIds))
  for (const row of rows) {
    const list = map.get(row.bookmarkId) ?? []
    list.push(plain(row.name, 32))
    map.set(row.bookmarkId, list)
  }
  return map
}

/** 快照字段去掉尖括号和换行，整段快照本身保留换行 */
function plain(value: string | null | undefined, max: number): string {
  const clean = (value ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim()
  if (!clean) return "无"
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}
