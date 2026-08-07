/**
 * 上下文压缩与缓存命中的核心不变量。
 *
 * 这些行为直接决定 token 账单，而它们的错误形态都是「静默变贵」而非报错：
 * 顺序错了照样有答案、水位漂了照样能回话，只有账单会涨。
 * 所以逐条钉死在测试里。
 */
import { createDb } from "@mankr/db"
import {
  KB_CHAT_REQUEST_MAX_MESSAGES,
  KB_CONTEXT_MAX_PROMPT_TOKENS,
  KB_CONTEXT_RECENT_MESSAGES,
  KB_CONTEXT_SUMMARY_MAX_CHARS,
  type KbChatMessage,
} from "@mankr/shared"
import { env } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import { buildKbChatPayload } from "../src/lib/kb-chat"
import {
  compressKbContext,
  EMPTY_KB_CONTEXT,
  estimateTokens,
  loadKbContext,
  planKbContext,
  saveKbContext,
  type ChatJsonFn,
  type KbContextState,
} from "../src/worker/lib/kb-context"
import { buildLoopMessages, buildMessages } from "../src/worker/lib/kb-prompts"
import {
  addLlmUsage,
  emptyLlmUsage,
  getCachePolicy,
  parseLlmUsage,
} from "../src/worker/lib/llm-provider"

function turn(n: number, long = false): KbChatMessage[] {
  return [
    {
      id: `u${n}`,
      role: "user",
      content: long ? `问题 ${n} ${"詳".repeat(3000)}` : `问题 ${n}`,
    },
    {
      id: `a${n}`,
      role: "assistant",
      content: long ? `回答 ${n} ${"答".repeat(3000)}` : `回答 ${n}`,
    },
  ]
}

/** 造出足以触发压缩的历史：条数超近窗，且估算 token 超阈值 */
function overflowingHistory(turns = 6): KbChatMessage[] {
  return Array.from({ length: turns }, (_, i) => turn(i + 1, true)).flat()
}

function summarizer(summary: string, tokens = 50): ChatJsonFn {
  return async () => ({
    content: JSON.stringify({ summary }),
    usage: {
      ...emptyLlmUsage(),
      prompt_tokens: tokens,
      completion_tokens: 10,
      total_tokens: tokens + 10,
    },
  })
}

const failingSummarizer: ChatJsonFn = async () => {
  throw new Error("upstream down")
}

const MATERIAL = {
  folderDigest: "- 读书清单：1 条",
  bookmarkContext: "[#1] React",
  webContext: "[W1] 网页",
}

describe("prompt 消息顺序（缓存命中的前提）", () => {
  it("易变的检索资料恒为最后一条，稳定段全部排在它前面", () => {
    const msgs = buildMessages({
      ...MATERIAL,
      contextSummary: "早期聊过状态管理",
      messages: turn(1),
    })

    expect(msgs.at(-1)?.content).toContain("<资料>")
    // 资料之前不允许再出现资料区块，否则前缀会在这里分叉
    expect(msgs.slice(0, -1).some((m) => m.content.includes("<资料>"))).toBe(
      false,
    )
    expect(msgs[0]?.role).toBe("system")
  })

  it("分类目录与摘要排在历史之前，历史只在尾部追加", () => {
    const msgs = buildMessages({
      ...MATERIAL,
      contextSummary: "早期聊过状态管理",
      messages: turn(1),
    })
    const at = (needle: string) =>
      msgs.findIndex((m) => m.content.includes(needle))

    expect(at("<收藏库分类>")).toBeLessThan(at("<已归纳的早期对话>"))
    expect(at("<已归纳的早期对话>")).toBeLessThan(at("问题 1"))
    expect(at("问题 1")).toBeLessThan(at("<资料>"))
  })

  it("没有分类时仍占一条固定占位消息，条数不随库内容变化", () => {
    const withFolders = buildMessages({
      ...MATERIAL,
      contextSummary: "",
      messages: turn(1),
    })
    const without = buildMessages({
      ...MATERIAL,
      folderDigest: "",
      contextSummary: "",
      messages: turn(1),
    })

    // 用户建了第一个分类之后，前缀的消息结构不能因此改变
    expect(without).toHaveLength(withFolders.length)
    expect(without[1]?.content).toContain("<收藏库分类>")
  })

  it("system 逐字节稳定：联网开关与命中情况都不改写它", () => {
    const a = buildMessages({ ...MATERIAL, contextSummary: "", messages: [] })
    const b = buildMessages({
      ...MATERIAL,
      folderDigest: "",
      bookmarkContext: "",
      webContext: "",
      contextSummary: "",
      messages: turn(2),
    })

    expect(a[0]?.content).toBe(b[0]?.content)
  })

  it("摘要为空时不发空占位，避免白付 token", () => {
    const msgs = buildMessages({
      ...MATERIAL,
      contextSummary: "   ",
      messages: turn(1),
    })
    expect(msgs.some((m) => m.content.includes("<已归纳的早期对话>"))).toBe(false)
  })

  it("工具循环的起始消息遵循同一套顺序", () => {
    const msgs = buildLoopMessages({
      messages: turn(1),
      contextSummary: "早期摘要",
      folderDigest: "- 读书清单：1 条",
      bookmarkContext: "[#1] React",
      webContext: "[W1] 网页",
    })

    expect(msgs[0]?.role).toBe("system")
    expect(msgs.at(-1)?.content).toContain("<资料>")
  })
})

