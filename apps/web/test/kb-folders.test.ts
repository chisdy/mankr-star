import type { KbChatStreamEvent } from "@mankr/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"
const DEEPSEEK = "https://api.deepseek.com/chat/completions"
const DEEPSEEK_KEY = "sk-test-deepseek-key-abcdef1234"

let client: TestClient
let outbound: OutboundMock

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
  return new Response(
    chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

function jsonResponse(payload: unknown, tokens = 20): Response {
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

function toolCallStream(name: string, args: string): Response {
  const chunks = [
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name, arguments: args },
              },
            ],
          },
        },
      ],
    }),
    JSON.stringify({
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
    }),
  ]
  return new Response(
    chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

/** 按顺序消费的 DeepSeek 应答队列，用尽后回落到最后一个 */
function queueDeepSeek(responses: Array<() => Response>) {
  let i = 0
  outbound.on(DEEPSEEK, () => {
    const next = responses[Math.min(i, responses.length - 1)]!
    i++
    return next()
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
  await client.put("/api/settings/deepseek", { apiKey: DEEPSEEK_KEY })
})

afterEach(() => {
  outbound.restore()
})

/** 建一个夹名与收藏正文毫无字面重合的文件夹，并把收藏放进去 */
async function seedFoldered(name: string, slug: string) {
  const folder = await client.post<{ id: string }>("/api/folders", {
    name,
    slug,
  })
  expect(folder.status).toBe(201)
  const created = await client.post<{ id: string }>("/api/bookmarks", {
    url: "facebook/react",
    folderId: folder.body.id,
  })
  expect(created.status).toBe(201)
  return { folderId: folder.body.id, bookmarkId: created.body.id }
}

/** 捕获发往 DeepSeek 的最后一次 prompt 全文 */
function capturePrompts(reply: () => Response) {
  const prompts: string[] = []
  outbound.on(DEEPSEEK, async (req) => {
    const body = (await req.json()) as {
      messages: Array<{ role: string; content: string }>
    }
    prompts.push(body.messages.map((m) => `${m.role}: ${m.content}`).join("\n"))
    return reply()
  })
  return prompts
}

describe("收藏库分类进入对话上下文", () => {
  it("分类目录随每轮 prompt 常驻，含层级与条数", async () => {
    const parent = await client.post<{ id: string }>("/api/folders", {
      name: "读书清单",
      slug: "reading-list",
    })
    await client.post("/api/folders", {
      name: "睡前读物",
      slug: "bedtime",
      parentId: parent.body.id,
    })
    await client.post("/api/bookmarks", {
      url: "facebook/react",
      folderId: parent.body.id,
    })

    const prompts = capturePrompts(() => deepseekStream("答案"))
    await readEvents(await chat({ messages: [{ role: "user", content: "react" }] }))

    const last = prompts.at(-1) ?? ""
    expect(last).toContain("<收藏库分类>")
    expect(last).toContain("读书清单：1 条")
    // 子分类以「父 / 子」呈现，模型才能看出嵌套关系
    expect(last).toContain("读书清单 / 睡前读物：0 条")
  })

  it("点名分类名的提问能取到该分类下的收藏，即使正文不含这个词", async () => {
    const { bookmarkId } = await seedFoldered("读书清单", "reading-list")

    outbound.on(DEEPSEEK, () => deepseekStream("这个分类里有 1 条收藏 [#1]"))
    const events = await readEvents(
      await chat({
        messages: [{ role: "user", content: "帮我总结一下 读书清单 里的收藏" }],
      }),
    )

    const meta = events.find((e) => e.type === "meta")
    expect(meta?.type === "meta" && meta.sources.map((s) => s.id)).toContain(
      bookmarkId,
    )
  })

  it("点名标签名的提问同样能取到收藏", async () => {
    const { bookmarkId } = await seedFoldered("归档夹", "archive-box")
    await client.patch(`/api/bookmarks/${bookmarkId}`, {
      tagNames: ["待读清单"],
    })

    outbound.on(DEEPSEEK, () => deepseekStream("有 1 条 [#1]"))
    const events = await readEvents(
      await chat({
        messages: [{ role: "user", content: "待读清单 里有什么" }],
      }),
    )

    const meta = events.find((e) => e.type === "meta")
    expect(meta?.type === "meta" && meta.sources.map((s) => s.id)).toContain(
      bookmarkId,
    )
  })

  it("归档的收藏不会被分类命中带出来", async () => {
    const { bookmarkId } = await seedFoldered("读书清单", "reading-list")
    await client.patch(`/api/bookmarks/${bookmarkId}`, { archived: true })

    const events = await readEvents(
      await chat({ messages: [{ role: "user", content: "读书清单 里有什么" }] }),
    )
    expect(events.map((e) => e.type)).toEqual(["meta", "empty"])
  })

  it("问分类结构时即便检索无命中也照常回答，而不是空手返回", async () => {
    await seedFoldered("读书清单", "reading-list")

    const prompts = capturePrompts(() => deepseekStream("你的分类是这样的"))
    const events = await readEvents(
      await chat({
        messages: [{ role: "user", content: "我的收藏都是怎么分类的？" }],
      }),
    )

    expect(events.some((e) => e.type === "empty")).toBe(false)
    expect(events.some((e) => e.type === "delta")).toBe(true)
    expect(prompts.at(-1) ?? "").toContain("<收藏库分类>")
  })

  it("与分类无关又检索无命中时仍然不消耗生成额度", async () => {
    await seedFoldered("读书清单", "reading-list")
    const before = outbound.calls.length

    const events = await readEvents(
      await chat({ messages: [{ role: "user", content: "量子退火超导材料" }] }),
    )
    expect(events.map((e) => e.type)).toEqual(["meta", "empty"])
    expect(
      outbound.calls.slice(before).some((u) => u.startsWith(DEEPSEEK)),
    ).toBe(false)
  })
})

describe("list_folder_bookmarks 工具", () => {
  it("循环路径可按分类名列举收藏，结果进 sources_append", async () => {
    const { bookmarkId } = await seedFoldered("读书清单", "reading-list")

    queueDeepSeek([
      () => jsonResponse({ mode: "complex" }),
      () => jsonResponse({ steps: ["看分类内容", "评估归类"] }),
      () => toolCallStream("list_folder_bookmarks", '{"folder":"读书清单"}'),
      () => deepseekStream("这条归类合理 [#1]"),
    ])

    // 提问不点名分类：快路径捞不到它，工具列举出来的才是新来源
    const events = await readEvents(
      await chat({
        messages: [
          { role: "user", content: "逐条对比我的收藏，说明归类是否合理" },
        ],
      }),
    )

    const meta = events.find((e) => e.type === "meta")
    expect(meta?.type === "meta" && meta.sources).toEqual([])

    const appended = events.filter((e) => e.type === "sources_append")
    expect(
      appended.flatMap((e) => (e.type === "sources_append" ? e.sources : [])).map(
        (s) => s.id,
      ),
    ).toContain(bookmarkId)
    expect(
      events.some(
        (e) => e.type === "activity" && e.item.label === "list_folder_bookmarks",
      ),
    ).toBe(true)
  })

  it("模型照抄目录里的「父 / 子」整条路径也能解析到子分类", async () => {
    const parent = await client.post<{ id: string }>("/api/folders", {
      name: "读书清单",
      slug: "reading-list",
    })
    const child = await client.post<{ id: string }>("/api/folders", {
      name: "睡前读物",
      slug: "bedtime",
      parentId: parent.body.id,
    })
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "facebook/react",
      folderId: child.body.id,
    })

    queueDeepSeek([
      () => jsonResponse({ mode: "complex" }),
      () => jsonResponse({ steps: ["看子分类"] }),
      () =>
        toolCallStream(
          "list_folder_bookmarks",
          '{"folder":"读书清单 / 睡前读物"}',
        ),
      () => deepseekStream("子分类里有 1 条 [#1]"),
    ])

    const events = await readEvents(
      await chat({
        messages: [
          { role: "user", content: "逐条对比我的收藏，说明归类是否合理" },
        ],
      }),
    )

    expect(
      events
        .filter((e) => e.type === "sources_append")
        .flatMap((e) => (e.type === "sources_append" ? e.sources : []))
        .map((s) => s.id),
    ).toContain(created.body.id)
  })

  it("分类不存在与分类为空给出不同回执，都不算工具失败", async () => {
    await client.post("/api/folders", { name: "空夹子", slug: "empty-box" })
    const toolReplies: string[] = []
    let calls = 0
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as {
        messages: Array<{ role: string; content: string }>
      }
      for (const m of body.messages) {
        if (m.role === "tool") toolReplies.push(m.content)
      }
      calls++
      if (calls === 1) return jsonResponse({ mode: "complex" })
      if (calls === 2) return jsonResponse({ steps: ["查分类"] })
      if (calls === 3) {
        return toolCallStream("list_folder_bookmarks", '{"folder":"不存在的夹"}')
      }
      if (calls === 4) {
        return toolCallStream("list_folder_bookmarks", '{"folder":"空夹子"}')
      }
      return deepseekStream("两个分类都没有内容")
    })

    await readEvents(
      await chat({
        messages: [
          {
            role: "user",
            content: "分别看看不存在的夹和空夹子里的内容，逐条对比归类是否合理",
          },
        ],
      }),
    )

    expect(toolReplies.some((c) => c.includes("没有名为“不存在的夹”的分类"))).toBe(
      true,
    )
    expect(toolReplies.some((c) => c.includes("分类“空夹子”下没有收藏"))).toBe(true)
  })
})
