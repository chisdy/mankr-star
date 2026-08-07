import {
  KB_CHAT_MESSAGE_MAX_CHARS,
  KB_CHAT_REQUEST_MAX_MESSAGES,
  type KbChatActivityItem,
  type KbChatMessage,
  type KbChatModelId,
  type KbChatPlanItem,
  type KbChatPlanStatus,
  type KbChatSource,
  type KbChatStreamEvent,
  type KbChatWarning,
} from "@mankr/shared"
import { ApiError } from "./api"

/**
 * 把面板里的会话记录裁成服务端能接受的请求体。
 * 空命中与被中止的回合内容为空、长回答会顶破单条上限，
 * 原样回传会让校验失败，并且失败消息会一直留在历史里卡死后续每一轮。
 *
 * coversThroughId 是滚动摘要覆盖到的最后一条消息：它之前的历史已被摘要代表，
 * 再回传就是白付上传流量。按 id 定位而不是按条数，正是因为上面那个 filter
 * 会丢掉空内容的回合、末尾还要按上限截断 —— 条数在两端根本对不齐。
 *
 * 跳过失败（指针找不到）不会出错：服务端拿同一个 id 再对齐一次，
 * 这里只是省流量的优化。
 */
export function buildKbChatPayload(
  history: readonly { id: string; role: "user" | "assistant"; content: string }[],
  coversThroughId: string | null = null,
): KbChatMessage[] {
  const sendable = history
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content.trim().slice(0, KB_CHAT_MESSAGE_MAX_CHARS),
    }))
    .filter((m) => m.content.length > 0)

  const at = coversThroughId
    ? sendable.findIndex((m) => m.id === coversThroughId)
    : -1
  const kept = sendable.slice(at + 1)

  // 至少留一条：请求体的 messages 有 min(1) 约束，而重试会截掉尾部消息，
  // 极端情况下水位可能反超当前历史，全跳过会直接打成 VALIDATION_ERROR。
  const tail = kept.length > 0 ? kept : sendable.slice(-1)
  return tail.slice(-KB_CHAT_REQUEST_MAX_MESSAGES)
}

export type KbChatHandlers = {
  onMeta?: (sources: KbChatSource[], warnings: KbChatWarning[]) => void
  /** 多轮检索的增量来源，调用方需去重后追加 */
  onSourcesAppend?: (sources: KbChatSource[]) => void
  onPlan?: (items: KbChatPlanItem[]) => void
  onPlanUpdate?: (id: string, status: KbChatPlanStatus) => void
  onActivity?: (item: KbChatActivityItem) => void
  onDelta?: (text: string) => void
  /** 检索无命中，服务端未调用生成模型 */
  onEmpty?: () => void
}

/**
 * 调用知识库对话 SSE 接口。
 * 正常结束时 resolve；上游/网络错误抛 ApiError，调用方据 code 映射文案。
 * signal abort 时抛 DOMException("AbortError")，由调用方判定为「已停止」。
 */
export async function streamKbChat(
  input: {
    messages: KbChatMessage[]
    webSearch: boolean
    /** 按轮次生效的模型；缺省时后端回落到用户设置里的模型 */
    model?: KbChatModelId
    /** 带上才能读写该会话的滚动摘要 */
    conversationId?: string
  },
  handlers: KbChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch("/api/kb/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw new ApiError("无法连接服务器，请检查网络后重试。", 0, {
      backendUnavailable: true,
    })
  }

  if (!response.ok || !response.body) {
    let message = "请求失败，请稍后重试。"
    let code: string | undefined
    try {
      const data = (await response.json()) as Record<string, unknown>
      if (typeof data.error === "string") message = data.error
      if (typeof data.code === "string") code = data.code
    } catch {
      // 保留默认文案
    }
    throw new ApiError(message, response.status, { code })
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += value

      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")
        dispatch(block, handlers)
      }
    }
    if (buffer.trim()) dispatch(buffer, handlers)
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function dispatch(block: string, handlers: KbChatHandlers): void {
  const line = block.trim()
  if (!line.startsWith("data:")) return

  let event: KbChatStreamEvent
  try {
    event = JSON.parse(line.slice(5).trim()) as KbChatStreamEvent
  } catch {
    return
  }

  switch (event.type) {
    case "meta":
      handlers.onMeta?.(event.sources, event.warnings ?? [])
      break
    case "sources_append":
      handlers.onSourcesAppend?.(event.sources)
      break
    case "plan":
      handlers.onPlan?.(event.items)
      break
    case "plan_update":
      handlers.onPlanUpdate?.(event.id, event.status)
      break
    case "activity":
      handlers.onActivity?.(event.item)
      break
    case "delta":
      handlers.onDelta?.(event.text)
      break
    case "empty":
      handlers.onEmpty?.()
      break
    case "error":
      throw new ApiError(event.message, 502, { code: event.code })
    case "done":
      break
  }
}
