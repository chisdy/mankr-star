import {
  AI_FOLDER_AUTO_CREATE_MAX_DEPTH,
  AI_SUMMARY_MAX_CHARS,
  DEEPSEEK_API_BASE,
  DEFAULT_DEEPSEEK_MODEL,
  PRESET_FOLDERS,
  type AiOutput,
  aiOutputSchema,
  type DeepSeekModel,
  type SourceType,
} from "@mankr/shared"
import {
  DeepSeekCallError,
  parseDeepSeekUsage,
  type DeepSeekTokenUsage,
} from "./ai-usage"
import { emptyLlmUsage } from "./llm-provider"
import { asciiSlugify, folderSlugBase } from "./utils"

/** 注入 AI prompt 的文件夹目录项 */
export type FolderCatalogEntry = {
  id: string
  name: string
  parent_id: string | null
  path_label: string
  description?: string | null
}

export type BookmarkAiInput = {
  sourceType: SourceType
  title: string
  description: string | null
  url: string
  siteName?: string | null
  contentExcerpt?: string | null
  language?: string | null
  topics?: string[]
}

export type ClassifyWithDeepSeekResult = {
  output: AiOutput
  usage: DeepSeekTokenUsage
  model: string
  latencyMs: number
}

export type TranslateSlugResult = {
  slug: string | null
  usage: DeepSeekTokenUsage | null
  model: string
  latencyMs: number
  status: "ok" | "error" | "skipped"
  errorCode?: string
}

export type TestDeepSeekResult = {
  ok: boolean
  error?: string
  usage?: DeepSeekTokenUsage
  model: string
  latencyMs: number
}

/** 无 Key/超时兜底：仅按语言粗分，不维护领域关键词表 */
const LANGUAGE_FOLDER_HINTS: Record<string, string[]> = {
  TypeScript: ["工具与 CLI"],
  JavaScript: ["工具与 CLI"],
  Python: ["后端与 API"],
  Go: ["后端与 API"],
  Rust: ["工具与 CLI"],
  Java: ["后端与 API"],
  Kotlin: ["后端与 API"],
  Swift: ["前端框架"],
  Dart: ["前端框架"],
  Ruby: ["后端与 API"],
  PHP: ["后端与 API"],
  Dockerfile: ["DevOps 与部署"],
  Shell: ["工具与 CLI"],
  HCL: ["DevOps 与部署"],
  CSS: ["UI 组件"],
  HTML: ["UI 组件"],
}

export function normalizeFolderName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[／∕]/g, "/")
    .toLowerCase()
}

/** @deprecated 使用 normalizeFolderName */
export const normalizeCategoryName = normalizeFolderName

export function truncateFolderPath(names: string[]): string[] {
  const cleaned = names.map((n) => n.trim()).filter(Boolean)
  const maxSegments = AI_FOLDER_AUTO_CREATE_MAX_DEPTH + 1
  return cleaned.slice(0, maxSegments)
}

function formatFolderCatalogForPrompt(catalog: FolderCatalogEntry[]): string {
  if (catalog.length === 0) {
    return PRESET_FOLDERS.map(
      (c) =>
        `- (preset) ${c.name}：${c.description} — 请优先匹配已 seed 的同名文件夹 id`,
    ).join("\n")
  }
  return JSON.stringify(
    catalog.map((c) => ({
      id: c.id,
      name: c.name,
      parent_id: c.parent_id,
      path_label: c.path_label,
      description: c.description ?? null,
    })),
    null,
    0,
  )
}

/** 无 Key 时网页主题 → 文件夹粗分（仅兜底，正式归类仍靠 DeepSeek） */
const URL_FOLDER_HINTS: Array<{ folder: string[]; patterns: RegExp[] }> = [
  {
    folder: ["学习与教程"],
    patterns: [/教程|指南|入门|文档|docs?|guide|tutorial|how\s*to|手册/i],
  },
  {
    folder: ["AI / LLM"],
    patterns: [
      /\bllm\b|大模型|gpt|claude|prompt|agent|embedding|向量|生成式/i,
    ],
  },
  {
    folder: ["前端框架"],
    patterns: [/react|vue|svelte|next\.?js|nuxt|angular/i],
  },
  {
    folder: ["UI 组件"],
    patterns: [/设计系统|design\s*system|component|组件库|tailwind|shadcn/i],
  },
  {
    folder: ["后端与 API"],
    patterns: [/api|后端|backend|serverless|graphql|rpc/i],
  },
  {
    folder: ["数据库"],
    patterns: [/sql|postgres|mysql|mongodb|redis|数据库|orm/i],
  },
  {
    folder: ["DevOps 与部署"],
    patterns: [/docker|kubernetes|k8s|ci\/?cd|deploy|devops|云原生/i],
  },
]

