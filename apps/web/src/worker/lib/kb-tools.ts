import type { Db } from "@mankr/db"
import {
  ANYSEARCH_MAX_RESULTS,
  KB_AGENT_TOOL_RESULT_LIMIT,
  KB_CHAT_FOLDER_LIST_LIMIT,
  KB_CHAT_QUERY_MAX_CHARS,
  KB_CHAT_TOP_K,
  type KbChatSource,
} from "@mankr/shared"
import { sql } from "drizzle-orm"
import { searchWeb } from "./anysearch"
import type { DeepSeekTool } from "./deepseek"
import { listFolderBookmarks, resolveFolder } from "./kb-folders"
import {
  hitToContextBlock,
  hitToSource,
  searchBookmarks,
  truncate,
  type KbBookmarkHit,
} from "./kb-search"

/** 工具执行结果：content 交给模型，sources 追加到引用列表 */
export type KbToolResult = {
  /** 喂回模型的文本，已带 [#n] / [Wn] 编号 */
  content: string
  /** 本次新增的来源，按编号顺序 */
  sources: KbChatSource[]
  /** 命中条数，用于 activity 文案 */
  count: number
  /** 工具自身失败（已降级为文本回执，不抛出） */
  failed?: boolean
}

export type KbToolkit = {
  /** OpenAI 兼容的 tools 声明，未配置联网 Key 时不含 search_web */
  tools: DeepSeekTool[]
  execute: (name: string, rawArgs: string) => Promise<KbToolResult>
}

/**
 * 引用编号在整轮对话内单调递增：收藏走 [#n]、网页走 [Wn]。
 * 多轮工具调用只能往后追加，一旦重排，正文里的标记就会指向错误的资料。
 */
class SourceRegistry {
  readonly sources: KbChatSource[] = []
  private bookmarkSeq = 0
  private webSeq = 0
  private readonly bookmarkIndex = new Map<string, number>()
  private readonly webIndex = new Map<string, number>()

  bookmark(hit: KbBookmarkHit): { index: number; fresh: boolean } {
    const seen = this.bookmarkIndex.get(hit.id)
    if (seen !== undefined) return { index: seen, fresh: false }
    const index = ++this.bookmarkSeq
    this.bookmarkIndex.set(hit.id, index)
    this.sources.push(hitToSource(hit))
    return { index, fresh: true }
  }

  web(result: { title: string; url: string; snippet: string }): {
    index: number
    fresh: boolean
  } {
    const seen = this.webIndex.get(result.url)
    if (seen !== undefined) return { index: seen, fresh: false }
    const index = ++this.webSeq
    this.webIndex.set(result.url, index)
    this.sources.push({
      type: "web",
      title: result.title,
      url: result.url,
      snippet: truncate(result.snippet, 200),
    })
    return { index, fresh: true }
  }
}

