import type { Db } from "@mankr/db"
import {
  ANYSEARCH_API_BASE,
  ANYSEARCH_CLIENT_HEADER,
  ANYSEARCH_MAX_RESULTS,
} from "@mankr/shared"
import type { Env } from "../env"
import { decryptSecret } from "./crypto"
import { readSetting } from "./settings-store"

const SEARCH_TIMEOUT_MS = 15_000

export type AnySearchResult = {
  title: string
  url: string
  snippet: string
}

export class AnySearchError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = "AnySearchError"
    this.code = code
  }
}

export async function getAnySearchKey(
  db: Db,
  env: Env,
): Promise<string | null> {
  const search = await readSetting(db, "search")
  if (!search.anysearchApiKeyEncrypted) return null
  const encKey = env.AI_KEY_ENCRYPTION_KEY || env.PAT_ENCRYPTION_KEY
  try {
    return await decryptSecret(search.anysearchApiKeyEncrypted, encKey)
  } catch {
    return null
  }
}

/**
 * AnySearch 通用网页搜索。
 * 出站内容仅限调用方给定的 query 文本，不携带任何收藏隐私字段。
 */
export async function searchWeb(
  apiKey: string,
  query: string,
  opts: { maxResults?: number; signal?: AbortSignal } = {},
): Promise<AnySearchResult[]> {
  const maxResults = Math.max(
    1,
    Math.min(opts.maxResults ?? ANYSEARCH_MAX_RESULTS, 10),
  )

  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  const signal = opts.signal
    ? AbortSignal.any([timeout, opts.signal])
    : timeout

  let res: Response
  try {
    res = await fetch(`${ANYSEARCH_API_BASE}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Anysearch-Client": ANYSEARCH_CLIENT_HEADER,
      },
      body: JSON.stringify({ query, max_results: maxResults }),
      signal,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new AnySearchError(
      redactKey(message, apiKey),
      message.toLowerCase().includes("abort") ? "TIMEOUT" : "NETWORK_ERROR",
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new AnySearchError(
      `AnySearch ${res.status}: ${redactKey(body, apiKey).slice(0, 200)}`,
      `HTTP_${res.status}`,
    )
  }

  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    throw new AnySearchError("AnySearch 返回非 JSON", "INVALID_JSON")
  }

  return parseResults(raw, maxResults)
}

function parseResults(raw: unknown, maxResults: number): AnySearchResult[] {
  if (!raw || typeof raw !== "object") {
    throw new AnySearchError("AnySearch 返回结构异常", "INVALID_RESPONSE")
  }
  const envelope = raw as { code?: unknown; message?: unknown; data?: unknown }
  if (envelope.code !== 0) {
    const message =
      typeof envelope.message === "string" ? envelope.message : "调用失败"
    throw new AnySearchError(`AnySearch: ${message}`, "API_ERROR")
  }

  const data = envelope.data as { results?: unknown } | undefined
  if (!data || !Array.isArray(data.results)) {
    throw new AnySearchError("AnySearch 缺少 results", "INVALID_RESPONSE")
  }

  const out: AnySearchResult[] = []
  for (const item of data.results) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const url = toHttpUrl(row.url)
    if (!url) continue
    out.push({
      title: typeof row.title === "string" && row.title ? row.title : url,
      url,
      snippet: typeof row.snippet === "string" ? row.snippet : "",
    })
    if (out.length >= maxResults) break
  }
  return out
}

/** 探测 Key 是否可用（设置页「测试连接」） */
export async function testAnySearchConnection(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  try {
    await searchWeb(apiKey, "mankr star connectivity check", { maxResults: 1 })
    return { ok: true }
  } catch (e) {
    if (e instanceof AnySearchError) {
      return { ok: false, error: e.message, code: e.code }
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      code: "UNKNOWN",
    }
  }
}

/** 搜索结果由第三方提供，只接受 http(s)，挡掉 javascript:/data: 等危险协议 */
function toHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return parsed.href
  } catch {
    return null
  }
}

function redactKey(text: string, apiKey: string): string {
  if (!apiKey) return text
  return text.split(apiKey).join("***")
}
