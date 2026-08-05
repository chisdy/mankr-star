import {
  AI_FOLDER_AUTO_CREATE_MAX_DEPTH,
  AI_SUMMARY_MAX_CHARS,
  DEEPSEEK_API_BASE,
  DEFAULT_DEEPSEEK_MODEL,
  PRESET_FOLDERS,
  type AiOutput,
  aiOutputSchema,
  type DeepSeekModel,
} from "@mankr/shared"
import type { GithubRepoMeta } from "./github"
import {
  DeepSeekCallError,
  parseDeepSeekUsage,
  type DeepSeekTokenUsage,
} from "./ai-usage"
import { asciiSlugify, folderSlugBase } from "./utils"

/** 注入 AI prompt 的文件夹目录项 */
export type FolderCatalogEntry = {
  id: string
  name: string
  parent_id: string | null
  path_label: string
  description?: string | null
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

/**
 * 规则降级仅作无 Key/超时兜底。
 * 正式归类交给 DeepSeek：按用途分析，目录不贴切时 new_folder，不靠领域正则表。
 */
export function ruleBasedClassify(meta: {
  language: string | null
  topics: string[]
  description: string | null
  title: string
}): AiOutput {
  const folder_path = meta.language
    ? (LANGUAGE_FOLDER_HINTS[meta.language] ?? ["其他"])
    : ["其他"]

  const tags = Array.from(
    new Set([
      ...meta.topics.slice(0, 5),
      ...(meta.language ? [meta.language.toLowerCase()] : []),
    ]),
  ).slice(0, 8)

  if (tags.length < 3) {
    tags.push("github", "opensource")
  }

  const summaryBase =
    meta.description?.trim() || `${meta.title} — GitHub 开源项目`
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
  meta: GithubRepoMeta
  readme?: string | null
  catalog: FolderCatalogEntry[]
  signal?: AbortSignal
}): Promise<ClassifyWithDeepSeekResult> {
  const model = opts.model || DEFAULT_DEEPSEEK_MODEL
  const catalogJson = formatFolderCatalogForPrompt(opts.catalog)
  const started = Date.now()

  const system = `你是开源项目归档助手。根据仓库元数据与文件夹目录，自行判断归属，输出严格 JSON（不要 markdown）：
{"summary":"中文一句话用途摘要，不超过${AI_SUMMARY_MAX_CHARS}字","folder_id":"已有文件夹的 uuid 或 null","new_folder":null或{"name":"新文件夹名","parent_id":"父文件夹 uuid 或 null"},"tags":["3到8个短标签"],"use_cases":["可选用途场景"],"confidence":0到1的小数}

原则（不要死记关键词表，按真实用途推理）：
1. 按产品形态/用途归类，不要按编程语言硬套。
2. 优先复用目录中语义真正贴切的 folder_id；只有都不贴切时才 new_folder（此时 folder_id 必须为 null）。
3. 预置目录覆盖不了所有领域——宁可 new_folder 起准确名字（如「3D 与图形」「边缘网关」），也不要硬塞进不相关的已有夹（尤其不要把非大模型库塞进「AI / LLM」）。
4. new_folder.parent_id 为 null 表示挂在根；非 null 必须是目录中已有 id；一次只新建一级。
5. 「AI / LLM」仅用于大模型、Agent、提示词、向量检索、推理框架等；「学习与教程」仅用于真正的教程/课程；名称含 awesome 不自动等于教程。
6. 实在无法判断再用「其他」对应的 folder_id。

现有文件夹目录（JSON）：
${catalogJson}

示例（说明形态，非穷举）：
- 明确的 React 框架 → 复用「前端框架」id
- Agent Skill 集合 → 复用或在「AI / LLM」下 new_folder「Agent Skills」
- Three.js / WebGL 引擎 → 若无贴切夹则 new_folder「3D 与图形」，不要选「AI / LLM」
- 全新品类 → new_folder 自定义名称`

  const user = [
    `仓库：${opts.meta.fullName}`,
    `描述：${opts.meta.description ?? "无"}`,
    `语言：${opts.meta.language ?? "未知"}`,
    `Topics：${opts.meta.topics.join(", ") || "无"}`,
    opts.readme ? `README 截断：\n${opts.readme}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  let usage: DeepSeekTokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }

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