const EMPTY_URL_TAGS = new Set([
  "webpage",
  "link",
  "website",
  "url",
  "web",
  "page",
  "网站",
  "网页",
  "链接",
  "收藏",
])

function siteBrand(siteName?: string | null): string | null {
  if (!siteName?.trim()) return null
  const host = siteName
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .split(":")[0]!
  const base = host.split(".")[0]
  if (!base || base.length < 2) return null
  return base
}

function extractUrlTags(parts: Array<string | null | undefined>): string[] {
  const text = parts.filter(Boolean).join(" ")
  const tags: string[] = []

  // 中文词块（2–8 字）
  const zh = text.match(/[\u4e00-\u9fff]{2,8}/g) ?? []
  for (const w of zh) {
    if (EMPTY_URL_TAGS.has(w)) continue
    if (!tags.includes(w)) tags.push(w)
    if (tags.length >= 6) break
  }

  // 英文 token
  const en = text.match(/[A-Za-z][A-Za-z0-9+.#-]{1,24}/g) ?? []
  for (const raw of en) {
    const w = raw.toLowerCase()
    if (EMPTY_URL_TAGS.has(w) || w.length < 2) continue
    if (
      [
        "https",
        "http",
        "www",
        "com",
        "org",
        "the",
        "and",
        "for",
        "with",
        "from",
      ].includes(w)
    ) {
      continue
    }
    if (!tags.includes(w)) tags.push(w)
    if (tags.length >= 8) break
  }

  return tags.slice(0, 8)
}

function hintFolderForUrl(text: string): string[] {
  for (const rule of URL_FOLDER_HINTS) {
    if (rule.patterns.some((p) => p.test(text))) return rule.folder
  }
  return ["其他"]
}

/**
 * 规则降级仅作无 Key/超时兜底。
 * 正式归类交给 DeepSeek：按用途分析，目录不贴切时 new_folder，不靠领域正则表。
 */
export function ruleBasedClassify(input: {
  sourceType?: SourceType
  language: string | null
  topics: string[]
  description: string | null
  title: string
  siteName?: string | null
  contentExcerpt?: string | null
  url?: string | null
}): AiOutput {
  const sourceType = input.sourceType ?? "github"

  if (sourceType === "url") {
    const blob = [
      input.title,
      input.description,
      input.siteName,
      input.contentExcerpt?.slice(0, 1200),
    ]
      .filter(Boolean)
      .join("\n")

    const folder_path = hintFolderForUrl(blob)
    const brand = siteBrand(input.siteName)
    const tags = extractUrlTags([
      input.title,
      input.description,
      brand,
      input.contentExcerpt?.slice(0, 400),
    ])
    if (brand && !tags.includes(brand) && tags.length < 8) {
      tags.unshift(brand)
    }
    while (tags.length < 3) {
      const filler = ["阅读", "资料", "参考"][tags.length]!
      if (!tags.includes(filler)) tags.push(filler)
      else break
    }

    const summaryBase =
      input.description?.trim() ||
      (input.title.trim()
        ? `${input.title.trim()}（${brand || "网页"}）`
        : "网页收藏")
    const summary =
      summaryBase.length > AI_SUMMARY_MAX_CHARS
        ? summaryBase.slice(0, AI_SUMMARY_MAX_CHARS - 1) + "…"
        : summaryBase

    return {
      summary,
      folder_id: null,
      new_folder: null,
      folder_path: truncateFolderPath(folder_path),
      tags: tags.slice(0, 8),
      use_cases: [],
      confidence: 0.3,
    }
  }

  const folder_path = input.language
    ? (LANGUAGE_FOLDER_HINTS[input.language] ?? ["其他"])
    : ["其他"]

  const tags = Array.from(
    new Set([
      ...input.topics.slice(0, 5),
      ...(input.language ? [input.language.toLowerCase()] : []),
    ]),
  ).slice(0, 8)

  if (tags.length < 3) {
    tags.push("github", "opensource")
  }

  const summaryBase =
    input.description?.trim() || `${input.title} — GitHub 开源项目`
  const summary =
    summaryBase.length > AI_SUMMARY_MAX_CHARS
      ? summaryBase.slice(0, AI_SUMMARY_MAX_CHARS - 1) + "…"
      : summaryBase

  return {
    summary,
    folder_id: null,
    new_folder: null,
    folder_path: truncateFolderPath(folder_path),
    tags: tags.slice(0, 8),
    use_cases: [],
    confidence: 0.35,
  }
}

export async function classifyWithDeepSeek(opts: {
  apiKey: string
  model?: DeepSeekModel | string
  input: BookmarkAiInput
  catalog: FolderCatalogEntry[]
  signal?: AbortSignal
}): Promise<ClassifyWithDeepSeekResult> {
  const model = opts.model || DEFAULT_DEEPSEEK_MODEL
  const catalogJson = formatFolderCatalogForPrompt(opts.catalog)
  const started = Date.now()
  const isUrl = opts.input.sourceType === "url"

  const system = isUrl
    ? `你是个人知识库归档助手。当前收藏是「普通网页」而非 GitHub 仓库。根据标题、描述与正文摘录判断主题，输出严格 JSON（不要 markdown）：
{"summary":"中文一句话概括该网页核心内容/用途，不超过${AI_SUMMARY_MAX_CHARS}字","folder_id":"已有文件夹的 uuid 或 null","new_folder":null或{"name":"新文件夹名","parent_id":"父文件夹 uuid 或 null"},"tags":["3到8个短标签"],"use_cases":["可选用途场景"],"confidence":0到1的小数}

原则：
1. summary 必须反映页面真实主题，禁止「网页收藏」「链接分享」等空话。
2. tags 用中文优先的主题词（如「设计系统」「性能优化」）；禁止 webpage/link/网站/网页/url 等空标签。
3. 现有文件夹目录大多面向开源工具。若网页主题与任一夹都不贴切，必须 new_folder 起准确中文名，并把 folder_id 设为 null；禁止硬塞进「前端框架」「状态管理」等不相关夹。
4. 教程/文档站可归「学习与教程」；真正的 LLM/Agent 内容才归「AI / LLM」。
5. new_folder.parent_id 为 null 表示挂在根；非 null 必须是目录中已有 id；一次只新建一级。

现有文件夹目录（JSON）：
${catalogJson}`
    : `你是个人知识收藏归档助手。根据收藏内容与文件夹目录，自行判断归属，输出严格 JSON（不要 markdown）：
{"summary":"中文一句话用途摘要，不超过${AI_SUMMARY_MAX_CHARS}字","folder_id":"已有文件夹的 uuid 或 null","new_folder":null或{"name":"新文件夹名","parent_id":"父文件夹 uuid 或 null"},"tags":["3到8个短标签"],"use_cases":["可选用途场景"],"confidence":0到1的小数}

原则（不要死记关键词表，按真实用途推理）：
1. 按产品形态/用途归类；来源可能是 GitHub 仓库或普通网页，不要按编程语言硬套。
2. 优先复用目录中语义真正贴切的 folder_id；只有都不贴切时才 new_folder（此时 folder_id 必须为 null）。
3. 预置目录覆盖不了所有领域——宁可 new_folder 起准确名字（如「3D 与图形」「边缘网关」），也不要硬塞进不相关的已有夹（尤其不要把非大模型内容塞进「AI / LLM」）。
4. new_folder.parent_id 为 null 表示挂在根；非 null 必须是目录中已有 id；一次只新建一级。
5. 「AI / LLM」仅用于大模型、Agent、提示词、向量检索、推理框架等；「学习与教程」仅用于真正的教程/课程；名称含 awesome 不自动等于教程。
6. 实在无法判断再用「其他」对应的 folder_id。

现有文件夹目录（JSON）：
${catalogJson}

示例（说明形态，非穷举）：
- 明确的 React 框架仓库 → 复用「前端框架」id
- Agent Skill 集合 → 复用或在「AI / LLM」下 new_folder「Agent Skills」
- 设计系统文档网页 → 若无贴切夹则 new_folder「设计系统」
- 全新品类 → new_folder 自定义名称`

  const excerpt = opts.input.contentExcerpt?.trim()
  // 网页给模型稍多正文，但控制体积
  const excerptForPrompt = excerpt
    ? excerpt.slice(0, isUrl ? 3500 : 4000)
    : ""
  const user = [
    `来源类型：${opts.input.sourceType}`,
    `标题：${opts.input.title}`,
    `链接：${opts.input.url}`,
    opts.input.siteName ? `站点：${opts.input.siteName}` : "",
    `描述：${opts.input.description ?? "无"}`,
    opts.input.language ? `语言：${opts.input.language}` : "",
    opts.input.topics?.length
      ? `Topics：${opts.input.topics.join(", ")}`
      : "",
    excerptForPrompt ? `正文摘录：\n${excerptForPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  let usage: DeepSeekTokenUsage = emptyLlmUsage()

  let res: Response
  try {
    res = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: opts.signal,
    })
  } catch (e) {
    const latencyMs = Date.now() - started
    throw new DeepSeekCallError(
      e instanceof Error ? e.message : String(e),
      {
        model,
        latencyMs,
        errorCode: "NETWORK_ERROR",
      },
    )
  }

  const latencyMs = Date.now() - started

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new DeepSeekCallError(
      `DeepSeek API ${res.status}: ${body.slice(0, 200)}`,
      {
        model,
        latencyMs,
        errorCode: `HTTP_${res.status}`,
      },
    )
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: unknown
  }
  usage = parseDeepSeekUsage(data.usage)

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new DeepSeekCallError("DeepSeek 返回空内容", {
      usage,
      model,
      latencyMs,
      errorCode: "EMPTY_CONTENT",
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new DeepSeekCallError("DeepSeek 返回非 JSON", {
      usage,
      model,
      latencyMs,
      errorCode: "INVALID_JSON",
    })
  }

  // 兼容旧模型偶发 category/parent_category → folder_path
  if (
    parsed &&
    typeof parsed === "object" &&
    !("folder_id" in parsed) &&
    !("folder_path" in parsed) &&
    "category" in parsed
  ) {
    const obj = parsed as {
      category: string
      parent_category?: string | null
    }
    const path = obj.parent_category
      ? [obj.parent_category, obj.category]
      : [obj.category]
    ;(parsed as unknown as { folder_path: string[] }).folder_path = path
  }

  const result = aiOutputSchema.safeParse(parsed)
  if (!result.success) {
    throw new DeepSeekCallError("DeepSeek JSON 校验失败", {
      usage,
      model,
      latencyMs,
      errorCode: "SCHEMA_INVALID",
    })
  }

  if (result.data.summary.length > AI_SUMMARY_MAX_CHARS) {
    result.data.summary =
      result.data.summary.slice(0, AI_SUMMARY_MAX_CHARS - 1) + "…"
  }

  if (result.data.folder_path) {
    result.data.folder_path = truncateFolderPath(result.data.folder_path)
  }

  if (result.data.folder_id) {
    const ok = opts.catalog.some((c) => c.id === result.data.folder_id)
    if (!ok) {
      result.data.folder_id = null
    }
  }

  if (result.data.new_folder) {
    const parentId = result.data.new_folder.parent_id
    if (parentId != null) {
      const parent = opts.catalog.find((c) => c.id === parentId)
      if (!parent) {
        result.data.new_folder = null
      }
    }
  }

  if (result.data.folder_id) {
    result.data.new_folder = null
  }

  // 过滤空标签；网页来源额外丢掉 webpage/link 等无意义词
  result.data.tags = result.data.tags
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !(isUrl && EMPTY_URL_TAGS.has(t.toLowerCase())))
    .slice(0, 8)
  if (result.data.tags.length < 3 && isUrl) {
    const brand = siteBrand(opts.input.siteName)
    const fillers = extractUrlTags([
      opts.input.title,
      opts.input.description,
      brand,
    ])
    for (const t of fillers) {
      if (!result.data.tags.includes(t)) result.data.tags.push(t)
      if (result.data.tags.length >= 3) break
    }
  }

  return {
    output: result.data,
    usage,
    model,
    latencyMs,
  }
}

/** 将中文/任意名称译为英文短语，再 asciiSlugify；失败返回 slug=null 并带 usage */
export async function translateNameToEnglishSlug(
  apiKey: string,
  name: string,
  model?: string,
  signal?: AbortSignal,
): Promise<TranslateSlugResult> {
  const resolvedModel = model || DEFAULT_DEEPSEEK_MODEL
  const started = Date.now()
  try {
    const res = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [
          {
            role: "system",
            content:
              '将文件夹名称译成简短英文标识（2～5 个单词）。只输出 JSON：{"slug_words":"english words here"}。不要解释。',
          },
          { role: "user", content: name },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 60,
      }),
      signal,
    })
    const latencyMs = Date.now() - started
    if (!res.ok) {
      return {
        slug: null,
        usage: null,
        model: resolvedModel,
        latencyMs,
        status: "error",
        errorCode: `HTTP_${res.status}`,
      }
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: unknown
    }
    const usage = parseDeepSeekUsage(data.usage)
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      return {
        slug: null,
        usage,
        model: resolvedModel,
        latencyMs,
        status: "error",
        errorCode: "EMPTY_CONTENT",
      }
    }
    const parsed = JSON.parse(content) as { slug_words?: string; slug?: string }
    const raw = parsed.slug_words || parsed.slug || ""
    const slug = asciiSlugify(raw)
    return {
      slug: slug || null,
      usage,
      model: resolvedModel,
      latencyMs,
      status: slug ? "ok" : "error",
      errorCode: slug ? undefined : "EMPTY_SLUG",
    }
  } catch (e) {
    return {
      slug: null,
      usage: null,
      model: resolvedModel,
      latencyMs: Date.now() - started,
      status: "error",
      errorCode: e instanceof Error ? e.name : "NETWORK_ERROR",
    }
  }
}

export function fallbackAsciiSlugFromName(name: string): string {
  return folderSlugBase(name)
}

export async function testDeepSeekConnection(
  apiKey: string,
  model?: string,
): Promise<TestDeepSeekResult> {
  const resolvedModel = model || DEFAULT_DEEPSEEK_MODEL
  const started = Date.now()
  try {
    const res = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    })
    const latencyMs = Date.now() - started
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return {
        ok: false,
        error: `HTTP ${res.status}: ${body.slice(0, 120)}`,
        model: resolvedModel,
        latencyMs,
      }
    }
    const data = (await res.json()) as { usage?: unknown }
    return {
      ok: true,
      usage: parseDeepSeekUsage(data.usage),
      model: resolvedModel,
      latencyMs,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      model: resolvedModel,
      latencyMs: Date.now() - started,
    }
  }
}

export type DeepSeekToolCall = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

/**
 * 服务端内部消息类型。tool role 与 tool_calls 只在 agent 循环内部流转，
 * 请求体那侧的 kbChatMessageSchema 仍只接受 user / assistant。
 */
export type DeepSeekChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: DeepSeekToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string }

export type DeepSeekTool = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type DeepSeekStreamChunk =
  | { type: "delta"; text: string }
  | { type: "tool_call"; calls: DeepSeekToolCall[] }
  | { type: "usage"; usage: DeepSeekTokenUsage }

type ToolCallDelta = {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/**
 * 流式 chat completion。逐块产出增量文本，末尾产出 usage（若上游返回）。
 * 传了 tools 时，delta.tool_calls 的分片会按 index 累积，
 * 在流结束前一次性产出完整的 tool_call chunk。
 * 非 2xx 或网络错误抛 DeepSeekCallError，便于调用方落用量日志。
 */
export async function* streamDeepSeekChat(opts: {
  apiKey: string
  model?: string
  messages: DeepSeekChatMessage[]
  temperature?: number
  maxTokens?: number
  tools?: DeepSeekTool[]
  toolChoice?: "auto" | "none"
  signal?: AbortSignal
}): AsyncGenerator<DeepSeekStreamChunk> {
  const model = opts.model || DEFAULT_DEEPSEEK_MODEL
  const started = Date.now()

  let res: Response
  try {
    res = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.3,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.tools?.length
          ? {
              tools: opts.tools,
              tool_choice: opts.toolChoice ?? "auto",
            }
          : {}),
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: opts.signal,
    })
  } catch (e) {
    throw new DeepSeekCallError(e instanceof Error ? e.message : String(e), {
      model,
      latencyMs: Date.now() - started,
      errorCode: "NETWORK_ERROR",
    })
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "")
    throw new DeepSeekCallError(
      `DeepSeek API ${res.status}: ${body.slice(0, 200)}`,
      {
        model,
        latencyMs: Date.now() - started,
        errorCode: res.ok ? "EMPTY_BODY" : `HTTP_${res.status}`,
      },
    )
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  // 工具调用按 index 分片下发，累积到流末尾才完整
  const pendingCalls = new Map<number, DeepSeekToolCall>()

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += value

      let boundary = buffer.indexOf("\n")
      while (boundary >= 0) {
        const line = buffer.slice(0, boundary).trim()
        buffer = buffer.slice(boundary + 1)
        boundary = buffer.indexOf("\n")

        if (!line.startsWith("data:")) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === "[DONE]") continue

        let parsed: {
          choices?: Array<{
            delta?: { content?: string; tool_calls?: ToolCallDelta[] }
          }>
          usage?: unknown
        }
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }

        const delta = parsed.choices?.[0]?.delta
        if (delta?.content) yield { type: "delta", text: delta.content }
        if (delta?.tool_calls) accumulateToolCalls(pendingCalls, delta.tool_calls)
        if (parsed.usage) {
          yield { type: "usage", usage: parseDeepSeekUsage(parsed.usage) }
        }
      }
    }

    if (pendingCalls.size > 0) {
      const calls = [...pendingCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call)
        .filter((call) => call.function.name)
      if (calls.length > 0) yield { type: "tool_call", calls }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/**
 * 非流式 JSON 调用，供意图路由这类低成本判定使用。
 * 上游异常一律抛 DeepSeekCallError，usage 随错误带出便于记账。
 */
export async function callDeepSeekJson(opts: {
  apiKey: string
  model?: string
  messages: DeepSeekChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): Promise<{ content: string; usage: DeepSeekTokenUsage }> {
  const model = opts.model || DEFAULT_DEEPSEEK_MODEL
  const started = Date.now()

  let res: Response
  try {
    res = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        response_format: { type: "json_object" },
        temperature: opts.temperature ?? 0,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: opts.signal,
    })
  } catch (e) {
    throw new DeepSeekCallError(e instanceof Error ? e.message : String(e), {
      model,
      latencyMs: Date.now() - started,
      errorCode: "NETWORK_ERROR",
    })
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new DeepSeekCallError(
      `DeepSeek API ${res.status}: ${body.slice(0, 200)}`,
      {
        model,
        latencyMs: Date.now() - started,
        errorCode: `HTTP_${res.status}`,
      },
    )
  }

  let data: {
    choices?: Array<{ message?: { content?: string } }>
    usage?: unknown
  }
  try {
    data = await res.json()
  } catch {
    throw new DeepSeekCallError("DeepSeek 返回非 JSON", {
      model,
      latencyMs: Date.now() - started,
      errorCode: "INVALID_JSON",
    })
  }

  const usage = parseDeepSeekUsage(data.usage)
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new DeepSeekCallError("DeepSeek 返回空内容", {
      usage,
      model,
      latencyMs: Date.now() - started,
      errorCode: "EMPTY_CONTENT",
    })
  }
  return { content, usage }
}

function accumulateToolCalls(
  pending: Map<number, DeepSeekToolCall>,
  deltas: ToolCallDelta[]
): void {
  for (const delta of deltas) {
    const index = delta.index ?? 0
    const current = pending.get(index) ?? {
      id: "",
      type: "function" as const,
      function: { name: "", arguments: "" },
    }
    pending.set(index, {
      id: delta.id ?? current.id,
      type: "function",
      function: {
        name: delta.function?.name ?? current.function.name,
        // arguments 是逐字符拼出来的 JSON 串，必须累加
        arguments: current.function.arguments + (delta.function?.arguments ?? ""),
      },
    })
  }
}

/** @deprecated */
export type CategoryTreeNode = {
  name: string
  description?: string | null
  children: Array<{ name: string; description?: string | null }>
}

/** @deprecated */
export function findCategoryInTree(
  _tree: CategoryTreeNode[],
  _name: string,
): { name: string; parentName: string | null } | null {
  return null
}