export function createKbToolkit(input: {
  db: Db
  anysearchKey: string | null
  signal?: AbortSignal
  /** 复用快路径已分配的编号，避免循环路径从 1 重新开始 */
  registry?: KbSourceRegistry
}): KbToolkit {
  const registry = input.registry ?? new SourceRegistry()

  const tools: DeepSeekTool[] = [
    {
      type: "function",
      function: {
        name: "search_bookmarks",
        description:
          "在用户的个人收藏库里做关键词检索，返回命中收藏的标题、链接、摘要与笔记。回答任何与用户收藏有关的问题都应先用它。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "检索关键词，用空格分隔多个词，不要写成整句问句",
            },
            limit: {
              type: "integer",
              description: `返回条数，1-${KB_CHAT_TOP_K}，默认 ${KB_AGENT_TOOL_RESULT_LIMIT}`,
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_folder_bookmarks",
        description:
          "列出某个分类（文件夹）下的收藏。回答「某个分类里都有什么」「对比两个分类的内容」「归类是否合理」时用它 —— 分类名不参与关键词检索，用 search_bookmarks 查分类名是查不到的。可用分类见资料里的「收藏库分类」。",
        parameters: {
          type: "object",
          properties: {
            folder: {
              type: "string",
              description:
                "分类名，取自「收藏库分类」；嵌套分类只写它自己的名字，不要写「父 / 子」整条路径",
            },
            limit: {
              type: "integer",
              description: `返回条数，1-${KB_CHAT_FOLDER_LIST_LIMIT}，默认 ${KB_AGENT_TOOL_RESULT_LIMIT}`,
            },
          },
          required: ["folder"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_bookmark_detail",
        description:
          "按收藏 id 取单条收藏的完整资料（含正文摘录与用户笔记）。仅在已知 id 且需要更多细节时使用。已归档或已删除的收藏取不到。",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "收藏 id" },
          },
          required: ["id"],
        },
      },
    },
  ]

  // 未配置 Key 时干脆不声明该工具，避免模型反复尝试一个必然失败的调用
  if (input.anysearchKey) {
    tools.push({
      type: "function",
      function: {
        name: "search_web",
        description:
          "联网搜索实时信息。仅在收藏库资料不足、或问题明显需要最新信息时使用。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
          },
          required: ["query"],
        },
      },
    })
  }

  const execute = async (
    name: string,
    rawArgs: string
  ): Promise<KbToolResult> => {
    const args = parseArgs(rawArgs)
    switch (name) {
      case "search_bookmarks":
        return runSearchBookmarks(input.db, registry, args)
      case "list_folder_bookmarks":
        return runListFolderBookmarks(input.db, registry, args)
      case "get_bookmark_detail":
        return runBookmarkDetail(input.db, registry, args)
      case "search_web":
        return runSearchWeb(input.anysearchKey, registry, args, input.signal)
      default:
        return {
          content: `未知工具 ${name}`,
          sources: [],
          count: 0,
          failed: true,
        }
    }
  }

  return { tools, execute }
}

export type KbSourceRegistry = SourceRegistry

export function createKbSourceRegistry(): KbSourceRegistry {
  return new SourceRegistry()
}

/** 把快路径已检索到的资料登记进编号表，供后续轮次接着往后编号 */
export function registerFastPathSources(
  registry: KbSourceRegistry,
  hits: KbBookmarkHit[],
  web: Array<{ title: string; url: string; snippet: string }>
): { bookmarkContext: string; webContext: string } {
  const bookmarkBlocks = hits.map((hit) => {
    const { index } = registry.bookmark(hit)
    return hitToContextBlock(hit, index)
  })
  const webBlocks = web.map((result) => {
    const { index } = registry.web(result)
    return webContextBlock(result, index)
  })
  return {
    bookmarkContext: bookmarkBlocks.join("\n\n"),
    webContext: webBlocks.join("\n\n"),
  }
}

export function webContextBlock(
  result: { title: string; url: string; snippet: string },
  index: number
): string {
  return `[W${index}] ${result.title}\n链接：${result.url}\n摘要：${truncate(
    result.snippet,
    400
  )}`
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function readString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === "string" ? value.trim() : ""
}

async function runSearchBookmarks(
  db: Db,
  registry: SourceRegistry,
  args: Record<string, unknown>
): Promise<KbToolResult> {
  const query = truncate(readString(args, "query"), KB_CHAT_QUERY_MAX_CHARS)
  if (!query) {
    return {
      content: "调用缺少 query 参数",
      sources: [],
      count: 0,
      failed: true,
    }
  }

  const rawLimit = Number(args.limit)
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.trunc(rawLimit), KB_CHAT_TOP_K))
    : KB_AGENT_TOOL_RESULT_LIMIT

  let hits: KbBookmarkHit[]
  try {
    hits = await searchBookmarks(db, query, limit)
  } catch (err) {
    console.error("[kb] tool search_bookmarks failed", err)
    return {
      content: "收藏检索失败，请改用已有资料回答",
      sources: [],
      count: 0,
      failed: true,
    }
  }

  if (hits.length === 0) {
    return { content: `“${query}” 在收藏库中没有命中`, sources: [], count: 0 }
  }

  const before = registry.sources.length
  const blocks = hits.map((hit) => hitToContextBlock(hit, registry.bookmark(hit).index))
  return {
    content: blocks.join("\n\n"),
    sources: registry.sources.slice(before),
    count: hits.length,
  }
}

