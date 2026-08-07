import { aiUsageLogs, type Db } from "@mankr/db"
import type { AiUsageKind, AiUsageStatus } from "@mankr/shared"
import { emptyLlmUsage, parseLlmUsage, type LlmTokenUsage } from "./llm-provider"
import { nowIso } from "./utils"

/**
 * DeepSeek 链路沿用的别名。用量模型本身已是提供方无关的（见 llm-provider.ts），
 * 保留旧名只为免去一次性改掉所有 DeepSeek call site。
 */
export type DeepSeekTokenUsage = LlmTokenUsage

export function parseDeepSeekUsage(raw: unknown): DeepSeekTokenUsage {
  return parseLlmUsage(raw, "deepseek")
}

export type RecordAiUsageInput = {
  kind: AiUsageKind
  model: string
  status: AiUsageStatus
  usage?: LlmTokenUsage | null
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
    const usage = input.usage ?? emptyLlmUsage()
    await db.insert(aiUsageLogs).values({
      id: crypto.randomUUID(),
      kind: input.kind,
      model: input.model,
      status: input.status,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      cacheReadTokens: usage.cache_read_tokens,
      cacheWriteTokens: usage.cache_write_tokens,
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
  usage: LlmTokenUsage
  model: string
  latencyMs: number
  errorCode: string

  constructor(
    message: string,
    opts: {
      usage?: LlmTokenUsage
      model: string
      latencyMs: number
      errorCode?: string
    },
  ) {
    super(message)
    this.name = "DeepSeekCallError"
    this.usage = opts.usage ?? emptyLlmUsage()
    this.model = opts.model
    this.latencyMs = opts.latencyMs
    this.errorCode = opts.errorCode ?? "CALL_FAILED"
  }
}