describe("压缩计划（planKbContext）", () => {
  const state: KbContextState = EMPTY_KB_CONTEXT

  it("历史很短时不压缩", () => {
    const plan = planKbContext({ messages: turn(1), state, canPersist: true })

    expect(plan.toCompress).toEqual([])
    expect(plan.coversThroughId).toBeNull()
    expect(plan.messages).toHaveLength(2)
  })

  it("未触发压缩时原样透传，不做滑动窗口截断", () => {
    // 20 条短消息：远超旧的 slice(-10)，但估算 token 未到阈值。
    // 每轮 slice(-10) 会让第一条历史逐轮位移，前缀缓存全数失效，
    // 所以这里必须一条不少地透传。
    const many = Array.from({ length: 10 }, (_, i) => turn(i + 1)).flat()
    const plan = planKbContext({ messages: many, state, canPersist: true })

    expect(plan.messages).toEqual(many)
    expect(plan.toCompress).toEqual([])
  })

  it("条数够多但 token 还没到阈值时也不压缩", () => {
    const short = Array.from({ length: 4 }, (_, i) => turn(i + 1)).flat()
    const plan = planKbContext({ messages: short, state, canPersist: true })

    expect(plan.toCompress).toEqual([])
    expect(plan.messages).toEqual(short)
  })

  it("超阈值时把近窗以外的旧段交给压缩，水位指向其最后一条", () => {
    const messages = overflowingHistory()
    const plan = planKbContext({ messages, state, canPersist: true })

    expect(plan.toCompress).toEqual(
      messages.slice(0, messages.length - KB_CONTEXT_RECENT_MESSAGES),
    )
    expect(plan.coversThroughId).toBe(plan.toCompress.at(-1)?.id)
  })

  it("触发压缩的这一轮 prompt 仍是全量历史，不为并发的压缩让出上下文", () => {
    // 压缩跑在 waitUntil 里、摘要下一轮才可用，所以本轮没有任何理由自我阉割。
    // 代价只是这一轮多付一次未压缩的 input，换掉的是整个首字节等待。
    const messages = overflowingHistory()
    const plan = planKbContext({ messages, state, canPersist: true })

    expect(plan.messages).toEqual(messages)
  })

  it("摘要存不下时不压缩：收益全在后续轮次，存不下就没有后续", () => {
    const messages = overflowingHistory()
    const plan = planKbContext({ messages, state, canPersist: false })

    expect(plan.toCompress).toEqual([])
    expect(plan.coversThroughId).toBeNull()
  })

  it("消息不带 id 时不压缩：没有能落库的水位，压了也跳不过去", () => {
    const messages = overflowingHistory().map(({ role, content }) => ({
      role,
      content,
    }))
    const plan = planKbContext({ messages, state, canPersist: true })

    expect(plan.toCompress).toEqual([])
  })

  it("客户端水位过期时服务端自行按 id 对齐，同一段历史不会被压两次", () => {
    // 压缩与生成并发，客户端要到下一次存档响应才拿到新指针；
    // 这期间它会把已进摘要的消息重新发上来，服务端必须自己丢掉。
    const messages = overflowingHistory()
    const covered = messages.slice(0, 6)
    const plan = planKbContext({
      messages,
      state: {
        summary: "早期摘要",
        coversThroughId: covered.at(-1)?.id ?? null,
      },
      canPersist: true,
    })

    expect(plan.messages).toEqual(messages.slice(6))
    for (const m of covered) {
      expect(plan.toCompress).not.toContain(m)
    }
  })

  it("水位指向最后一条时至少留一条，否则没有可回答的提问", () => {
    const messages = turn(1)
    const plan = planKbContext({
      messages,
      state: { summary: "全都压了", coversThroughId: messages.at(-1)?.id ?? null },
      canPersist: true,
    })

    expect(plan.messages).toEqual(messages.slice(-1))
  })

  it("水位指向的消息已不在请求里时按原样处理，不误删任何一条", () => {
    const messages = overflowingHistory()
    const plan = planKbContext({
      messages,
      state: { summary: "旧摘要", coversThroughId: "早已被重试丢弃的 id" },
      canPersist: true,
    })

    expect(plan.messages).toEqual(messages)
  })

  it("历史顶穿容量上限时从最旧的一端砍，保住当前提问", () => {
    // 30 条 4000 字 ≈ 30k token，超过 20k 的容量上限。
    // 这是容量保底，与 6000 的成本阈值是两件事。
    const huge: KbChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      id: `h${i}`,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: "字".repeat(4000),
    }))
    const plan = planKbContext({
      messages: huge,
      state: EMPTY_KB_CONTEXT,
      canPersist: true,
    })

    expect(plan.messages.length).toBeLessThan(huge.length)
    expect(plan.messages.at(-1)).toEqual(huge.at(-1))
    expect(
      plan.messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0),
    ).toBeLessThanOrEqual(KB_CONTEXT_MAX_PROMPT_TOKENS)
  })
})