async function runListFolderBookmarks(
  db: Db,
  registry: SourceRegistry,
  args: Record<string, unknown>
): Promise<KbToolResult> {
  const name = readString(args, "folder")
  if (!name) {
    return {
      content: "调用缺少 folder 参数",
      sources: [],
      count: 0,
      failed: true,
    }
  }

  const rawLimit = Number(args.limit)
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.trunc(rawLimit), KB_CHAT_FOLDER_LIST_LIMIT))
    : KB_AGENT_TOOL_RESULT_LIMIT

  let folder: { id: string; name: string } | null
  let hits: KbBookmarkHit[]
  try {
    folder = await resolveFolder(db, name)
    hits = folder ? await listFolderBookmarks(db, folder.id, limit) : []
  } catch (err) {
    console.error("[kb] tool list_folder_bookmarks failed", err)
    return { content: "读取分类失败", sources: [], count: 0, failed: true }
  }

  // 分类不存在与分类为空是两种不同的事实，模型据此选择改问法还是如实说明
  if (!folder) {
    return { content: `没有名为“${name}”的分类`, sources: [], count: 0 }
  }
  if (hits.length === 0) {
    return { content: `分类“${folder.name}”下没有收藏`, sources: [], count: 0 }
  }

  const before = registry.sources.length
  const blocks = hits.map((hit) =>
    hitToContextBlock(hit, registry.bookmark(hit).index)
  )
  return {
    content: `分类“${folder.name}”下的收藏：\n\n${blocks.join("\n\n")}`,
    sources: registry.sources.slice(before),
    count: hits.length,
  }
}

async function runBookmarkDetail(
  db: Db,
  registry: SourceRegistry,
  args: Record<string, unknown>
): Promise<KbToolResult> {
  const id = readString(args, "id")
  if (!id) {
    return { content: "调用缺少 id 参数", sources: [], count: 0, failed: true }
  }

  let hit: KbBookmarkHit | null
  try {
    hit = await loadBookmark(db, id)
  } catch (err) {
    console.error("[kb] tool get_bookmark_detail failed", err)
    return { content: "读取收藏失败", sources: [], count: 0, failed: true }
  }
  if (!hit) {
    return { content: `未找到 id=${id} 的收藏`, sources: [], count: 0 }
  }

  const before = registry.sources.length
  const { index } = registry.bookmark(hit)
  return {
    content: hitToContextBlock(hit, index),
    sources: registry.sources.slice(before),
    count: 1,
  }
}

async function runSearchWeb(
  apiKey: string | null,
  registry: SourceRegistry,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<KbToolResult> {
  if (!apiKey) {
    return {
      content: "联网搜索未启用",
      sources: [],
      count: 0,
      failed: true,
    }
  }
  const query = truncate(readString(args, "query"), KB_CHAT_QUERY_MAX_CHARS)
  if (!query) {
    return {
      content: "调用缺少 query 参数",
      sources: [],
      count: 0,
      failed: true,
    }
  }

  try {
    // 出站只带模型给出的检索词，不含笔记等隐私字段
    const results = await searchWeb(apiKey, query, {
      maxResults: ANYSEARCH_MAX_RESULTS,
      signal,
    })
    if (results.length === 0) {
      return { content: `“${query}” 联网无结果`, sources: [], count: 0 }
    }
    const before = registry.sources.length
    const blocks = results.map((result) =>
      webContextBlock(result, registry.web(result).index)
    )
    return {
      content: blocks.join("\n\n"),
      sources: registry.sources.slice(before),
      count: results.length,
    }
  } catch (err) {
    console.error("[kb] tool search_web failed", err)
    return {
      content: "联网搜索失败，请改用收藏库资料回答",
      sources: [],
      count: 0,
      failed: true,
    }
  }
}

async function loadBookmark(
  db: Db,
  id: string
): Promise<KbBookmarkHit | null> {
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
    WHERE id = ${id}
      AND deleted_at IS NULL
      AND archived_at IS NULL
    LIMIT 1
  `)
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    url: row.canonical_url,
    description: row.description,
    summaryAi: row.summary_ai,
    notes: row.notes,
    contentExcerpt: row.content_excerpt,
    siteName: row.site_name,
    owner: row.owner,
    externalId: row.external_id,
  }
}
