import {
  DEFAULT_DEEPSEEK_MODEL,
  findKbChatModel,
  KB_CHAT_QUERY_MAX_CHARS,
  kbChatRequestSchema,
  type KbChatMessage,
  type KbChatModelId,
  type KbChatStreamEvent,
} from "@mankr/shared"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { getAnySearchKey } from "../lib/anysearch"
import { getDeepSeekKey } from "../lib/ai-service"
import { recordAiUsage } from "../lib/ai-usage"
import { callDeepSeekJson } from "../lib/deepseek"
import {
  createKbAgentContext,
  prefetchKbContext,
  runKbAgent,
} from "../lib/kb-agent"
import {
  compressKbContext,
  loadKbContext,
  planKbContext,
  saveKbContext,
  type ChatJsonFn,
} from "../lib/kb-context"
import { truncate } from "../lib/kb-search"
import { rateLimit } from "../lib/rate-limit"
import { getClientIp } from "../lib/utils"
import { requireAuth } from "../middleware/auth"

export const kbRoutes = new Hono<AppEnv>()

kbRoutes.use("/kb/*", requireAuth)

kbRoutes.post("/kb/chat", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`kb-chat:${ip}`, 20, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = kbChatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      400,
    )
  }

  const {
    messages,
    webSearch,
    model: requestedModel,
    conversationId,
    context: clientContext,
  } = parsed.data
  const question = [...messages].reverse().find((m) => m.role === "user")
    ?.content
  if (!question?.trim()) {
    return c.json({ error: "缺少用户提问", code: "BAD_REQUEST" }, 400)
  }

  const db = c.get("db")

  const deepseek = await getDeepSeekKey(db, c.env)
  if (!deepseek) {
    return c.json(
      {
        error: "尚未配置 DeepSeek API Key",
        code: "DEEPSEEK_NOT_CONFIGURED",
      },
      400,
    )
  }

  const resolved = resolveChatModel(requestedModel, deepseek.model)

  let anysearchKey: string | null = null
  if (webSearch) {
    anysearchKey = await getAnySearchKey(db, c.env)
    if (!anysearchKey) {
      return c.json(
        {
          error: "尚未配置联网搜索 Key",
          code: "ANYSEARCH_NOT_CONFIGURED",
        },
        400,
      )
    }
  }

  const started = Date.now()
  const query = truncate(question.trim(), KB_CHAT_QUERY_MAX_CHARS)

  const prefetch = await prefetchKbContext({
    db,
    query,
    anysearchKey,
    signal: c.req.raw.signal,
  })

  const failedWeb = prefetch.warnings.includes("ANYSEARCH_FAILED")

  // 两路皆空：不消耗生成额度，前端渲染本地化「未找到」。
  // 但问库结构（「我有哪些分类」「归类合理吗」）时分类目录本身就是答案，
  // 这种提问一律 empty 会让助手对着自己手上的资料装不知道。
  if (
    prefetch.hits.length === 0 &&
    prefetch.web.length === 0 &&
    !prefetch.structural
  ) {
    if (webSearch && failedWeb) {
      return c.json(
        { error: "联网搜索暂不可用", code: "ANYSEARCH_FAILED" },
        502,
      )
    }
    return sseResponse([
      { type: "meta", sources: [], warnings: prefetch.warnings },
      { type: "empty" },
    ])
  }

  const contextState = await loadKbContext(db, conversationId)
  const plan = planKbContext({
    messages,
    state: contextState,
    canPersist: Boolean(conversationId),
  })

  /**
   * 压缩与生成并发跑，不进流。
   *
   * 摘要服务的是**下一轮**的 prompt，本轮无论如何都用不上它，
   * 所以没有任何理由让首字节等一次完整的模型往返。
   * 注意两点：
   * - waitUntil 必须在 handler 返回前登记，流关闭后再登记会抛；
   * - 不能传 c.req.raw.signal，否则用户一点「停止」就把已经花了钱的
   *   压缩掐死在半路，下一轮还得重压一遍。
   */
  if (conversationId && plan.toCompress.length > 0 && plan.coversThroughId) {
    c.executionCtx.waitUntil(
      compressAndSave({
        db,
        conversationId,
        apiKey: deepseek.key,
        previousSummary: contextState.summary,
        dropped: plan.toCompress,
        coversThroughId: plan.coversThroughId,
      }),
    )
  }

  const context = createKbAgentContext(prefetch)
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端中止后 enqueue 会抛，若让它冒出去，后面的用量记账就被跳过了：
      // 用户点「停止」是常见路径，token 已真实消耗，必须照样落账。
      const send = (event: KbChatStreamEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
        } catch {
          // 下游已断开，丢弃剩余事件即可
        }
      }

      // meta 恒为首个事件且整轮只发一次，后续增量走 sources_append
      send({
        type: "meta",
        sources: context.sources,
        ...(prefetch.warnings.length > 0
          ? { warnings: prefetch.warnings }
          : {}),
      })

      const agent = runKbAgent(
        {
          db,
          query,
          messages: plan.messages,
          contextSummary: contextState.summary,
          apiKey: deepseek.key,
          model: resolved.model,
          supportsTools: resolved.supportsTools,
          anysearchKey,
          signal: c.req.raw.signal,
          startedAt: started,
          context: clientContext,
        },
        prefetch,
        context,
      )

      try {
        for (;;) {
          const next = await agent.next()
          if (next.done) {
            const result = next.value
            // 先记账再发送：记账是唯一不可丢的副作用
            await recordAiUsage(db, {
              kind: "kb_chat",
              model: result.model,
              status: result.status,
              usage: result.usage,
              errorCode: result.errorCode,
              latencyMs: Date.now() - started,
            })
            if (result.status === "error") {
              send({
                type: "error",
                code: "DEEPSEEK_FAILED",
                message: "生成失败，请重试",
              })
            } else {
              send({ type: "done" })
            }
            break
          }
          send(next.value)
        }
      } catch (err) {
        console.error("[kb] chat stream failed", err)
        await recordAiUsage(db, {
          kind: "kb_chat",
          model: resolved.model,
          status: "error",
          errorCode: "STREAM_FAILED",
          latencyMs: Date.now() - started,
        })
        send({
          type: "error",
          code: "DEEPSEEK_FAILED",
          message: "生成失败，请重试",
        })
      } finally {
        try {
          controller.close()
        } catch {
          // 已断开的流再 close 会抛，无需处理
        }
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})