describe("压缩执行（compressKbContext）", () => {
  const dropped = overflowingHistory().slice(0, 6)

  it("增量合并：已有摘要一并送进压缩", async () => {
    let prompt = ""
    const result = await compressKbContext({
      previousSummary: "此前已确认用户偏好 TypeScript",
      dropped,
      coversThroughId: "a3",
      chatJson: async (opts) => {
        prompt = opts.messages.map((m) => m.content).join("\n")
        return {
          content: JSON.stringify({ summary: "合并后的摘要" }),
          usage: emptyLlmUsage(),
        }
      },
    })

    expect(prompt).toContain("此前已确认用户偏好 TypeScript")
    expect(result.next).toEqual({
      summary: "合并后的摘要",
      coversThroughId: "a3",
    })
  })

  it("摘要超长时截断，不让摘要自己变成新的负担", async () => {
    const result = await compressKbContext({
      previousSummary: "",
      dropped,
      coversThroughId: "a3",
      chatJson: summarizer("长".repeat(KB_CONTEXT_SUMMARY_MAX_CHARS + 500)),
    })

    expect(result.next?.summary.length).toBe(KB_CONTEXT_SUMMARY_MAX_CHARS)
  })

  it("上游失败时水位原地不动，且不抛给 waitUntil", async () => {
    const result = await compressKbContext({
      previousSummary: "旧摘要",
      dropped,
      coversThroughId: "a3",
      chatJson: failingSummarizer,
    })

    expect(result.next).toBeNull()
    expect(result.errorCode).toBe("COMPRESS_FAILED")
  })

  it("JSON 里没有 summary 时不推进水位，但仍然记账", async () => {
    const result = await compressKbContext({
      previousSummary: "",
      dropped,
      coversThroughId: "a3",
      chatJson: async () => ({
        content: JSON.stringify({ nope: 1 }),
        usage: { ...emptyLlmUsage(), prompt_tokens: 80, total_tokens: 80 },
      }),
    })

    expect(result.next).toBeNull()
    // 调用已经发生，token 已经花掉，不能从账上凭空消失
    expect(result.usage.total_tokens).toBe(80)
    expect(result.errorCode).toBe("SUMMARY_UNPARSEABLE")
  })

  it("估算只需单调：中文与英文都按字符折算，不引 tokenizer", () => {
    expect(estimateTokens("")).toBe(0)
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("八个字的中文内容")).toBe(2)
  })
})

