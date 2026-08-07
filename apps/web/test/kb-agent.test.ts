/**
 * kb-agent 的保护逻辑用假 fetch 打桩验证：轮数上限、时间预算、工具连续失败。
 * 这些分支走 HTTP 很难稳定复现（要么等真时间，要么依赖模型输出）。
 */
import { createDb } from "@mankr/db"
import {
  KB_AGENT_MAX_TOOL_ROUNDS,
  KB_AGENT_TIME_BUDGET_MS,
  type KbChatStreamEvent,
} from "@mankr/shared"
import { env } from "cloudflare:test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createKbAgentContext,
  runKbAgent,
  type KbAgentResult,
  type KbPrefetch,
} from "../src/worker/lib/kb-agent"

const DEEPSEEK = "https://api.deepseek.com/chat/completions"

/** 触发路由判定的复杂问句（短问句会被零成本粗筛判成 simple） */
const COMPLEX_QUESTION = "对比一下我收藏里的 react 资料，分别说明各自的优缺点"

type Recorded = { tools: boolean; jsonMode: boolean }

function stubDeepSeek(
  handler: (body: Record<string, unknown>, call: number) => Response,
) {
  const recorded: Recorded[] = []
  let calls = 0
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input)
      if (!url.startsWith(DEEPSEEK)) {
        throw new Error(`未 mock 的出站请求: ${url}`)
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >
      recorded.push({
        tools: Array.isArray(body.tools),
        jsonMode: Boolean(body.response_format),
      })
      calls++
      return handler(body, calls)
    },
  )
  return recorded
}

function jsonReply(payload: unknown, tokens = 10): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: {
        prompt_tokens: tokens,
        completion_tokens: 0,
        total_tokens: tokens,
      },
    }),
    { headers: { "content-type": "application/json" } },
  )
}

function textStream(text: string): Response {
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
    `data: ${JSON.stringify({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })}\n\n` +
    "data: [DONE]\n\n"
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  })
}

function toolCallStream(name: string, args: string): Response {
  const body =
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: `call_${name}`, function: { name, arguments: "" } },
            ],
          },
        },
      ],
    })}\n\n` +
    Array.from(args)
      .map(
        (ch) =>
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: ch } }],
                },
              },
            ],
          })}\n\n`,
      )
      .join("") +
    "data: [DONE]\n\n"
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  })
}

const EMPTY_PREFETCH: KbPrefetch = { hits: [], web: [], warnings: [] }

