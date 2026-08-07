import { DEFAULT_DEEPSEEK_MODEL, type KbChatStreamEvent } from "@mankr/shared"
import { env } from "cloudflare:test"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  OWNER,
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"
const DEEPSEEK = "https://api.deepseek.com/chat/completions"
const ANYSEARCH = "https://api.anysearch.com/v1/search"
const DEEPSEEK_KEY = "sk-test-deepseek-key-abcdef1234"
const ANYSEARCH_KEY = "as-test-anysearch-key-987654"

let client: TestClient
let outbound: OutboundMock

/** DeepSeek 流式响应（SSE） */
function deepseekStream(text: string): Response {
  const chunks = [
    ...Array.from(text).map((ch) =>
      JSON.stringify({ choices: [{ delta: { content: ch } }] }),
    ),
    JSON.stringify({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }),
  ]
  const payload =
    chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n"
  return new Response(payload, {
    headers: { "content-type": "text/event-stream" },
  })
}

async function readEvents(res: Response): Promise<KbChatStreamEvent[]> {
  const text = await res.text()
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data:"))
    .map((block) => JSON.parse(block.slice(5).trim()) as KbChatStreamEvent)
}

function chat(body: unknown) {
  return client.fetch("/api/kb/chat", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  outbound.text(
    `${GITHUB}facebook/react/readme`,
    "# React\n用于构建用户界面的状态管理与渲染库",
  )
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

async function seedBookmark() {
  const created = await client.post<{ id: string }>("/api/bookmarks", {
    url: "facebook/react",
  })
  expect(created.status).toBe(201)
  return created.body.id
}

describe("POST /api/kb/chat 门禁", () => {
  it("未登录返回 401", async () => {
    const anon = new TestClient()
    const res = await anon.post<{ code: string }>("/api/kb/chat", {
      messages: [{ role: "user", content: "react" }],
    })
    expect(res.status).toBe(401)
  })

  it("未配置 DeepSeek 返回 400 DEEPSEEK_NOT_CONFIGURED", async () => {
    const res = await client.post<{ code: string }>("/api/kb/chat", {
      messages: [{ role: "user", content: "react" }],
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("DEEPSEEK_NOT_CONFIGURED")
  })

  it("webSearch=true 但未配置 AnySearch 返回 400，且不发出联网请求", async () => {
    await client.put("/api/settings/deepseek", { apiKey: DEEPSEEK_KEY })
    const res = await client.post<{ code: string }>("/api/kb/chat", {
      messages: [{ role: "user", content: "react" }],
      webSearch: true,
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("ANYSEARCH_NOT_CONFIGURED")
    expect(outbound.calls.some((u) => u.startsWith(ANYSEARCH))).toBe(false)
  })

  it("消息为空返回 400", async () => {
    await client.put("/api/settings/deepseek", { apiKey: DEEPSEEK_KEY })
    const res = await client.post<{ code: string }>("/api/kb/chat", {
      messages: [],
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })
})

describe("POST /api/kb/chat 知识库检索", () => {
  beforeEach(async () => {
    await client.put("/api/settings/deepseek", { apiKey: DEEPSEEK_KEY })
  })

  it("FTS 命中收藏后返回 meta.sources 并流式生成", async () => {
    const id = await seedBookmark()
    outbound.on(DEEPSEEK, () => deepseekStream("React 可以用来构建界面。"))

    const res = await chat({
      messages: [{ role: "user", content: "有哪些和 react 相关的收藏？" }],
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")

    const events = await readEvents(res)
    const meta = events[0]
    expect(meta?.type).toBe("meta")
    if (meta?.type !== "meta") throw new Error("expected meta")
    expect(meta.sources.some((s) => s.type === "bookmark" && s.id === id)).toBe(
      true,
    )
    expect(meta.warnings).toBeUndefined()

    const text = events
      .filter((e) => e.type === "delta")
      .map((e) => (e.type === "delta" ? e.text : ""))
      .join("")
    expect(text).toBe("React 可以用来构建界面。")
    expect(events.at(-1)?.type).toBe("done")
  })

  it("库中无命中且未联网时不调用 DeepSeek，返回 empty", async () => {
    await seedBookmark()
    // 创建收藏时的 AI 分类也会打 DeepSeek，这里只看本轮对话是否新增调用
    const before = outbound.calls.length
    const res = await chat({
      messages: [{ role: "user", content: "量子退火超导材料" }],
    })
    expect(res.status).toBe(200)

    const events = await readEvents(res)
    expect(events.map((e) => e.type)).toEqual(["meta", "empty"])
    expect(
      outbound.calls.slice(before).some((u) => u.startsWith(DEEPSEEK)),
    ).toBe(false)
  })

  it("特殊字符提问不会 500", async () => {
    await seedBookmark()
    const res = await chat({
      messages: [{ role: "user", content: '"" OR (react* AND NEAR/' }],
    })
    expect(res.status).toBe(200)
  })

  it("归档的收藏不进入检索结果", async () => {
    const id = await seedBookmark()
    await client.patch(`/api/bookmarks/${id}`, { archived: true })

    const res = await chat({
      messages: [{ role: "user", content: "react 界面" }],
    })
    const events = await readEvents(res)
    expect(events.map((e) => e.type)).toEqual(["meta", "empty"])
  })

  it("clear-data 后 FTS 不再命中已删除的收藏", async () => {
    await seedBookmark()
    await client.post("/api/settings/clear-data")

    const relogin = new TestClient()
    await relogin.post("/api/auth/login", {
      username: OWNER.username,
      password: OWNER.password,
    })
    const res = await relogin.fetch("/api/kb/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "react 界面" }],
      }),
    })
    const events = await readEvents(res)
    expect(events.map((e) => e.type)).toEqual(["meta", "empty"])
  })

  it("写入 kb_chat 用量日志", async () => {
    await seedBookmark()
    outbound.on(DEEPSEEK, () => deepseekStream("答案"))
    await readEvents(
      await chat({ messages: [{ role: "user", content: "react" }] }),
    )

    const insights = await client.json<{
      ai: { by_kind: Array<{ kind: string; calls: number; total_tokens: number }> }
    }>("/api/insights?range=all")
    const kbChat = insights.body.ai.by_kind.find((k) => k.kind === "kb_chat")
    expect(kbChat?.calls).toBe(1)
    expect(kbChat?.total_tokens).toBe(120)
  })
})

describe("POST /api/kb/chat 模型选择", () => {
  beforeEach(async () => {
    await client.put("/api/settings/deepseek", { apiKey: DEEPSEEK_KEY })
  })

  it("请求里的模型进入上游调用与用量日志", async () => {
    await seedBookmark()
    const models: string[] = []
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as { model?: string }
      if (body.model) models.push(body.model)
      return deepseekStream("答案")
    })

    await readEvents(
      await chat({
        messages: [{ role: "user", content: "react" }],
        model: "deepseek-v4-pro",
      }),
    )

    expect(models).toContain("deepseek-v4-pro")
    const insights = await client.json<{
      ai: { by_kind: Array<{ kind: string; calls: number }> }
    }>("/api/insights?range=all")
    expect(
      insights.body.ai.by_kind.find((k) => k.kind === "kb_chat")?.calls,
    ).toBe(1)
  })

  it("未知模型被 schema 拦在 400，不发出任何上游请求", async () => {
    await seedBookmark()
    const before = outbound.calls.length
    const res = await client.post<{ code: string }>("/api/kb/chat", {
      messages: [{ role: "user", content: "react" }],
      model: "deepseek-v3-retired",
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
    expect(
      outbound.calls.slice(before).some((u) => u.startsWith(DEEPSEEK)),
    ).toBe(false)
  })
})

describe("POST /api/kb/chat 上下文压缩与缓存计量", () => {
  beforeEach(async () => {
    await client.put("/api/settings/deepseek", { apiKey: DEEPSEEK_KEY })
  })

  /**
   * 长到必然触发压缩的历史：条数超近窗（6），
   * 且按 chars/4 估算超过 KB_CONTEXT_COMPRESS_TOKEN_THRESHOLD（6000）。
   * 单条上限是 KB_CHAT_MESSAGE_MAX_CHARS（4000），所以靠条数堆量。
   *
   * 必须带 id：水位是「覆盖到哪条消息」的指针，没有 id 就没有能落库的水位。
   */
  function longHistory() {
    return Array.from({ length: 12 }, (_, i) => ({
      id: `h${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content:
        i % 2 === 0
          ? `第 ${i} 轮我想了解 react ${"補".repeat(3000)}`
          : `第 ${i} 轮的回答 ${"答".repeat(3000)}`,
    }))
  }

  /** 压缩走 JSON 模式，生成走流式，据此分流 */
  function summarizeAndStream(summary: string) {
    const models: string[] = []
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as {
        response_format?: unknown
        model?: string
      }
      if (!body.response_format) return deepseekStream("答案")
      models.push(body.model ?? "")
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ summary }) } }],
          usage: { prompt_tokens: 500, completion_tokens: 30, total_tokens: 530 },
        }),
      )
    })
    return models
  }

  it("超长会话触发压缩，摘要与水位落库", async () => {
    await seedBookmark()
    const id = crypto.randomUUID()
    summarizeAndStream("早期在聊 react")

    const history = longHistory()
    await readEvents(
      await chat({
        messages: [
          ...history,
          { id: "q", role: "user", content: "有哪些和 react 相关的收藏？" },
        ],
        conversationId: id,
      }),
    )

    const row = await env.DB.prepare(
      "SELECT context_summary, summary_covers_through_id FROM kb_conversations WHERE id = ?",
    )
      .bind(id)
      .first<{ context_summary: string; summary_covers_through_id: string }>()
    expect(row?.context_summary).toBe("早期在聊 react")
    // 近窗 6 条留原文，水位落在它之前那条上
    expect(row?.summary_covers_through_id).toBe("h6")
  })

  it("压缩不改写本轮 prompt：触发压缩的这一轮仍带完整历史", async () => {
    // 压缩跑在 waitUntil 里、摘要下一轮才生效，本轮没有理由自我阉割。
    await seedBookmark()
    let prompt: Array<{ role: string; content: string }> = []
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as {
        response_format?: unknown
        messages: Array<{ role: string; content: string }>
      }
      if (body.response_format) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ summary: "摘要" }) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        )
      }
      prompt = body.messages
      return deepseekStream("答案")
    })

    await readEvents(
      await chat({
        messages: [
          ...longHistory(),
          { id: "q", role: "user", content: "有哪些和 react 相关的收藏？" },
        ],
        conversationId: crypto.randomUUID(),
      }),
    )

    const joined = prompt.map((m) => m.content).join("\n")
    expect(joined).toContain("第 0 轮我想了解 react")
  })

  it("压缩失败不影响本轮回答，也不推进水位", async () => {
    await seedBookmark()
    const id = crypto.randomUUID()
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as { response_format?: unknown }
      return body.response_format
        ? new Response(JSON.stringify({ error: "boom" }), { status: 500 })
        : deepseekStream("答案")
    })

    const events = await readEvents(
      await chat({
        messages: [
          ...longHistory(),
          { id: "q", role: "user", content: "有哪些和 react 相关的收藏？" },
        ],
        conversationId: id,
      }),
    )

    expect(events.some((e) => e.type === "delta")).toBe(true)
    expect(events.some((e) => e.type === "error")).toBe(false)

    const row = await env.DB.prepare(
      "SELECT summary_covers_through_id FROM kb_conversations WHERE id = ?",
    )
      .bind(id)
      .first<{ summary_covers_through_id: string | null }>()
    expect(row?.summary_covers_through_id ?? null).toBeNull()
  })

  it("摘要进入下一轮 prompt，且排在检索资料之前", async () => {
    await seedBookmark()
    const id = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO kb_conversations (id, title, context_summary, summary_covers_through_id) VALUES (?, ?, ?, ?)",
    )
      .bind(id, "旧会话", "用户此前确认偏好 TypeScript", "h6")
      .run()

    let prompt: Array<{ role: string; content: string }> = []
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as {
        messages: Array<{ role: string; content: string }>
      }
      prompt = body.messages
      return deepseekStream("答案")
    })

    await readEvents(
      await chat({
        messages: [{ id: "q", role: "user", content: "有哪些和 react 相关的收藏？" }],
        conversationId: id,
      }),
    )

    const at = (needle: string) =>
      prompt.findIndex((m) => m.content.includes(needle))
    expect(at("用户此前确认偏好 TypeScript")).toBeGreaterThan(0)
    expect(at("用户此前确认偏好 TypeScript")).toBeLessThan(at("<资料>"))
  })

  it("客户端水位过期时服务端按 id 自行对齐，已进摘要的历史不再入 prompt", async () => {
    // 压缩是并发的，客户端要到下一次存档响应才拿到新指针，
    // 这期间它会把已被摘要覆盖的消息重新发上来。
    await seedBookmark()
    const id = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO kb_conversations (id, title, context_summary, summary_covers_through_id) VALUES (?, ?, ?, ?)",
    )
      .bind(id, "旧会话", "早期摘要", "h6")
      .run()

    let prompt: Array<{ role: string; content: string }> = []
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as {
        response_format?: unknown
        messages: Array<{ role: string; content: string }>
      }
      if (body.response_format) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ summary: "x" }) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        )
      }
      prompt = body.messages
      return deepseekStream("答案")
    })

    await readEvents(
      await chat({
        messages: [
          ...longHistory(),
          { id: "q", role: "user", content: "有哪些和 react 相关的收藏？" },
        ],
        conversationId: id,
      }),
    )

    const joined = prompt.map((m) => m.content).join("\n")
    expect(joined).not.toContain("第 0 轮我想了解 react")
    expect(joined).toContain("第 7 轮的回答")
  })

  it("历史不长时不压缩：只有一次上游调用", async () => {
    await seedBookmark()
    const before = outbound.calls.filter((u) => u.startsWith(DEEPSEEK)).length
    outbound.on(DEEPSEEK, () => deepseekStream("答案"))

    await readEvents(
      await chat({
        messages: [{ id: "q", role: "user", content: "有哪些和 react 相关的收藏？" }],
        conversationId: crypto.randomUUID(),
      }),
    )

    const calls = outbound.calls.filter((u) => u.startsWith(DEEPSEEK)).length
    expect(calls - before).toBe(1)
  })

  it("消息不带 id 时不压缩：没有能落库的水位", async () => {
    await seedBookmark()
    const id = crypto.randomUUID()
    const models = summarizeAndStream("不该产生")

    await readEvents(
      await chat({
        messages: [
          ...longHistory().map(({ role, content }) => ({ role, content })),
          { role: "user", content: "有哪些和 react 相关的收藏？" },
        ],
        conversationId: id,
      }),
    )

    expect(models).toEqual([])
  })

  it("不带 conversationId 也能正常对话，只是不读写摘要", async () => {
    await seedBookmark()
    const models = summarizeAndStream("不该产生")

    const events = await readEvents(
      await chat({
        messages: [
          ...longHistory(),
          { id: "q", role: "user", content: "有哪些和 react 相关的收藏？" },
        ],
      }),
    )
    expect(events.some((e) => e.type === "delta")).toBe(true)
    expect(models).toEqual([])
  })

  it("上游报告的缓存命中落进 ai_usage_logs 的通用列", async () => {
    await seedBookmark()
    outbound.on(DEEPSEEK, () => {
      const payload =
        `data: ${JSON.stringify({ choices: [{ delta: { content: "答案" } }] })}\n\n` +
        `data: ${JSON.stringify({
          choices: [{ delta: {} }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 20,
            total_tokens: 1020,
            prompt_cache_hit_tokens: 896,
            prompt_cache_miss_tokens: 104,
          },
        })}\n\n` +
        "data: [DONE]\n\n"
      return new Response(payload, {
        headers: { "content-type": "text/event-stream" },
      })
    })

    await readEvents(
      await chat({ messages: [{ role: "user", content: "react" }] }),
    )

    const row = await env.DB.prepare(
      "SELECT cache_read_tokens, cache_write_tokens, prompt_tokens FROM ai_usage_logs WHERE kind = 'kb_chat'",
    ).first<{
      cache_read_tokens: number
      cache_write_tokens: number
      prompt_tokens: number
    }>()
    expect(row?.cache_read_tokens).toBe(896)
    // DeepSeek 是隐式缓存，没有写入费用
    expect(row?.cache_write_tokens).toBe(0)
    expect(row?.prompt_tokens).toBe(1000)
  })

  it("压缩单独记一条 kb_compress，不混进 kb_chat", async () => {
    await seedBookmark()
    summarizeAndStream("摘要")

    await readEvents(
      await chat({
        messages: [
          ...longHistory(),
          { id: "q", role: "user", content: "有哪些和 react 相关的收藏？" },
        ],
        conversationId: crypto.randomUUID(),
      }),
    )

    const chatRow = await env.DB.prepare(
      "SELECT total_tokens FROM ai_usage_logs WHERE kind = 'kb_chat'",
    ).first<{ total_tokens: number }>()
    const compressRow = await env.DB.prepare(
      "SELECT total_tokens, status, model FROM ai_usage_logs WHERE kind = 'kb_compress'",
    ).first<{ total_tokens: number; status: string; model: string }>()

    expect(chatRow?.total_tokens).toBe(120)
    expect(compressRow?.total_tokens).toBe(530)
    expect(compressRow?.status).toBe("ok")
  })

  it("压缩固定用最便宜的模型，不跟随本轮选的对话模型", async () => {
    // 归纳是简单任务，而 pro 的输入价是 flash 的 8 倍、输出价 16 倍
    await seedBookmark()
    const models = summarizeAndStream("摘要")

    await readEvents(
      await chat({
        messages: [
          ...longHistory(),
          { id: "q", role: "user", content: "有哪些和 react 相关的收藏？" },
        ],
        model: "deepseek-v4-pro",
        conversationId: crypto.randomUUID(),
      }),
    )

    expect(models).toEqual([DEFAULT_DEEPSEEK_MODEL])
  })
})

describe("POST /api/kb/chat agent 循环", () => {
  /** 复杂问句才会触发路由判定，短问句走零成本快路径 */
  const COMPLEX_QUESTION =
    "对比一下我收藏里的 react 相关资料，分别说明各自的优缺点和适用场景"

  beforeEach(async () => {
    await client.put("/api/settings/deepseek", { apiKey: DEEPSEEK_KEY })
  })

  /** 依次消费的 DeepSeek 响应队列，用完后回落到最后一个 */
  function queueDeepSeek(responses: Array<() => Response>) {
    let i = 0
    outbound.on(DEEPSEEK, () => {
      const make = responses[Math.min(i, responses.length - 1)]
      i++
      return make!()
    })
    return () => i
  }

  function jsonResponse(payload: unknown, usageTokens = 10): Response {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: {
          prompt_tokens: usageTokens,
          completion_tokens: 0,
          total_tokens: usageTokens,
        },
      }),
      { headers: { "content-type": "application/json" } },
    )
  }

  /** 既无文本也无工具调用的一轮，用来把循环推到降级收尾 */
  function emptyStream(): Response {
    const usage = JSON.stringify({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    })
    return new Response(`data: ${usage}\n\ndata: [DONE]\n\n`, {
      headers: { "content-type": "text/event-stream" },
    })
  }

  /** 工具调用分片下发，验证 delta.tool_calls 的累积 */
  function toolCallStream(name: string, args: string): Response {
    const argChunks = Array.from(args)
    const chunks = [
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name, arguments: "" } },
              ],
            },
          },
        ],
      }),
      ...argChunks.map((ch) =>
        JSON.stringify({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: ch } }] } },
          ],
        }),
      ),
      JSON.stringify({
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
      }),
    ]
    return new Response(
      chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    )
  }

  it("复杂问题走工具循环：meta 只发一次，新增来源走 sources_append", async () => {
    await seedBookmark()
    queueDeepSeek([
      () => jsonResponse({ mode: "complex" }),
      () => jsonResponse({ steps: ["查收藏", "对比优缺点"] }),
      () => toolCallStream("search_bookmarks", '{"query":"react"}'),
      () => deepseekStream("对比结论 [#1]"),
    ])

    const events = await readEvents(
      await chat({ messages: [{ role: "user", content: COMPLEX_QUESTION }] }),
    )

    expect(events[0]?.type).toBe("meta")
    expect(events.filter((e) => e.type === "meta")).toHaveLength(1)
    expect(events.some((e) => e.type === "plan")).toBe(true)
    expect(events.some((e) => e.type === "plan_update")).toBe(true)
    expect(events.at(-1)?.type).toBe("done")

    const meta = events[0]
    if (meta?.type !== "meta") throw new Error("expected meta")
    // 首轮检索已把这条收藏编成 [#1]；工具又查到同一条时必须复用编号，
    // 一条都不能追加，否则正文里的 [#1] 会指向重复项
    expect(meta.sources).toHaveLength(1)
    expect(events.filter((e) => e.type === "sources_append")).toHaveLength(0)
  })

  it("工具无命中的回执不会被当成收藏资料拼进收尾 prompt", async () => {
    await seedBookmark()
    const prompts: string[] = []
    let calls = 0
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as {
        messages: Array<{ role: string; content: string }>
      }
      prompts.push(body.messages.map((m) => m.content).join("\n"))
      calls++
      if (calls === 1) return jsonResponse({ mode: "complex" })
      if (calls === 2) return jsonResponse({ steps: ["查收藏"] })
      // 工具查一个必然无命中的词，回执是「没有命中」而非资料
      if (calls === 3) {
        return toolCallStream("search_bookmarks", '{"query":"zzzznothing"}')
      }
      // 第二轮既不给文本也不再调工具：循环中断，进入收尾直出
      if (calls === 4) return emptyStream()
      return deepseekStream("结论")
    })

    const events = await readEvents(
      await chat({ messages: [{ role: "user", content: COMPLEX_QUESTION }] }),
    )
    expect(events.at(-1)?.type).toBe("done")

    const final = prompts.at(-1) ?? ""
    // 收尾 prompt 只该带真实资料：首轮命中的收藏在，工具的「没有命中」不在
    expect(final).toContain("只依据资料消息里提供的内容回答")
    expect(final).toContain("[#1]")
    expect(final).not.toContain("在收藏库中没有命中")
  })

  it("上游失败时先落用量日志再发 error 事件", async () => {
    await seedBookmark()
    outbound.on(
      DEEPSEEK,
      () => new Response("upstream down", { status: 503 }),
    )

    const events = await readEvents(
      await chat({ messages: [{ role: "user", content: "react" }] }),
    )
    expect(events.at(-1)?.type).toBe("error")

    const insights = await client.json<{
      ai: { by_kind: Array<{ kind: string; calls: number }> }
    }>("/api/insights?range=all")
    expect(
      insights.body.ai.by_kind.find((k) => k.kind === "kb_chat")?.calls,
    ).toBe(1)
  })

  it("循环路径下计划项最终都不停在进行中", async () => {
    await seedBookmark()
    queueDeepSeek([
      () => jsonResponse({ mode: "complex" }),
      () => jsonResponse({ steps: ["查收藏", "再查一次", "汇总"] }),
      () => toolCallStream("search_bookmarks", '{"query":"react"}'),
      () => deepseekStream("结论"),
    ])

    const events = await readEvents(
      await chat({ messages: [{ role: "user", content: COMPLEX_QUESTION }] }),
    )

    const plan = events.find((e) => e.type === "plan")
    if (plan?.type !== "plan") throw new Error("expected plan")
    const finalStatus = new Map(plan.items.map((i) => [i.id, i.status]))
    for (const event of events) {
      if (event.type === "plan_update") finalStatus.set(event.id, event.status)
    }
    expect([...finalStatus.values()].every((s) => s === "completed")).toBe(true)
  })

  it("多轮调用仍只写一条用量日志，token 为各轮之和", async () => {
    await seedBookmark()
    queueDeepSeek([
      () => jsonResponse({ mode: "complex" }, 10),
      () => jsonResponse({ steps: ["查收藏"] }, 10),
      () => toolCallStream("search_bookmarks", '{"query":"react"}'),
      () => deepseekStream("结论"),
    ])

    await readEvents(
      await chat({ messages: [{ role: "user", content: COMPLEX_QUESTION }] }),
    )

    const insights = await client.json<{
      ai: {
        by_kind: Array<{ kind: string; calls: number; total_tokens: number }>
      }
    }>("/api/insights?range=all")
    const kbChat = insights.body.ai.by_kind.find((k) => k.kind === "kb_chat")
    expect(kbChat?.calls).toBe(1)
    // 路由 10 + 计划 10 + 工具轮 40 + 收尾 120
    expect(kbChat?.total_tokens).toBe(180)
  })

  it("路由判定失败时降级为快路径，仍然正常收尾", async () => {
    await seedBookmark()
    let calls = 0
    outbound.on(DEEPSEEK, () => {
      calls++
      // 第一次是路由判定：返回非 JSON，逼它降级
      if (calls === 1) {
        return new Response("not json", {
          headers: { "content-type": "application/json" },
        })
      }
      return deepseekStream("快路径回答")
    })

    const events = await readEvents(
      await chat({ messages: [{ role: "user", content: COMPLEX_QUESTION }] }),
    )
    expect(events.some((e) => e.type === "plan")).toBe(false)
    expect(events.at(-1)?.type).toBe("done")
  })
})

describe("POST /api/kb/chat 联网搜索", () => {
  beforeEach(async () => {
    await client.put("/api/settings/deepseek", { apiKey: DEEPSEEK_KEY })
    await client.put("/api/settings/anysearch", { apiKey: ANYSEARCH_KEY })
  })

  it("联网结果进入 sources，且出站只发送本轮提问", async () => {
    await seedBookmark()
    outbound.on(DEEPSEEK, () => deepseekStream("结论"))
    let sentBody = ""
    outbound.on(ANYSEARCH, async (req) => {
      sentBody = await req.text()
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            results: [
              {
                title: "React 官网",
                url: "https://react.dev",
                snippet: "官方文档",
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      )
    })

    const res = await chat({
      messages: [
        { role: "user", content: "旧问题" },
        { role: "assistant", content: "旧回答" },
        { role: "user", content: "react 最新版本" },
      ],
      webSearch: true,
    })
    const events = await readEvents(res)
    const meta = events[0]
    if (meta?.type !== "meta") throw new Error("expected meta")

    expect(meta.sources.some((s) => s.type === "web")).toBe(true)
    const payload = JSON.parse(sentBody) as { query: string }
    expect(payload.query).toBe("react 最新版本")
    expect(sentBody).not.toContain("旧回答")
  })

  it("联网结果里的非 http(s) 链接不会进入 sources", async () => {
    outbound.on(DEEPSEEK, () => deepseekStream("回答"))
    outbound.json(ANYSEARCH, {
      code: 0,
      data: {
        results: [
          { title: "恶意结果", url: "javascript:alert(1)", snippet: "x" },
          { title: "正常结果", url: "https://react.dev", snippet: "y" },
        ],
      },
    })

    const events = await readEvents(
      await chat({
        messages: [{ role: "user", content: "量子退火超导材料" }],
        webSearch: true,
      }),
    )
    const meta = events[0]
    if (meta?.type !== "meta") throw new Error("expected meta")

    const webs = meta.sources.filter((s) => s.type === "web")
    expect(webs).toHaveLength(1)
    expect(webs[0]?.url).toBe("https://react.dev/")
  })

  it("FTS 有结果但联网失败：仍生成并带 ANYSEARCH_FAILED 警告", async () => {
    await seedBookmark()
    outbound.on(DEEPSEEK, () => deepseekStream("仅基于收藏的回答"))
    outbound.json(ANYSEARCH, { code: 500, message: "boom" }, 500)

    const res = await chat({
      messages: [{ role: "user", content: "react 界面" }],
      webSearch: true,
    })
    const events = await readEvents(res)
    const meta = events[0]
    if (meta?.type !== "meta") throw new Error("expected meta")

    expect(meta.warnings).toEqual(["ANYSEARCH_FAILED"])
    expect(events.at(-1)?.type).toBe("done")
  })

  it("FTS 空且联网失败：整轮失败返回 502", async () => {
    outbound.json(ANYSEARCH, { code: 500, message: "boom" }, 500)
    const res = await chat({
      messages: [{ role: "user", content: "量子退火超导材料" }],
      webSearch: true,
    })
    expect(res.status).toBe(502)
  })

  it("FTS 空但联网有结果：仍调用 DeepSeek 生成", async () => {
    outbound.on(DEEPSEEK, () => deepseekStream("来自网页的回答"))
    outbound.json(ANYSEARCH, {
      code: 0,
      data: {
        results: [
          { title: "论文", url: "https://arxiv.org/x", snippet: "退火" },
        ],
      },
    })

    const res = await chat({
      messages: [{ role: "user", content: "量子退火超导材料" }],
      webSearch: true,
    })
    const events = await readEvents(res)
    expect(events.some((e) => e.type === "delta")).toBe(true)
    expect(events.at(-1)?.type).toBe("done")
  })
})

/**
 * 直接断言索引表状态。走对话接口测不到这些：LIKE 兜底会在 FTS 失效时
 * 照样返回结果，把索引层面的问题全部掩盖掉。
 */
describe("bookmarks_fts 触发器", () => {
  const ftsTitle = async (id: string) => {
    const row = await env.DB.prepare(
      "SELECT title FROM bookmarks_fts WHERE bookmark_id = ?",
    )
      .bind(id)
      .first<{ title: string }>()
    return row?.title ?? null
  }

  it("新建写入索引，改标题同步索引", async () => {
    const id = await seedBookmark()
    expect(await ftsTitle(id)).toBeTruthy()

    await client.patch(`/api/bookmarks/${id}`, { title: "量子退火材料手册" })
    expect(await ftsTitle(id)).toBe("量子退火材料手册")
  })

  it("软删除后索引行被移除，不留孤儿", async () => {
    const id = await seedBookmark()
    await client.json(`/api/bookmarks/${id}`, { method: "DELETE" })
    expect(await ftsTitle(id)).toBeNull()
  })

  it("仅更新点击计数不重建索引行", async () => {
    const id = await seedBookmark()
    // 篡改索引内容作为哨兵：若点击计数唤起了触发器，哨兵会被真实标题覆盖
    await env.DB.prepare(
      "UPDATE bookmarks_fts SET title = 'SENTINEL' WHERE bookmark_id = ?",
    )
      .bind(id)
      .run()

    const opened = await client.post(`/api/bookmarks/${id}/open`)
    expect(opened.status).toBe(200)

    expect(await ftsTitle(id)).toBe("SENTINEL")
  })
})
