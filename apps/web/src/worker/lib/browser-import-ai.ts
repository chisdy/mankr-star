import { browserImportItems, type BrowserImportItem, type Db } from "@mankr/db"
import { eq } from "drizzle-orm"
import { getDeepSeekKey, loadFolderCatalog } from "./ai-service"
import { truncateBrowserFolderPath } from "./browser-folder-path"
import { normalizeFolderName, callDeepSeekJson } from "./deepseek"
import type { Env } from "../env"
import { DeepSeekCallError, recordAiUsage } from "./ai-usage"

const AI_TIMEOUT_MS = 12_000

type Suggestion = {
  folderId: string | null
  folderPath: string[] | null
}

function parseModelJson(content: string): unknown {
  const trimmed = content.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (!fenced?.[1]) throw new Error("AI 返回的不是 JSON")
    return JSON.parse(fenced[1]) as unknown
  }
}

function asFolderNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.trim())
      .filter(Boolean)
  }
  if (typeof value === "string") {
    return value
      .split(/[/／]/)
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return []
}

function readItems(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return []
  const items = (payload as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  return items.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object"
  )
}

/**
 * 批量归类。只看标题和 URL。
 * 归入已有文件夹时只能返回目录里的 id；新建名称要等用户确认后才落库。
 */
export async function classifyBrowserImportBatch(
  db: Db,
  env: Env,
  mode: "existing" | "new",
  rows: BrowserImportItem[]
): Promise<void> {
  if (rows.length === 0) return
  const deepseek = await getDeepSeekKey(db, env)
  if (!deepseek) throw new Error("尚未配置 DeepSeek API Key")

  const catalog = mode === "existing" ? await loadFolderCatalog(db) : []
  const allowed = new Set(catalog.map((folder) => folder.id))
  const other = catalog.find(
    (folder) => normalizeFolderName(folder.name) === normalizeFolderName("其他")
  )

  const payload = rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
  }))

  const instruction =
    mode === "existing"
      ? [
          "你是书签整理助手。只根据标题和 URL 归类，不要解释。",
          '返回 JSON：{"items":[{"id":"条目 id","folder_id":"目录中的 id"}]}',
          "folder_id 必须来自下面的目录。对不上就用「其他」的 id。",
          `目录：${JSON.stringify(
            catalog.map((folder) => ({
              id: folder.id,
              name: folder.name,
              path: folder.path_label,
            }))
          )}`,
          `书签：${JSON.stringify(payload)}`,
        ].join("\n")
      : [
          "你是书签整理助手。只根据标题和 URL 建议文件夹，不要解释。",
          '返回 JSON：{"items":[{"id":"条目 id","folder":["一级","二级"]}]}',
          "folder 用简短中文，1 到 3 级。不要发明 id。",
          `书签：${JSON.stringify(payload)}`,
        ].join("\n")

  const started = Date.now()
  let content = ""
  let model = deepseek.model
  try {
    const result = await callDeepSeekJson({
      apiKey: deepseek.key,
      model: deepseek.model,
      temperature: 0,
      maxTokens: 2000,
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      messages: [
        { role: "system", content: "只返回 JSON 对象。" },
        { role: "user", content: instruction },
      ],
    })
    content = result.content
    model = deepseek.model
    await recordAiUsage(db, {
      kind: "classify",
      model,
      status: "ok",
      usage: result.usage,
      latencyMs: Date.now() - started,
    })
  } catch (error) {
    if (error instanceof DeepSeekCallError) {
      await recordAiUsage(db, {
        kind: "classify",
        model: error.model,
        status: "error",
        usage: error.usage,
        errorCode: error.errorCode,
        latencyMs: error.latencyMs,
      })
    }
    throw error
  }

  const byId = new Map<string, Suggestion>()
  for (const item of readItems(parseModelJson(content))) {
    const id = typeof item.id === "string" ? item.id : ""
    if (!id) continue
    if (mode === "existing") {
      const folderId = typeof item.folder_id === "string" ? item.folder_id : ""
      byId.set(id, {
        folderId: allowed.has(folderId) ? folderId : (other?.id ?? null),
        folderPath: null,
      })
    } else {
      const names = truncateBrowserFolderPath(asFolderNames(item.folder))
      byId.set(id, {
        folderId: null,
        folderPath: names.length > 0 ? names : ["其他"],
      })
    }
  }

  for (const row of rows) {
    const suggestion = byId.get(row.id) ?? {
      folderId: mode === "existing" ? (other?.id ?? null) : null,
      folderPath: mode === "new" ? ["其他"] : null,
    }
    await db
      .update(browserImportItems)
      .set({
        suggestedFolderId: suggestion.folderId,
        suggestedFolderJson: suggestion.folderPath
          ? JSON.stringify(suggestion.folderPath)
          : null,
        aiDone: true,
      })
      .where(eq(browserImportItems.id, row.id))
  }
}
