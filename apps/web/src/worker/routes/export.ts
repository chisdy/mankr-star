import {
  bookmarkTags,
  bookmarks,
  folders,
  tags,
  updateEvents,
} from "@mankr/db"
import { isNull } from "drizzle-orm"
import { Hono } from "hono"
import type { Context } from "hono"
import type { AppEnv } from "../env"
import { requireAuth } from "../middleware/auth"

export const exportRoutes = new Hono<AppEnv>()

exportRoutes.use("/export", requireAuth)
exportRoutes.use("/export/*", requireAuth)

/** 标签按收藏分组；两种导出格式共用 */
async function loadTagsByBookmark(db: ReturnType<typeof import("@mankr/db").createDb>) {
  const tagRows = await db.select().from(tags)
  const linkRows = await db.select().from(bookmarkTags)
  const tagNameById = new Map(tagRows.map((t) => [t.id, t.name]))
  const tagsByBookmark = new Map<string, string[]>()
  for (const link of linkRows) {
    const name = tagNameById.get(link.tagId)
    if (!name) continue
    const list = tagsByBookmark.get(link.bookmarkId) ?? []
    list.push(name)
    tagsByBookmark.set(link.bookmarkId, list)
  }
  return { tagRows, tagsByBookmark }
}

exportRoutes.get("/export", async (c) => {
  const db = c.get("db")

  if (c.req.query("format") === "markdown") {
    return exportMarkdown(c)
  }

  const bookmarkRows = await db
    .select()
    .from(bookmarks)
    .where(isNull(bookmarks.deletedAt))

  const folderRows = await db.select().from(folders)
  const eventRows = await db.select().from(updateEvents)
  const { tagRows, tagsByBookmark } = await loadTagsByBookmark(db)

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
      site_name: b.siteName,
      image_url: b.imageUrl,
      favicon_url: b.faviconUrl,
      content_excerpt: b.contentExcerpt,
      readme_excerpt: b.readmeExcerpt,
      platform_meta: (() => {
        try {
          return JSON.parse(b.platformMetaJson || "{}") as Record<
            string,
            unknown
          >
        } catch {
          return {}
        }
      })(),
      folder_id: b.folderId,
      notes: b.notes,
      pricing: b.pricing ?? null,
      featured: Boolean(b.featured),
      ai_status: b.aiStatus,
      topics: JSON.parse(b.topicsJson || "[]"),
      tags: tagsByBookmark.get(b.id) ?? [],
      track_updates: b.trackUpdates,
      archived_at: b.archivedAt,
      click_count: b.clickCount,
      view_count: b.viewCount,
      open_count: b.openCount,
      like_count: b.likeCount,
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

exportRoutes.get("/export/markdown", (c) => exportMarkdown(c))

/** 行内文本进 Markdown 前压平换行，免得把一条笔记撑成多个列表项 */
function inlineText(value: string): string {
  return value.replace(/\s*\n+\s*/g, " ").trim()
}

/**
 * 转义 Markdown / HTML 特殊字符，避免标题、笔记、抓取摘要在二次渲染时注入结构。
 * URL 放在 <> 自动链接里，只去掉尖括号与空白。
 */
function escapeMd(value: string): string {
  return inlineText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}[\]()#+\-.!|])/g, "\\$1")
}

function escapeMdUrl(value: string): string {
  return value.replace(/[<>\s]/g, "").trim()
}

function escapeMdCode(value: string): string {
  return inlineText(value).replace(/`/g, "'")
}

function bookmarkSection(
  b: typeof bookmarks.$inferSelect,
  tagNames: string[],
): string {
  const title = escapeMd(b.title || b.canonicalUrl)
  const url = escapeMdUrl(b.canonicalUrl)
  const lines = [`### ${title}`, "", `<${url}>`]

  if (b.summaryAi) lines.push("", escapeMd(b.summaryAi))
  if (tagNames.length > 0) {
    lines.push(
      "",
      `标签：${tagNames.map((t) => `\`${escapeMdCode(t)}\``).join(" ")}`,
    )
  }
  if (b.pricing) {
    const pricingLabel =
      b.pricing === "free"
        ? "免费"
        : b.pricing === "freemium"
          ? "免费增值"
          : b.pricing === "paid"
            ? "付费"
            : b.pricing
    lines.push("", `付费属性：${pricingLabel}`)
  }
  if (b.featured) {
    lines.push("", "精选：是")
  }
  if (b.notes) lines.push("", `> ${escapeMd(b.notes)}`)

  return lines.join("\n")
}

async function exportMarkdown(c: Context<AppEnv>) {
  const db = c.get("db")

  const bookmarkRows = await db
    .select()
    .from(bookmarks)
    .where(isNull(bookmarks.deletedAt))
  const folderRows = await db.select().from(folders)
  const { tagsByBookmark } = await loadTagsByBookmark(db)

  const folderById = new Map(folderRows.map((f) => [f.id, f]))
  const labelOf = (folder: typeof folders.$inferSelect): string =>
    folder.path
      .split("/")
      .filter(Boolean)
      .map((id) => folderById.get(id)?.name ?? id)
      .join(" / ")

  const byFolder = new Map<string | null, typeof bookmarkRows>()
  for (const b of bookmarkRows) {
    const key = b.folderId && folderById.has(b.folderId) ? b.folderId : null
    const list = byFolder.get(key) ?? []
    list.push(b)
    byFolder.set(key, list)
  }

  // 有收藏的文件夹按路径字典序，未归类固定收尾
  const orderedFolders = folderRows
    .filter((f) => (byFolder.get(f.id)?.length ?? 0) > 0)
    .sort((a, b) => labelOf(a).localeCompare(labelOf(b)))

  const sections: string[] = [
    "# Mankr Star 收藏导出",
    "",
    `导出时间：${new Date().toISOString()} · 收藏 ${bookmarkRows.length} 条 · 文件夹 ${folderRows.length} 个`,
  ]

  for (const folder of orderedFolders) {
    sections.push("", `## ${escapeMd(labelOf(folder))}`)
    for (const b of byFolder.get(folder.id) ?? []) {
      sections.push("", bookmarkSection(b, tagsByBookmark.get(b.id) ?? []))
    }
  }

  const uncategorized = byFolder.get(null) ?? []
  if (uncategorized.length > 0) {
    sections.push("", "## 未归类")
    for (const b of uncategorized) {
      sections.push("", bookmarkSection(b, tagsByBookmark.get(b.id) ?? []))
    }
  }

  const filename = `mankr-star-export-${new Date().toISOString().slice(0, 10)}.md`
  c.header("Content-Type", "text/markdown; charset=utf-8")
  c.header("Content-Disposition", `attachment; filename="${filename}"`)
  return c.body(sections.join("\n") + "\n")
}