async function collect(input: {
  startedAt?: number
  prefetch?: KbPrefetch
}): Promise<{ events: KbChatStreamEvent[]; result: KbAgentResult }> {
  const prefetch = input.prefetch ?? EMPTY_PREFETCH
  const agent = runKbAgent(
    {
      db: createDb(env),
      query: COMPLEX_QUESTION,
      messages: [{ role: "user", content: COMPLEX_QUESTION }],
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      supportsTools: true,
      anysearchKey: null,
      startedAt: input.startedAt,
    },
    prefetch,
    createKbAgentContext(prefetch),
  )

  const events: KbChatStreamEvent[] = []
  for (;;) {
    const next = await agent.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("runKbAgent 快路径", () => {
  it("短问句不为路由多付一次调用", async () => {
    const recorded = stubDeepSeek(() => textStream("直接回答"))
    const agent = runKbAgent(
      {
        db: createDb(env),
        query: "react",
        messages: [{ role: "user", content: "react" }],
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        supportsTools: true,
        anysearchKey: null,
      },
      EMPTY_PREFETCH,
      createKbAgentContext(EMPTY_PREFETCH),
    )
    for (;;) {
      const next = await agent.next()
      if (next.done) break
    }
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.jsonMode).toBe(false)
  })

  it("模型不支持工具时不做路由判定", async () => {
    const recorded = stubDeepSeek(() => textStream("直接回答"))
    const agent = runKbAgent(
      {
        db: createDb(env),
        query: COMPLEX_QUESTION,
        messages: [{ role: "user", content: COMPLEX_QUESTION }],
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        supportsTools: false,
        anysearchKey: null,
      },
      EMPTY_PREFETCH,
      createKbAgentContext(EMPTY_PREFETCH),
    )
    for (;;) {
      const next = await agent.next()
      if (next.done) break
    }
    expect(recorded).toHaveLength(1)
  })

  it("联网未启用时不发联网检索的 activity", async () => {
    stubDeepSeek(() => textStream("答案"))
    const { events } = await collect({})
    const ids = events.flatMap((e) =>
      e.type === "activity" ? [e.item.id] : [],
    )
    expect(ids).toContain("prefetch-bookmarks")
    expect(ids).not.toContain("prefetch-web")
  })
})

describe("runKbAgent 保护阈值", () => {
  it("时间预算已耗尽时连路由判定都跳过，直接生成收尾", async () => {
    const recorded = stubDeepSeek((body) =>
      body.response_format
        ? jsonReply({ mode: "complex" })
        : textStream("兜底回答"),
    )

    const { events, result } = await collect({
      // 预算基准提前到过去：一进来就已超预算
      startedAt: Date.now() - KB_AGENT_TIME_BUDGET_MS - 1,
    })

    expect(result.status).toBe("ok")
    expect(events.some((e) => e.type === "delta")).toBe(true)
    // 只剩一次直出生成：既没有路由判定，也没有带 tools 的取资料调用
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toEqual({ tools: false, jsonMode: false })
  })

  it("模型一直要工具时按轮数上限停手，仍给出回答", async () => {
    const recorded = stubDeepSeek((body, call) => {
      if (call === 1) return jsonReply({ mode: "complex" })
      if (call === 2) return jsonReply({ steps: ["查收藏", "汇总"] })
      return Array.isArray(body.tools)
        ? toolCallStream("search_bookmarks", '{"query":"react"}')
        : textStream("按已有资料回答")
    })

    const { events, result } = await collect({})

    expect(recorded.filter((r) => r.tools)).toHaveLength(
      KB_AGENT_MAX_TOOL_ROUNDS,
    )
    expect(events.some((e) => e.type === "delta")).toBe(true)
    expect(result.status).toBe("ok")

    // 计划项不能停在进行中，否则前端 TodoList 永久转圈
    const plan = events.find((e) => e.type === "plan")
    if (plan?.type !== "plan") throw new Error("expected plan")
    const status = new Map(plan.items.map((i) => [i.id, i.status]))
    for (const event of events) {
      if (event.type === "plan_update") status.set(event.id, event.status)
    }
    expect([...status.values()].every((s) => s === "completed")).toBe(true)
  })

  it("工具连续失败时提前停手而不烧光轮数", async () => {
    const recorded = stubDeepSeek((body, call) => {
      if (call === 1) return jsonReply({ mode: "complex" })
      if (call === 2) return jsonReply({ steps: ["查收藏"] })
      return Array.isArray(body.tools)
        ? // 未注册的工具名 → execute 返回 failed
          toolCallStream("search_notion", "{}")
        : textStream("资料不足的说明")
    })

    const { result } = await collect({})

    expect(recorded.filter((r) => r.tools).length).toBeLessThan(
      KB_AGENT_MAX_TOOL_ROUNDS,
    )
    expect(result.status).toBe("ok")
  })

  it("多轮 usage 聚合成一份，供路由写单条日志", async () => {
    stubDeepSeek((body, call) => {
      if (call === 1) return jsonReply({ mode: "complex" }, 10)
      if (call === 2) return jsonReply({ steps: ["查收藏"] }, 10)
      return Array.isArray(body.tools)
        ? textStream("一轮就够")
        : textStream("兜底")
    })

    const { result } = await collect({})

    // 路由 10 + 计划 10 + 生成 15
    expect(result.usage?.total_tokens).toBe(35)
  })
})