/**
 * 后台压缩一次并落库。整个过程不抛：它跑在 waitUntil 里，
 * 没有任何调用方能处理异常，失败只意味着水位原地不动、下次超阈值再压。
 */
async function compressAndSave(input: {
  db: AppEnv["Variables"]["db"]
  conversationId: string
  apiKey: string
  previousSummary: string
  dropped: KbChatMessage[]
  coversThroughId: string
}): Promise<void> {
  const startedAt = Date.now()

  /**
   * 压缩固定用最便宜的模型，不跟随用户为本轮选的对话模型：
   * 归纳是简单任务，而 pro 的输入价是 flash 的 8 倍、输出价 16 倍
   * （见 DEEPSEEK_PRICE_USD_PER_1M），也更慢。
   *
   * 这个闭包就是 kb-context 认的全部厂商接口，接入其他厂商时换掉它即可。
   */
  const chatJson: ChatJsonFn = ({ messages, maxTokens }) =>
    callDeepSeekJson({
      apiKey: input.apiKey,
      model: DEFAULT_DEEPSEEK_MODEL,
      messages,
      maxTokens,
    })

  const result = await compressKbContext({
    previousSummary: input.previousSummary,
    dropped: input.dropped,
    coversThroughId: input.coversThroughId,
    chatJson,
  })

  if (result.next) {
    await saveKbContext(input.db, input.conversationId, result.next)
  }

  await recordAiUsage(input.db, {
    kind: "kb_compress",
    model: DEFAULT_DEEPSEEK_MODEL,
    status: result.errorCode ? "error" : "ok",
    usage: result.usage,
    errorCode: result.errorCode,
    latencyMs: Date.now() - startedAt,
  })
}

/**
 * 请求级模型覆盖：面板按轮次选模型，缺省时回落到用户设置里的模型。
 * schema 已把取值限定在 KB_CHAT_MODELS 内，这里按 provider 分发，
 * 接入其他厂商时在此追加分支（各家 key 与调用入口不同）。
 */
function resolveChatModel(
  requested: KbChatModelId | undefined,
  fallback: string,
): { model: string; supportsTools: boolean } {
  const entry = findKbChatModel(requested)
  if (entry?.provider === "deepseek") {
    return { model: entry.model, supportsTools: entry.tools }
  }
  // 设置里的模型未必在 KB_CHAT_MODELS 表内，查不到就按不支持工具处理
  return {
    model: fallback,
    supportsTools: findKbChatModel(fallback)?.tools ?? false,
  }
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const

function sseResponse(events: KbChatStreamEvent[]): Response {
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")
  return new Response(payload, { headers: SSE_HEADERS })
}