/**
 * 水位错位是这套设计里最贵的失效模式：不报错、不影响答案，只是让同一段历史
 * 每轮重发并重压。之所以把水位定义成「覆盖到哪条消息 id」而不是条数，
 * 就是因为下面两种情况会让两端的条数对不上。
 */
describe("水位不漂移（客户端裁剪 × 服务端对齐）", () => {
  /** 长到十几条就能顶过压缩阈值 */
  function longMessage(id: string, role: "user" | "assistant") {
    return { id, role, content: `${id} ${"字".repeat(2500)}` }
  }

  /** 客户端与服务端唯一共享的坐标：过滤后的可发送序列 */
  function sendable(history: readonly { id: string; content: string }[]) {
    return history.filter((m) => m.content.trim().length > 0).map((m) => m.id)
  }

  function assertNoOverlapNoGap(
    history: readonly { id: string; role: "user" | "assistant"; content: string }[],
    plan: ReturnType<typeof planKbContext>,
  ) {
    const ids = sendable(history)
    const pointer = plan.coversThroughId
    expect(pointer).toBeTruthy()

    const next = buildKbChatPayload(history, pointer)
    const compressed = new Set(plan.toCompress.map((m) => m.id))

    // 不重叠：已进摘要的消息一条都不该再发
    for (const m of next) expect(compressed.has(m.id)).toBe(false)
    // 不留空洞：下一轮的第一条紧跟在水位之后
    expect(next[0]?.id).toBe(ids[ids.indexOf(pointer as string) + 1])
  }

  it("历史里夹着被中止的空回合时，水位仍然精确", () => {
    // 空内容的回合（中止、无命中）会被客户端丢掉。按条数算水位，
    // 服务端每漏掉一条这样的消息就少推进一格，之后每轮都重发一条。
    const history = [
      ...Array.from({ length: 4 }, (_, i) =>
        longMessage(`m${i}`, i % 2 === 0 ? "user" : "assistant"),
      ),
      { id: "aborted", role: "assistant" as const, content: "" },
      ...Array.from({ length: 9 }, (_, i) =>
        longMessage(`n${i}`, i % 2 === 0 ? "user" : "assistant"),
      ),
    ]

    const payload = buildKbChatPayload(history)
    expect(payload.some((m) => m.id === "aborted")).toBe(false)

    const plan = planKbContext({
      messages: payload,
      state: EMPTY_KB_CONTEXT,
      canPersist: true,
    })
    assertNoOverlapNoGap(history, plan)
  })

  it("历史超请求上限被截断时，水位仍然精确", () => {
    // 客户端只发得下 KB_CHAT_REQUEST_MAX_MESSAGES 条，更旧的直接看不见。
    // 那部分上下文的丢失是请求上限的固有代价，但绝不能让水位跟着错位。
    const history = Array.from({ length: KB_CHAT_REQUEST_MAX_MESSAGES + 12 }, (_, i) =>
      longMessage(`t${i}`, i % 2 === 0 ? "user" : "assistant"),
    )

    const payload = buildKbChatPayload(history)
    expect(payload).toHaveLength(KB_CHAT_REQUEST_MAX_MESSAGES)

    const plan = planKbContext({
      messages: payload,
      state: EMPTY_KB_CONTEXT,
      canPersist: true,
    })
    assertNoOverlapNoGap(history, plan)
  })

  it("按 id 跳过已覆盖前缀，只回传尾部", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `第 ${i} 条`,
    }))

    const payload = buildKbChatPayload(history, "m5")
    expect(payload).toHaveLength(6)
    expect(payload[0]?.id).toBe("m6")
  })

  it("没有水位时全量回传", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `第 ${i} 条`,
    }))

    expect(buildKbChatPayload(history)).toHaveLength(12)
  })

  it("水位指向最后一条时至少留一条，避免打成 VALIDATION_ERROR", () => {
    const history = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `第 ${i} 条`,
    }))

    const payload = buildKbChatPayload(history, "m2")
    expect(payload).toHaveLength(1)
    expect(payload[0]?.id).toBe("m2")
  })

  it("水位指向的消息已被重试丢弃时全量回传，交给服务端对齐", () => {
    const history = Array.from({ length: 4 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `第 ${i} 条`,
    }))

    expect(buildKbChatPayload(history, "已经不存在了")).toHaveLength(4)
  })
})

