import { env } from "cloudflare:test"
import {
  KB_CHAT_MAX_CONVERSATIONS,
  type KbConversationDetail,
  type KbConversationSummary,
  type KbStoredMessage,
} from "@mankr/shared"
import { beforeEach, describe, expect, it } from "vitest"
import { registerOwner, TestClient } from "./helpers"

let client: TestClient

beforeEach(async () => {
  client = await registerOwner()
})

function userMessage(content: string, id = crypto.randomUUID()): KbStoredMessage {
  return { id, role: "user", content }
}

function assistantMessage(
  content: string,
  extra: Partial<KbStoredMessage> = {},
): KbStoredMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    state: "done",
    ...extra,
  }
}

describe("会话存档 CRUD", () => {
  it("PUT 建会话、标题取首条提问、GET 能整份读回", async () => {
    const id = crypto.randomUUID()
    const messages = [
      userMessage("我收藏过哪些状态管理库？"),
      assistantMessage("你收藏了 zustand 与 jotai。"),
    ]

    const saved = await client.put<KbConversationSummary>(
      `/api/kb/conversations/${id}`,
      { messages },
    )
    expect(saved.status).toBe(200)
    expect(saved.body.title).toBe("我收藏过哪些状态管理库？")
    expect(saved.body.message_count).toBe(2)

    const detail = await client.json<KbConversationDetail>(
      `/api/kb/conversations/${id}`,
    )
    expect(detail.status).toBe(200)
    expect(detail.body.messages.map((m) => m.content)).toEqual([
      "我收藏过哪些状态管理库？",
      "你收藏了 zustand 与 jotai。",
    ])
  })

  it("sources / plan / activity 原样存回，重开能完整回放过程", async () => {
    const id = crypto.randomUUID()
    const assistant = assistantMessage("答案。", {
      sources: [
        {
          type: "bookmark",
          id: "bm-1",
          title: "zustand",
          url: "https://github.com/pmndrs/zustand",
          snippet: "轻量状态管理",
        },
        {
          type: "web",
          title: "对比",
          url: "https://example.com/a",
          snippet: "web 摘录",
        },
      ],
      warnings: ["ANYSEARCH_FAILED"],
      plan: [
        { id: "p1", title: "检索收藏", status: "completed" },
        { id: "p2", title: "汇总", status: "completed", detail: "按场景归类" },
      ],
      activity: [
        {
          id: "a1",
          type: "step",
          label: "检索收藏库",
          status: "complete",
          stage: "search_bookmarks",
          count: 3,
        },
        {
          id: "a2",
          type: "search",
          query: "zustand",
          results: [
            { id: "r1", title: "zustand", domain: "github.com", url: "https://github.com/pmndrs/zustand" },
          ],
          moreCount: 2,
        },
        { id: "a3", type: "tool", action: "search_bookmarks", target: "zustand" },
      ],
    })

    await client.put(`/api/kb/conversations/${id}`, {
      messages: [userMessage("问题"), assistant],
    })

    const detail = await client.json<KbConversationDetail>(
      `/api/kb/conversations/${id}`,
    )
    const restored = detail.body.messages[1]!
    expect(restored.sources).toEqual(assistant.sources)
    expect(restored.plan).toEqual(assistant.plan)
    expect(restored.activity).toEqual(assistant.activity)
    expect(restored.warnings).toEqual(["ANYSEARCH_FAILED"])
    expect(restored.state).toBe("done")
  })

  it("重复 PUT 整体覆盖：重试截掉的尾部消息不会残留", async () => {
    const id = crypto.randomUUID()
    const question = userMessage("问题")

    await client.put(`/api/kb/conversations/${id}`, {
      messages: [question, assistantMessage("第一次回答")],
    })
    // 重试：截到提问后重新生成
    await client.put(`/api/kb/conversations/${id}`, {
      messages: [question, assistantMessage("第二次回答")],
    })

    const detail = await client.json<KbConversationDetail>(
      `/api/kb/conversations/${id}`,
    )
    expect(detail.body.messages).toHaveLength(2)
    expect(detail.body.messages[1]!.content).toBe("第二次回答")
  })

  it("GET 带回摘要水位，客户端据此裁剪下一轮请求", async () => {
    const id = crypto.randomUUID()
    await client.put(`/api/kb/conversations/${id}`, {
      messages: [userMessage("问题"), assistantMessage("回答")],
    })

    const fresh = await client.json<KbConversationDetail>(
      `/api/kb/conversations/${id}`,
    )
    // 还没压缩过：没有水位，等价于「整份历史都要回传」
    expect(fresh.body.summary_covers_through_id).toBeNull()

    await env.DB.prepare(
      "UPDATE kb_conversations SET context_summary = ?, summary_covers_through_id = ? WHERE id = ?",
    )
      .bind("早期摘要", "m6", id)
      .run()

    const compressed = await client.json<KbConversationDetail>(
      `/api/kb/conversations/${id}`,
    )
    expect(compressed.body.summary_covers_through_id).toBe("m6")
  })

  it("存档响应回传当前水位，省掉客户端单独查一次", async () => {
    // 压缩跑在后台、流里通告不了，这条响应是客户端拿到水位的唯一通道
    const id = crypto.randomUUID()
    await client.put(`/api/kb/conversations/${id}`, {
      messages: [userMessage("问题"), assistantMessage("回答")],
    })
    await env.DB.prepare(
      "UPDATE kb_conversations SET context_summary = ?, summary_covers_through_id = ? WHERE id = ?",
    )
      .bind("早期摘要", "m6", id)
      .run()

    const saved = await client.json<KbConversationSummary>(
      `/api/kb/conversations/${id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          messages: [userMessage("问题"), assistantMessage("回答")],
        }),
      },
    )
    expect(saved.body.summary_covers_through_id).toBe("m6")
  })

  it("存档回写不会清掉摘要与水位", async () => {
    const id = crypto.randomUUID()
    await client.put(`/api/kb/conversations/${id}`, {
      messages: [userMessage("问题"), assistantMessage("回答")],
    })
    await env.DB.prepare(
      "UPDATE kb_conversations SET context_summary = ?, summary_covers_through_id = ? WHERE id = ?",
    )
      .bind("早期摘要", "m6", id)
      .run()

    // 每轮收尾都会整体回写一次存档；若它顺手 set 了摘要列，
    // 水位会被清空，下一轮就把已经压过的旧消息再压一遍。
    await client.put(`/api/kb/conversations/${id}`, {
      messages: [
        userMessage("问题"),
        assistantMessage("回答"),
        userMessage("追问"),
      ],
    })

    const row = await env.DB.prepare(
      "SELECT context_summary, summary_covers_through_id FROM kb_conversations WHERE id = ?",
    )
      .bind(id)
      .first<{ context_summary: string; summary_covers_through_id: string }>()
    expect(row?.context_summary).toBe("早期摘要")
    expect(row?.summary_covers_through_id).toBe("m6")
  })

  it("列表按最近更新排序并带消息数", async () => {
    const older = crypto.randomUUID()
    const newer = crypto.randomUUID()
    await client.put(`/api/kb/conversations/${older}`, {
      messages: [userMessage("旧的")],
    })
    await client.put(`/api/kb/conversations/${newer}`, {
      messages: [userMessage("新的"), assistantMessage("回答")],
    })

    const list = await client.json<{ items: KbConversationSummary[] }>(
      "/api/kb/conversations",
    )
    expect(list.body.items.map((i) => i.id)).toEqual([newer, older])
    expect(list.body.items[0]!.message_count).toBe(2)
  })

  it("删除会话连带删掉消息，再取返回 404", async () => {
    const id = crypto.randomUUID()
    await client.put(`/api/kb/conversations/${id}`, {
      messages: [userMessage("问题"), assistantMessage("回答")],
    })

    const removed = await client.delete(`/api/kb/conversations/${id}`)
    expect(removed.status).toBe(200)

    const detail = await client.json(`/api/kb/conversations/${id}`)
    expect(detail.status).toBe(404)

    const orphans = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM kb_messages WHERE conversation_id = ?",
    )
      .bind(id)
      .first<{ n: number }>()
    expect(orphans?.n).toBe(0)
  })

  it("清空全部会话", async () => {
    await client.put(`/api/kb/conversations/${crypto.randomUUID()}`, {
      messages: [userMessage("一")],
    })
    await client.put(`/api/kb/conversations/${crypto.randomUUID()}`, {
      messages: [userMessage("二")],
    })

    await client.delete("/api/kb/conversations")

    const list = await client.json<{ items: KbConversationSummary[] }>(
      "/api/kb/conversations",
    )
    expect(list.body.items).toEqual([])
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM kb_messages",
    ).first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it("超出保留上限时淘汰最久未更新的会话", async () => {
    const first = crypto.randomUUID()
    await client.put(`/api/kb/conversations/${first}`, {
      messages: [userMessage("最早的一条")],
    })
    // 时间戳精度只到毫秒，逐条写入可能同刻；显式改旧确保它是最久未更新的
    await env.DB.prepare(
      "UPDATE kb_conversations SET updated_at = ? WHERE id = ?",
    )
      .bind("2020-01-01T00:00:00.000Z", first)
      .run()

    for (let i = 0; i < KB_CHAT_MAX_CONVERSATIONS; i += 1) {
      await client.put(`/api/kb/conversations/${crypto.randomUUID()}`, {
        messages: [userMessage(`第 ${i} 条`)],
      })
    }

    const survived = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM kb_conversations",
    ).first<{ n: number }>()
    expect(survived?.n).toBe(KB_CHAT_MAX_CONVERSATIONS)

    const detail = await client.json(`/api/kb/conversations/${first}`)
    expect(detail.status).toBe(404)
    const orphans = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM kb_messages WHERE conversation_id = ?",
    )
      .bind(first)
      .first<{ n: number }>()
    expect(orphans?.n).toBe(0)
  })

  it("消息为空或形状不合法时拒绝写入", async () => {
    const id = crypto.randomUUID()
    const empty = await client.put(`/api/kb/conversations/${id}`, {
      messages: [],
    })
    expect(empty.status).toBe(400)

    const bad = await client.put(`/api/kb/conversations/${id}`, {
      messages: [{ id: "x", role: "system", content: "hi" }],
    })
    expect(bad.status).toBe(400)

    const duplicated = await client.put(`/api/kb/conversations/${id}`, {
      messages: [userMessage("一", "same"), userMessage("二", "same")],
    })
    expect(duplicated.status).toBe(400)
  })

  it("客户端消息 id 原样存回，不被服务端改写", async () => {
    const id = crypto.randomUUID()
    const messages = [userMessage("问题", "client-1"), assistantMessage("回答")]
    await client.put(`/api/kb/conversations/${id}`, { messages })

    const detail = await client.json<KbConversationDetail>(
      `/api/kb/conversations/${id}`,
    )
    expect(detail.body.messages.map((m) => m.id)).toEqual(
      messages.map((m) => m.id),
    )
  })

  it("未登录不能读写会话", async () => {
    const anon = new TestClient()
    const id = crypto.randomUUID()
    await client.put(`/api/kb/conversations/${id}`, {
      messages: [userMessage("私密提问")],
    })

    expect((await anon.json("/api/kb/conversations")).status).toBe(401)
    expect((await anon.json(`/api/kb/conversations/${id}`)).status).toBe(401)
    expect(
      (await anon.put(`/api/kb/conversations/${id}`, { messages: [] })).status,
    ).toBe(401)
    expect((await anon.delete(`/api/kb/conversations/${id}`)).status).toBe(401)
  })

  it("清空全部数据时会话一并清理", async () => {
    const id = crypto.randomUUID()
    await client.put(`/api/kb/conversations/${id}`, {
      messages: [userMessage("问题"), assistantMessage("回答")],
    })

    const cleared = await client.post("/api/settings/clear-data")
    expect(cleared.status).toBe(200)

    // clear-data 连带注销会话，只能直接查库
    const conversations = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM kb_conversations",
    ).first<{ n: number }>()
    const messages = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM kb_messages",
    ).first<{ n: number }>()
    expect(conversations?.n).toBe(0)
    expect(messages?.n).toBe(0)
  })
})
