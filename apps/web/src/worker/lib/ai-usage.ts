import { aiUsageLogs, type Db } from "@mankr/db"
import type { AiUsageKind, AiUsageStatus } from "@mankr/shared"
import { nowIso } from "./utils"

export type DeepSeekTokenUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export function parseDeepSeekUsage(raw: unknown): DeepSeekTokenUsage {
  if (!raw || typeof raw !== "object") {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  }
  const u = raw as Record<string, unknown>
  const prompt = Number(u.prompt_tokens) || 0
  const completion = Number(u.completion_tokens) || 0
  const total = Number(u.total_tokens) || prompt + completion
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  }
}

export type RecordAiUsageInput = {
  kind: AiUsageKind
  model: string
  status: AiUsageStatus
  usage?: DeepSeekTokenUsage | null
  bookmarkId?: string | null
  errorCode?: string | null
  latencyMs?: number | null
}

/** 写用量失败不抛错，避免阻断分类 / 建夹 / 测试连接 */
export async function recordAiUsage(
  db: Db,
  input: RecordAiUsageInput,
): Promise<void> {
  try {
    const usage = input.usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    }
    await db.insert(aiUsageLogs).values({
      id: crypto.randomUUID(),
      kind: input.kind,
      model: input.model,
      status: input.status,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      bookmarkId: input.bookmarkId ?? null,
      errorCode: input.errorCode ?? null,
      latencyMs: input.latencyMs ?? null,
      createdAt: nowIso(),
    })
  } catch (err) {
    console.error("[ai_usage_logs] record failed", err)
  }
}

/** 携带 usage 的 DeepSeek 调用错误，便于 catch 后落库 */
export class DeepSeekCallError extends Error {
  usage: DeepSeekTokenUsage
  model: string
  latencyMs: number
  errorCode: string

  constructor(
    message: string,
    opts: {
      usage?: DeepSeekTokenUsage
      model: string
      latencyMs: number
      errorCode?: string
    },
  ) {
    super(message)
    this.name = "DeepSeekCallError"
    this.usage = opts.usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    }
    this.model = opts.model
    this.latencyMs = opts.latencyMs
    this.errorCode = opts.errorCode ?? "CALL_FAILED"
  }
}