describe("会话侧摘要持久化", () => {
  it("会话行还不存在时也能写入（upsert），不静默丢摘要", async () => {
    const db = createDb(env)
    const id = crypto.randomUUID()

    // 压缩跑在 waitUntil 里，可能比存档请求更早到
    await saveKbContext(db, id, {
      summary: "首次压缩",
      coversThroughId: "a2",
    })

    expect(await loadKbContext(db, id)).toEqual({
      summary: "首次压缩",
      coversThroughId: "a2",
    })
  })

  it("重复写入按 id 覆盖，水位随之推进", async () => {
    const db = createDb(env)
    const id = crypto.randomUUID()

    await saveKbContext(db, id, { summary: "第一次", coversThroughId: "a2" })
    await saveKbContext(db, id, { summary: "第二次", coversThroughId: "a5" })

    expect(await loadKbContext(db, id)).toEqual({
      summary: "第二次",
      coversThroughId: "a5",
    })
  })

  it("写库失败只记日志，不抛给 waitUntil", async () => {
    // 客户端的水位只能从库里读回，永远不会超过实际落库的值，
    // 所以写失败最多让下次超阈值时重压一遍，不存在丢上下文的窗口。
    const broken = createDb({
      DB: {
        prepare: () => {
          throw new Error("D1_ERROR: transient write failure")
        },
      } as unknown as D1Database,
    })

    await expect(
      saveKbContext(broken, crypto.randomUUID(), {
        summary: "摘要",
        coversThroughId: "a2",
      }),
    ).resolves.toBeUndefined()
  })

  it("没有 conversationId 或会话不存在时返回空状态", async () => {
    const db = createDb(env)
    expect(await loadKbContext(db, undefined)).toEqual(EMPTY_KB_CONTEXT)
    expect(await loadKbContext(db, crypto.randomUUID())).toEqual(
      EMPTY_KB_CONTEXT,
    )
  })
})

describe("提供方无关的缓存计量", () => {
  it("DeepSeek 的命中字段归一到 cache_read_tokens", () => {
    const usage = parseLlmUsage(
      {
        prompt_tokens: 1000,
        completion_tokens: 50,
        total_tokens: 1050,
        prompt_cache_hit_tokens: 896,
        prompt_cache_miss_tokens: 104,
      },
      "deepseek",
    )

    expect(usage.cache_read_tokens).toBe(896)
    // 隐式磁盘缓存没有写入费用
    expect(usage.cache_write_tokens).toBe(0)
    expect(usage.prompt_tokens).toBe(1000)
  })

  it("未适配的厂商只降级缓存字段，主用量照常记账", () => {
    const usage = parseLlmUsage(
      { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      "some-future-vendor",
    )

    expect(usage.prompt_tokens).toBe(10)
    expect(usage.total_tokens).toBe(12)
    expect(usage.cache_read_tokens).toBe(0)
  })

  it("usage 缺失或非对象时返回全零而不抛", () => {
    expect(parseLlmUsage(null)).toEqual(emptyLlmUsage())
    expect(parseLlmUsage("nope")).toEqual(emptyLlmUsage())
  })

  it("total_tokens 缺失时由 prompt + completion 兜底", () => {
    const usage = parseLlmUsage({ prompt_tokens: 7, completion_tokens: 3 })
    expect(usage.total_tokens).toBe(10)
  })

  it("累加会带上缓存字段，多轮 agent 才不会恒为 0", () => {
    const target = emptyLlmUsage()
    addLlmUsage(target, {
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      cache_read_tokens: 64,
      cache_write_tokens: 0,
    })
    addLlmUsage(target, {
      prompt_tokens: 200,
      completion_tokens: 20,
      total_tokens: 220,
      cache_read_tokens: 128,
      cache_write_tokens: 5,
    })

    expect(target.cache_read_tokens).toBe(192)
    expect(target.cache_write_tokens).toBe(5)
    expect(target.total_tokens).toBe(330)
  })

  it("DeepSeek 是隐式缓存：不需要在请求上打任何标记", () => {
    expect(getCachePolicy("deepseek").mode).toBe("implicit")
    expect(getCachePolicy("deepseek").applyCacheHints).toBeUndefined()
    // 未知厂商也按 implicit 处理，稳定前缀布局对它们同样有效
    expect(getCachePolicy(undefined).mode).toBe("implicit")
  })
})
