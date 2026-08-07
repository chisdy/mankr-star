import { kbConversations, type Db } from "@mankr/db"
import {
  KB_CONTEXT_COMPRESS_TOKEN_THRESHOLD,
  KB_CONTEXT_MAX_PROMPT_TOKENS,
  KB_CONTEXT_RECENT_MESSAGES,
  KB_CONTEXT_SUMMARY_MAX_CHARS,
  KB_CONTEXT_SUMMARY_MAX_TOKENS,
  type KbChatMessage,
} from "@mankr/shared"
import { eq } from "drizzle-orm"
import { emptyLlmUsage, type LlmTokenUsage } from "./llm-provider"
import { nowIso } from "./utils"

/**
 * 这个模块刻意不 import 任何 DeepSeek 符号。压缩要用一次模型调用，
 * 但「压什么、什么时候压、水位落在哪」与厂商无关，
 * 具体调用经 ChatJsonFn 注入，换厂商时只换注入的实现。
 */
export type ChatJsonFn = (opts: {
  messages: Array<{ role: "system" | "user"; content: string }>
  maxTokens: number
}) => Promise<{ content: string; usage: LlmTokenUsage }>

/** 会话侧持久化的上下文状态 */
export type KbContextState = {
  summary: string
  /** 摘要覆盖到的最后一条消息 id；从未压缩过为 null */
  coversThroughId: string | null
}

export const EMPTY_KB_CONTEXT: KbContextState = {
  summary: "",
  coversThroughId: null,
}

/**
 * 粗估 token。只用于「要不要压缩」这个二元判断，
 * 为它引一个真 tokenizer（体积、冷启动）不值得；
 * 中英混排下 chars/4 偏保守，宁可早压一点也不要撑爆上下文。
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function estimateMessagesTokens(
  messages: readonly { content: string }[],
): number {
  let total = 0
  for (const m of messages) total += estimateTokens(m.content) + 4
  return total
}

export type KbContextPlan = {
  /** 送进本轮 prompt 的历史 */
  messages: KbChatMessage[]
  /**
   * 要并进摘要的旧段。空数组表示本轮不压缩。
   *
   * 与 messages 允许重叠：本轮照常原样发送这段历史（压缩是并发的，
   * 摘要要下一轮才可用），压缩只决定「以后」怎么看这段。
   * 把两者解耦之后，prompt 长度是容量问题，压缩是成本问题，互不牵扯。
   */
  toCompress: KbChatMessage[]
  /** 压缩成功后水位应指向的消息 id；toCompress 非空时必有值 */
  coversThroughId: string | null
}

/**
 * 决定本轮 prompt 用哪段历史、以及要不要在后台压缩一次。纯同步、不调模型。
 *
 * 两条设计约束，改动前请先理解：
 *
 * 1. 只把「滑出近窗的那一段」并进已有摘要，绝不拿全量历史重新压一遍。
 *    全量重压的成本随会话长度线性增长，增量合并只与新增部分成正比。
 * 2. 未触发压缩时原样返回，**不做** slice(-N)。看着像漏了个上限，
 *    但滑动窗口会让 prompt 的第一条历史每轮都变，前缀缓存全部失效；
 *    而「自摘要之后的全部历史」是纯追加的，第二轮起就能命中。
 *    长度由压缩兜底，容量另有 KB_CONTEXT_MAX_PROMPT_TOKENS 保底。
 */
export function planKbContext(input: {
  /** 请求体里的历史（客户端可能已跳过被摘要覆盖的前缀，也可能没跳） */
  messages: KbChatMessage[]
  state: KbContextState
  /**
   * 摘要能否落库（即请求是否带了 conversationId）。
   * 存不下就别压：摘要的收益全在「压一次、后面很多轮都省」，
   * 每轮重压一遍等于每轮多付一次调用费。
   */
  canPersist: boolean
}): KbContextPlan {
  const aligned = skipCovered(input.messages, input.state.coversThroughId)
  const messages = capPromptTokens(aligned, input.state.summary)
  const idle: KbContextPlan = { messages, toCompress: [], coversThroughId: null }

  if (!input.canPersist) return idle

  const budget =
    estimateMessagesTokens(aligned) + estimateTokens(input.state.summary)
  if (budget <= KB_CONTEXT_COMPRESS_TOKEN_THRESHOLD) return idle
  if (aligned.length <= KB_CONTEXT_RECENT_MESSAGES) return idle

  const toCompress = aligned.slice(0, aligned.length - KB_CONTEXT_RECENT_MESSAGES)
  // 没有 id 就没有能落库的水位，压了也无法让下一轮跳过它，等于白花钱
  const coversThroughId = toCompress.at(-1)?.id ?? null
  if (!coversThroughId) return idle

  return { messages, toCompress, coversThroughId }
}

/**
 * 丢掉已被摘要覆盖的前缀。
 *
 * 客户端本来就会按同一个 id 自行跳过，这里再做一次是为了兜住它水位过期的情况
 * （压缩与生成并发，客户端要到下一次存档响应才拿到新指针）。有了这层兜底，
 * 客户端的水位就只是省上传流量的优化，不影响正确性，也不会让同一段历史被压两次。
 */
function skipCovered(
  messages: KbChatMessage[],
  coversThroughId: string | null,
): KbChatMessage[] {
  if (!coversThroughId) return messages
  const at = messages.findIndex((m) => m.id === coversThroughId)
  // 找不到：客户端已经跳过了，或那条消息被重试截掉了，两种情况都按原样处理
  if (at < 0) return messages
  // 全跳完就没有可回答的提问了，至少留最后一条
  return at + 1 >= messages.length ? messages.slice(-1) : messages.slice(at + 1)
}

