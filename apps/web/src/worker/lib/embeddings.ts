import { bookmarkEmbeddings, bookmarks, type Db } from "@mankr/db"
import type { AiSettingsValue } from "@mankr/shared"
import { count, eq, isNull } from "drizzle-orm"
import type { Env } from "../env"
import { decryptSecret } from "./crypto"
import { readSetting } from "./settings-store"
import { nowIso } from "./utils"

/** 单次 hybrid 向量扫描上限；超出则回退纯 FTS，避免 Worker 内存/CPU 爆掉 */
export const MAX_VECTOR_SCAN_ROWS = 2000
/** 向量支路取 topK 参与 RRF */
export const VECTOR_TOP_K = 50

export function isEmbeddingConfigured(ai: AiSettingsValue): boolean {
  const base = ai.embeddingBaseUrl.trim()
  if (!base) return false
  if (ai.embeddingReuseAiKey) return Boolean(ai.deepseekApiKeyEncrypted)
  return Boolean(ai.embeddingApiKeyEncrypted)
}

export async function resolveEmbeddingCredentials(
  db: Db,
  env: Env,
): Promise<{ baseUrl: string; model: string; apiKey: string } | null> {
  const ai = await readSetting(db, "ai")
  if (!isEmbeddingConfigured(ai)) return null
  const encKey = env.AI_KEY_ENCRYPTION_KEY || env.PAT_ENCRYPTION_KEY
  let apiKey: string
  try {
    if (ai.embeddingReuseAiKey) {
      apiKey = await decryptSecret(ai.deepseekApiKeyEncrypted!, encKey)
    } else {
      apiKey = await decryptSecret(ai.embeddingApiKeyEncrypted!, encKey)
    }
  } catch {
    return null
  }
  return {
    baseUrl: ai.embeddingBaseUrl.replace(/\/+$/, ""),
    model: ai.embeddingModel || "text-embedding-3-small",
    apiKey,
  }
}

export function buildEmbeddingText(row: {
  title: string
  description: string | null
  summaryAi: string | null
  notes: string | null
  contentExcerpt: string | null
  owner: string | null
}): string {
  return [
    row.title,
    row.description,
    row.summaryAi,
    row.notes,
    row.contentExcerpt,
    row.owner,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000)
}

