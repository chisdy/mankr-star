import type { Db } from "@mankr/db"
import {
  KB_CHAT_MATCHED_CATEGORY_LIMIT,
  KB_CHAT_SNIPPET_MAX_CHARS,
  type KbChatSource,
} from "@mankr/shared"
import { sql } from "drizzle-orm"

/** 命中的收藏，供 prompt 拼装与 sources 展示 */
export type KbBookmarkHit = {
  id: string
  title: string
  url: string
  description: string | null
  summaryAi: string | null
  notes: string | null
  contentExcerpt: string | null
  siteName: string | null
  owner: string | null
  externalId: string | null
}

/** trigram 分词器要求查询片段至少 3 个字符 */
const TRIGRAM_MIN_LEN = 3
const MAX_TERMS = 8

/** 中文疑问词/虚词：切分名词短语的边界，本身不作为检索词 */
const CJK_STOPWORDS = [
  "有哪些",
  "哪些",
  "什么样",
  "是什么",
  "什么",
  "怎么样",
  "怎么办",
  "怎么",
  "如何",
  "为什么",
  "可以用",
  "可以",
  "能不能",
  "推荐一下",
  "推荐",
  "介绍一下",
  "介绍",
  "帮我",
  "我想",
  "我要",
  "请问",
  "请",
  "总结",
  "看看",
  "一下",
  "相关的",
  "相关",
  "关于",
  "这些",
  "那些",
  "收藏",
  "里面",
  "的",
  "了",
  "吗",
  "呢",
  "吧",
  "和",
  "与",
  "及",
  "或",
  "在",
  "是",
  "有",
  "做",
  "用",
  "给",
  "我",
  "你",
]

const EN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "which",
  "how",
  "are",
  "any",
  "some",
  "have",
  "has",
  "was",
  "were",
  "that",
  "this",
  "there",
  "about",
  "from",
  "can",
  "you",
  "please",
  "show",
  "give",
  "tell",
  "list",
  "find",
])

export type KbQueryTerms = {
  /** 长度 ≥ 3，可直接进 FTS5 MATCH */
  fts: string[]
  /** 全部候选词（含 2 字中文），用于 LIKE 补充 */
  all: string[]
}

/** 把自然语言提问切成检索词：中文按虚词切块，英文按分隔符切词 */
export function extractQueryTerms(question: string): KbQueryTerms {
  const normalized = question
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")

  const all: string[] = []

  for (const chunk of normalized.split(/\s+/)) {
    if (!chunk) continue
    for (const piece of splitCjkAndLatin(chunk)) {
      if (!piece || all.includes(piece)) continue
      all.push(piece)
      if (all.length >= MAX_TERMS) break
    }
    if (all.length >= MAX_TERMS) break
  }

  return { fts: all.filter((t) => t.length >= TRIGRAM_MIN_LEN), all }
}

function splitCjkAndLatin(chunk: string): string[] {
  const out: string[] = []
  // 中文与非中文交替切段，避免 "react状态管理" 被当成一个词
  const segments = chunk.match(/[\u3400-\u9fff]+|[^\u3400-\u9fff]+/g) ?? []

  for (const seg of segments) {
    if (/^[\u3400-\u9fff]+$/.test(seg)) {
      for (const piece of stripCjkStopwords(seg)) {
        if (piece.length >= 2) out.push(piece)
      }
    } else if (seg.length >= 2 && !EN_STOPWORDS.has(seg)) {
      out.push(seg)
    }
  }
  return out
}

function stripCjkStopwords(run: string): string[] {
  let pieces = [run]
  for (const stop of CJK_STOPWORDS) {
    const next: string[] = []
    for (const piece of pieces) {
      next.push(...piece.split(stop))
    }
    pieces = next
  }
  return pieces.filter(Boolean)
}

/** FTS5 MATCH 表达式：每个词转成引号短语，OR 连接；内部引号双写转义 */
export function buildMatchExpression(terms: string[]): string {
  return terms
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" OR ")
}

export type KbMatchedCategory = {
  kind: "folder" | "tag"
  id: string
  name: string
}

/**
 * 把提问里的检索词当作分类名来认领。允许「前端」命中「前端工程化」：
 * 用户提到某个分类时，那个分类下的收藏就该进上下文。名字越短越接近完整匹配。
 */
