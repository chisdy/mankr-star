import type { Db } from "@mankr/db"
import {
  ANYSEARCH_MAX_RESULTS,
  KB_AGENT_TOOL_RESULT_LIMIT,
  KB_CHAT_FOLDER_LIST_LIMIT,
  KB_CHAT_QUERY_MAX_CHARS,
  KB_CHAT_TOP_K,
  KB_ORGANIZE_INDEX_MAX,
  type KbChatSource,
  type KbOrganizeProposal,
} from "@mankr/shared"
import { sql } from "drizzle-orm"
import { searchWeb } from "./anysearch"
import type { DeepSeekTool } from "./deepseek"
import {
  inspectLibrary,
  listBookmarkIndex,
  listFolderBookmarks,
  resolveFolder,
} from "./kb-folders"
import {
  loadOrganizeWorld,
  parseOrganizeDrafts,
  proposalFromSimulation,
  simulateOrganize,
} from "./kb-organize"
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
  /** 可执行的整理方案。零条可执行操作时不带，避免发出空卡片 */
  organize?: KbOrganizeProposal
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
    {
      type: "function",
      function: {
        name: "inspect_library",
        description:
          "只读检查收藏库的文件夹：路径、简介、子树条数（未删除且未归档，与收藏列表一致）和少量标题。附带疑似重复提示。提示不会自动合并，也不能据此直接改库。",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "list_bookmark_index",
        description:
          "只读列出收藏的 id、标题、标签和短摘要，供整理归属时引用 id。不含笔记和正文，这些条目不是引用来源。",
        parameters: {
          type: "object",
          properties: {
            folder: {
              type: "string",
              description: "可选。文件夹 id 或名称；省略则列出整个收藏库",
            },
            limit: {
              type: "integer",
              description: `返回条数，1-${KB_ORGANIZE_INDEX_MAX}，默认 20`,
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "propose_organize",
        description:
          "提交一份整理方案，显示成对话卡片，不会写入收藏库。同一轮再次调用会覆盖上一份。操作顺序由服务端重排为：新建、改名、移动文件夹、移动收藏、合并。合并前要先把子文件夹移走。口头确认不会执行。",
        parameters: {
          type: "object",
          properties: {
            ops: {
              type: "array",
              description:
                "最多 24 项。rename_folder: {type, folderId, name, reason}。create_folder: {type, key, name, parentId|null, parentKey|null, reason}。move_folder: {type, folderId, parentId|null, parentKey|null, reason}。move_bookmarks: {type, bookmarkIds, folderId|null, folderKey|null, reason}。merge_folders: {type, sourceId, targetId|null, targetKey|null, reason}。parentId 与 parentKey 只填一个；目标未归类时 folderId 和 folderKey 都留空。",
            },
          },
          required: ["ops"],
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
      case "inspect_library":
        return runInspectLibrary(input.db)
      case "list_bookmark_index":
        return runBookmarkIndex(input.db, args)
      case "propose_organize":
        return runProposeOrganize(input.db, args)
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
  const blocks = hits.map((hit) =>
    hitToContextBlock(hit, registry.bookmark(hit).index)
  )
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

async function loadBookmark(db: Db, id: string): Promise<KbBookmarkHit | null> {
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

const FOLDER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function runInspectLibrary(db: Db): Promise<KbToolResult> {
  try {
    const content = await inspectLibrary(db)
    return {
      content: `只读检查结果，不是可引用资料：\n${content}`,
      sources: [],
      count: 1,
    }
  } catch (err) {
    console.error("[kb] tool inspect_library failed", err)
    return { content: "文件夹检查失败", sources: [], count: 0, failed: true }
  }
}

async function runBookmarkIndex(
  db: Db,
  args: Record<string, unknown>
): Promise<KbToolResult> {
  const folderName = readString(args, "folder")
  let folderId: string | undefined
  if (folderName) {
    const folder = await resolveFolder(db, folderName)
    if (!folder) {
      return {
        content: `没有名为“${folderName}”的文件夹`,
        sources: [],
        count: 0,
      }
    }
    folderId = folder.id
  }
  const rawLimit = Number(args.limit)
  try {
    const content = await listBookmarkIndex(db, {
      folderId,
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
    })
    const count = Math.max(0, content.split("\n").length - 1)
    return {
      content: `只读索引，不是可引用资料：\n${content}`,
      sources: [],
      count,
    }
  } catch (err) {
    console.error("[kb] tool list_bookmark_index failed", err)
    return { content: "收藏索引失败", sources: [], count: 0, failed: true }
  }
}

async function runProposeOrganize(
  db: Db,
  args: Record<string, unknown>
): Promise<KbToolResult> {
  try {
    const coerced = await coerceFolderRefs(db, args.ops)
    const parsed = parseOrganizeDrafts(coerced)
    const world = await loadOrganizeWorld(db)
    const simulated = simulateOrganize(world, parsed.drafts)
    const skipped = [...parsed.skipped, ...simulated.skipped]
    const proposal = proposalFromSimulation("pending", {
      ops: simulated.ops,
      skipped,
    })
    if (!proposal) {
      return {
        content: "方案没有通过校验，请改用文件夹 id 和收藏 id 再试",
        sources: [],
        count: 0,
      }
    }
    const lines = [
      `可执行 ${proposal.ops.length} 项，拒绝 ${proposal.skipped?.length ?? 0} 项。`,
    ]
    for (const op of proposal.ops)
      lines.push(`- 接受 ${op.id} ${op.type}：${op.reason}`)
    for (const item of proposal.skipped ?? [])
      lines.push(`- 拒绝 ${item.id}：${item.reason}`)
    if (parsed.truncated) lines.push("- 超出单次上限的操作没有处理。")
    lines.push(
      proposal.ops.length > 0
        ? "方案已显示在对话卡片上。请让用户勾选后点击「应用所选」。不要声称已经写入。"
        : "没有可执行的操作，未生成卡片。请根据拒绝原因修改后再调用 propose_organize。"
    )
    return {
      content: lines.join("\n"),
      sources: [],
      count: proposal.ops.length,
      ...(proposal.ops.length > 0 ? { organize: proposal } : {}),
    }
  } catch (err) {
    console.error("[kb] tool propose_organize failed", err)
    return { content: "整理方案生成失败", sources: [], count: 0, failed: true }
  }
}

/** 模型有时会抄文件夹名而不是 id。能唯一解析到的才替换，解析不到就留给校验拒绝 */
async function coerceFolderRefs(db: Db, raw: unknown): Promise<unknown> {
  if (!Array.isArray(raw)) return raw
  const next = []
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      next.push(item)
      continue
    }
    const row = { ...(item as Record<string, unknown>) }
    for (const key of [
      "folderId",
      "parentId",
      "sourceId",
      "targetId",
    ] as const) {
      const value = row[key]
      if (typeof value !== "string") continue
      const text = value.trim()
      if (!text || FOLDER_UUID_RE.test(text)) continue
      const folder = await resolveFolder(db, text)
      if (folder) row[key] = folder.id
    }
    next.push(row)
  }
  return next
}