export async function hashContent(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  )
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function float32ToBase64(vec: number[]): string {
  const buf = new ArrayBuffer(vec.length * 4)
  const view = new Float32Array(buf)
  for (let i = 0; i < vec.length; i++) view[i] = vec[i]!
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export async function fetchEmbedding(
  creds: { baseUrl: string; model: string; apiKey: string },
  input: string,
): Promise<number[]> {
  const url = `${creds.baseUrl}/embeddings`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: creds.model, input }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`embedding failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>
  }
  const embedding = json.data?.[0]?.embedding
  if (!embedding?.length) throw new Error("embedding response empty")
  return embedding
}

export async function testEmbeddingConnection(
  creds: { baseUrl: string; model: string; apiKey: string },
): Promise<{ ok: true; dims: number } | { ok: false; error: string }> {
  try {
    const vec = await fetchEmbedding(creds, "mankr embedding ping")
    return { ok: true, dims: vec.length }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function upsertBookmarkEmbedding(
  db: Db,
  env: Env,
  bookmarkId: string,
): Promise<boolean> {
  const creds = await resolveEmbeddingCredentials(db, env)
  if (!creds) return false

  const row = await db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.id, bookmarkId))
    .get()
  if (!row || row.deletedAt) return false

  const text = buildEmbeddingText(row)
  if (!text.trim()) return false
  const contentHash = await hashContent(`${creds.model}\n${text}`)

  const existing = await db
    .select()
    .from(bookmarkEmbeddings)
    .where(eq(bookmarkEmbeddings.bookmarkId, bookmarkId))
    .get()
  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.model === creds.model
  ) {
    return true
  }

  const vec = await fetchEmbedding(creds, text)
  const payload = {
    bookmarkId,
    model: creds.model,
    dims: vec.length,
    vector: float32ToBase64(vec),
    contentHash,
    updatedAt: nowIso(),
  }
  if (existing) {
    await db
      .update(bookmarkEmbeddings)
      .set(payload)
      .where(eq(bookmarkEmbeddings.bookmarkId, bookmarkId))
  } else {
    await db.insert(bookmarkEmbeddings).values(payload)
  }
  return true
}

/** 后台嵌入；失败只打日志，不拖垮主请求 */
export function scheduleBookmarkEmbedding(
  waitUntil: (promise: Promise<unknown>) => void,
  db: Db,
  env: Env,
  bookmarkId: string,
): void {
  waitUntil(
    upsertBookmarkEmbedding(db, env, bookmarkId).catch((err) =>
      console.error("[embedding] upsert", err),
    ),
  )
}

/** 混合：FTS 顺序 ∪ 向量 topK（RRF 简化） */
export async function queryBookmarkIdsHybrid(
  db: Db,
  env: Env,
  opts: {
    q: string
    includeNotes: boolean
    ftsIds: string[]
    limit?: number
  },
): Promise<string[]> {
  const limit = opts.limit ?? 5000
  const creds = await resolveEmbeddingCredentials(db, env)
  if (!creds) return opts.ftsIds

  const [{ value: vectorCount }] = await db
    .select({ value: count() })
    .from(bookmarkEmbeddings)
    .where(eq(bookmarkEmbeddings.model, creds.model))

  if (vectorCount > MAX_VECTOR_SCAN_ROWS) {
    console.warn(
      `[embedding] skip hybrid: ${vectorCount} rows > ${MAX_VECTOR_SCAN_ROWS}`,
    )
    return opts.ftsIds
  }

  let queryVec: number[]
  try {
    queryVec = await fetchEmbedding(creds, opts.q.trim())
  } catch (err) {
    console.error("[embedding] query failed", err)
    return opts.ftsIds
  }

  const rows = await db
    .select()
    .from(bookmarkEmbeddings)
    .where(eq(bookmarkEmbeddings.model, creds.model))
  const query = new Float32Array(queryVec)
  const scored: Array<{ id: string; score: number }> = []
  for (const row of rows) {
    try {
      const vec = base64ToFloat32(row.vector)
      scored.push({ id: row.bookmarkId, score: cosineSimilarity(query, vec) })
    } catch {
      /* skip corrupt */
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const vectorIds = scored
    .slice(0, Math.min(VECTOR_TOP_K, limit))
    .map((s) => s.id)

  const scores = new Map<string, number>()
  opts.ftsIds.forEach((id, i) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + i))
  })
  vectorIds.forEach((id, i) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + i))
  })
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

export async function backfillEmbeddings(
  db: Db,
  env: Env,
  batchSize = 5,
): Promise<number> {
  const creds = await resolveEmbeddingCredentials(db, env)
  if (!creds) return 0

  const rows = await db
    .select({
      id: bookmarks.id,
      title: bookmarks.title,
      description: bookmarks.description,
      summaryAi: bookmarks.summaryAi,
      notes: bookmarks.notes,
      contentExcerpt: bookmarks.contentExcerpt,
      owner: bookmarks.owner,
    })
    .from(bookmarks)
    .where(isNull(bookmarks.deletedAt))
    .limit(200)

  let done = 0
  for (const row of rows) {
    if (done >= batchSize) break
    const text = buildEmbeddingText(row)
    if (!text.trim()) continue
    const contentHash = await hashContent(`${creds.model}\n${text}`)
    const existing = await db
      .select()
      .from(bookmarkEmbeddings)
      .where(eq(bookmarkEmbeddings.bookmarkId, row.id))
      .get()
    if (
      existing &&
      existing.contentHash === contentHash &&
      existing.model === creds.model
    ) {
      continue
    }
    try {
      await upsertBookmarkEmbedding(db, env, row.id)
      done += 1
    } catch (err) {
      console.error("[embedding] backfill failed", row.id, err)
    }
  }
  return done
}