export async function matchCategories(
  db: Db,
  terms: readonly string[],
  limit = KB_CHAT_MATCHED_CATEGORY_LIMIT,
): Promise<KbMatchedCategory[]> {
  if (terms.length === 0) return []

  const patterns = terms.map((t) => `%${escapeLike(t.toLowerCase())}%`)
  const clause = sql.join(
    patterns.map((p) => sql`lower(name) LIKE ${p} ESCAPE '\\'`),
    sql` OR `,
  )

  const [folders, tags] = await Promise.all([
    db.all<{ id: string; name: string }>(sql`
      SELECT id, name FROM folders
      WHERE ${clause}
      ORDER BY length(name) ASC
      LIMIT ${limit}
    `),
    db.all<{ id: string; name: string }>(sql`
      SELECT id, name FROM tags
      WHERE ${clause}
      ORDER BY length(name) ASC
      LIMIT ${limit}
    `),
  ])

  // 文件夹优先：它是用户显式建立的结构，标签更随手
  return [
    ...folders.map((f) => ({ kind: "folder" as const, id: f.id, name: f.name })),
    ...tags.map((t) => ({ kind: "tag" as const, id: t.id, name: t.name })),
  ].slice(0, limit)
}

/** 命中分类下的收藏 id，按热度与新近度排序 */
export async function bookmarkIdsInCategories(
  db: Db,
  categories: readonly KbMatchedCategory[],
  limit: number,
): Promise<string[]> {
  if (categories.length === 0 || limit <= 0) return []

  const folderIds = categories.filter((c) => c.kind === "folder").map((c) => c.id)
  const tagIds = categories.filter((c) => c.kind === "tag").map((c) => c.id)

  const conditions = []
  if (folderIds.length > 0) {
    conditions.push(sql`b.folder_id IN (${idList(folderIds)})`)
  }
  if (tagIds.length > 0) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM bookmark_tags bt
      WHERE bt.bookmark_id = b.id
        AND bt.tag_id IN (${idList(tagIds)})
    )`)
  }

  const rows = await db.all<{ id: string }>(sql`
    SELECT b.id AS id
    FROM bookmarks b
    WHERE b.deleted_at IS NULL
      AND b.archived_at IS NULL
      AND (${sql.join(conditions, sql` OR `)})
    ORDER BY b.click_count DESC, b.created_at DESC
    LIMIT ${limit}
  `)
  return rows.map((r) => r.id)
}

/**
 * 知识库检索：先认领提问里提到的分类，再做 FTS5（trigram）关键词检索，
 * 命中不足时用 LIKE 兜底两字中文等短词。排除已归档与已删除收藏。
 *
 * 分类命中排在最前：用户点名某个文件夹时，那个文件夹的内容就是他要的答案，
 * 而分类名根本不在 FTS 索引里，只靠关键词永远捞不到。
 */
export async function searchBookmarks(
  db: Db,
  question: string,
  limit: number,
): Promise<KbBookmarkHit[]> {
  const terms = extractQueryTerms(question)
  if (terms.all.length === 0) return []

  const categories = await matchCategories(db, terms.all).catch((err) => {
    console.error("[kb] category match failed", err)
    return [] as KbMatchedCategory[]
  })

  const ids: string[] = []
  // 分类命中占大头但不独占：留几个位置给关键词，
  // 「前端分类里有哪些 react 的」这类提问两种信号都要用上
  const categoryQuota = Math.max(1, Math.ceil(limit * 0.75))
  for (const id of await bookmarkIdsInCategories(db, categories, categoryQuota)) {
    if (!ids.includes(id)) ids.push(id)
  }

  if (terms.fts.length > 0) {
    const match = buildMatchExpression(terms.fts)
    try {
      const rows = await db.all<{ id: string }>(sql`
        SELECT f.bookmark_id AS id
        FROM bookmarks_fts f
        JOIN bookmarks b ON b.id = f.bookmark_id
        WHERE bookmarks_fts MATCH ${match}
          AND b.deleted_at IS NULL
          AND b.archived_at IS NULL
        ORDER BY bm25(bookmarks_fts, 0, 10.0, 5.0, 5.0, 3.0, 2.0, 2.0, 1.0, 1.0)
        LIMIT ${limit}
      `)
      for (const row of rows) if (!ids.includes(row.id)) ids.push(row.id)
    } catch (err) {
      // MATCH 语法异常不应让整轮对话失败，降级到 LIKE
      console.error("[kb] fts match failed", err)
    }
  }

  // LIKE 是全表扫描。含 2 字中文词的提问几乎都命中 hasShortTerms，
  // 若不同时要求 FTS 没取满，等于每次提问（含每次工具调用）都扫一遍全表。
  const hasShortTerms = terms.all.length > terms.fts.length
  if (ids.length === 0 || (hasShortTerms && ids.length < limit)) {
    const patterns = terms.all.map((t) => `%${escapeLike(t)}%`)
    const clause = sql.join(
      patterns.map((p) => sql`${KB_BLOB} LIKE ${p} ESCAPE '\\'`),
      sql` OR `,
    )
    const rows = await db.all<{ id: string }>(sql`
      SELECT b.id AS id
      FROM bookmarks b
      WHERE b.deleted_at IS NULL
        AND b.archived_at IS NULL
        AND (${clause})
      ORDER BY b.click_count DESC, b.created_at DESC
      LIMIT ${limit}
    `)
    for (const row of rows) {
      if (ids.length >= limit) break
      if (!ids.includes(row.id)) ids.push(row.id)
    }
  }

  return loadHits(db, ids.slice(0, limit))
}

const KB_BLOB = sql`lower(
  b.title || ' ' ||
  coalesce(b.description, '') || ' ' ||
  coalesce(b.summary_ai, '') || ' ' ||
  coalesce(b.notes, '') || ' ' ||
  coalesce(b.content_excerpt, '') || ' ' ||
  coalesce(b.external_id, '') || ' ' ||
  coalesce(b.owner, '') || ' ' ||
  coalesce(b.site_name, '')
)`

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )
}

export async function loadHits(db: Db, ids: string[]): Promise<KbBookmarkHit[]> {
  if (ids.length === 0) return []
  const rows = await db.all<{
    id: string
    title: string
    canonical_url: string
    description: string | null
    summary_ai: string | null
    notes: string | null
    content_excerpt: string | null
    site_name: string | null
    owner: string | null
    external_id: string | null
  }>(sql`
    SELECT id, title, canonical_url, description, summary_ai, notes,
           content_excerpt, site_name, owner, external_id
    FROM bookmarks
    WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
  `)

  const byId = new Map(rows.map((r) => [r.id, r]))
  // 保持检索排序
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      title: r.title,
      url: r.canonical_url,
      description: r.description,
      summaryAi: r.summary_ai,
      notes: r.notes,
      contentExcerpt: r.content_excerpt,
      siteName: r.site_name,
      owner: r.owner,
      externalId: r.external_id,
    }))
}

export function hitToSource(hit: KbBookmarkHit): KbChatSource {
  const snippet =
    hit.summaryAi?.trim() ||
    hit.description?.trim() ||
    hit.contentExcerpt?.trim() ||
    ""
  return {
    type: "bookmark",
    id: hit.id,
    title: hit.title,
    url: hit.url,
    snippet: truncate(snippet, 160),
  }
}

/** 单条收藏在 prompt 中的表示，含私有笔记（仅发往用户自己的 DeepSeek Key） */
export function hitToContextBlock(hit: KbBookmarkHit, index: number): string {
  const lines = [
    `[#${index}] id=${hit.id}`,
    `标题：${hit.title}`,
    `链接：${hit.url}`,
  ]
  if (hit.summaryAi?.trim()) lines.push(`摘要：${hit.summaryAi.trim()}`)
  if (hit.description?.trim()) lines.push(`描述：${hit.description.trim()}`)
  if (hit.notes?.trim()) lines.push(`我的笔记：${hit.notes.trim()}`)
  if (hit.contentExcerpt?.trim()) {
    lines.push(`正文摘录：${truncate(hit.contentExcerpt.trim(), 400)}`)
  }
  return truncate(lines.join("\n"), KB_CHAT_SNIPPET_MAX_CHARS)
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}