/**
 * 容量保底。触发压缩的那一轮摘要还没生成，历史仍是原样发送，
 * 而请求体上限（40 条 × 4000 字）叠上检索资料足以顶穿 agent 的 token 预算。
 * 从最旧的一端砍，保住最近的问答与当前提问。
 */
function capPromptTokens(
  messages: KbChatMessage[],
  summary: string,
): KbChatMessage[] {
  let total = estimateTokens(summary) + estimateMessagesTokens(messages)
  if (total <= KB_CONTEXT_MAX_PROMPT_TOKENS) return messages

  const kept = [...messages]
  while (kept.length > 1 && total > KB_CONTEXT_MAX_PROMPT_TOKENS) {
    const dropped = kept.shift()
    if (!dropped) break
    total -= estimateTokens(dropped.content) + 4
  }
  return kept
}

export type CompressKbContextResult = {
  /** 摘要可用时的新状态；调用失败或解析失败为 null，此时水位原地不动 */
  next: KbContextState | null
  /** 无论成败都要记账：调用已经发生，token 已经花掉了 */
  usage: LlmTokenUsage
  errorCode?: string
}

/**
 * 把 plan.toCompress 并进已有摘要。调用方应把它丢进 waitUntil 与生成并发跑：
 * 摘要服务的是下一轮，没有任何理由让本轮的首字节等它。
 */
export async function compressKbContext(input: {
  previousSummary: string
  dropped: readonly KbChatMessage[]
  coversThroughId: string
  chatJson: ChatJsonFn
}): Promise<CompressKbContextResult> {
  try {
    const { content, usage } = await input.chatJson({
      messages: buildSummaryMessages(input.previousSummary, input.dropped),
      maxTokens: KB_CONTEXT_SUMMARY_MAX_TOKENS,
    })
    const summary = readSummary(content)
    if (!summary) {
      return { next: null, usage, errorCode: "SUMMARY_UNPARSEABLE" }
    }
    return {
      next: { summary, coversThroughId: input.coversThroughId },
      usage,
    }
  } catch (err) {
    // 压缩失败不影响任何一轮对话：水位停在原地，下次超阈值再压一次
    console.error("[kb] context compression failed", err)
    return {
      next: null,
      usage: emptyLlmUsage(),
      errorCode: "COMPRESS_FAILED",
    }
  }
}

function buildSummaryMessages(
  previous: string,
  dropped: readonly KbChatMessage[],
): Array<{ role: "system" | "user"; content: string }> {
  const transcript = dropped
    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content}`)
    .join("\n")

  return [
    {
      role: "system",
      content: [
        "你在压缩一段收藏库问答的历史，供后续轮次当上下文使用。",
        "把「已有摘要」和「新增对话」合并成一份新的摘要，不要丢掉用户已表达的偏好、约束、已确认的结论与仍未解决的问题。",
        "保留具体名词（项目名、分类名、链接标题），不要写「用户讨论了某话题」这种空话。",
        `中文，纯文本，不超过 ${KB_CONTEXT_SUMMARY_MAX_CHARS} 字。`,
        '只输出 JSON：{"summary":"..."}。',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `## 已有摘要\n${previous.trim() || "（无）"}`,
        `## 新增对话\n${transcript}`,
      ].join("\n\n"),
    },
  ]
}

function readSummary(content: string): string {
  try {
    const parsed = JSON.parse(content) as { summary?: unknown }
    if (typeof parsed.summary !== "string") return ""
    const summary = parsed.summary.trim()
    if (!summary) return ""
    return summary.length > KB_CONTEXT_SUMMARY_MAX_CHARS
      ? `${summary.slice(0, KB_CONTEXT_SUMMARY_MAX_CHARS - 1)}…`
      : summary
  } catch {
    return ""
  }
}

/** 会话不存在（首轮）时返回空状态，调用方无需区分 */
export async function loadKbContext(
  db: Db,
  conversationId: string | undefined,
): Promise<KbContextState> {
  if (!conversationId) return EMPTY_KB_CONTEXT
  try {
    const row = await db
      .select({
        summary: kbConversations.contextSummary,
        coversThroughId: kbConversations.summaryCoversThroughId,
      })
      .from(kbConversations)
      .where(eq(kbConversations.id, conversationId))
      .get()
    if (!row) return EMPTY_KB_CONTEXT
    return {
      summary: row.summary ?? "",
      coversThroughId: row.coversThroughId ?? null,
    }
  } catch (err) {
    console.error("[kb] load context failed", err)
    return EMPTY_KB_CONTEXT
  }
}

/**
 * 回写摘要与水位。
 *
 * 必须 upsert：会话行由前端的存档请求创建，那是个不等待结果的旁路调用，
 * 压缩走到这里时行可能还不存在，纯 UPDATE 会静默丢掉摘要。
 * 标题留空串占位，随后的存档请求会用首条提问覆盖它。
 *
 * 失败无需上报：客户端的水位只能从库里读回（存档响应／打开会话），
 * 永远不会超过实际落库的值，所以写失败最多让下次超阈值时重压一遍，
 * 不存在「客户端以为已进摘要、实际两边都没有」的丢上下文窗口。
 */
export async function saveKbContext(
  db: Db,
  conversationId: string,
  state: KbContextState,
): Promise<void> {
  try {
    const now = nowIso()
    await db
      .insert(kbConversations)
      .values({
        id: conversationId,
        title: "",
        contextSummary: state.summary,
        summaryCoversThroughId: state.coversThroughId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: kbConversations.id,
        set: {
          contextSummary: state.summary,
          summaryCoversThroughId: state.coversThroughId,
          updatedAt: now,
        },
      })
  } catch (err) {
    console.error("[kb] save context failed", err)
  }
}
