import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { env } from "cloudflare:test"
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
const FAKE_KEY = "sk-test-deepseek-key-abcdef1234"

interface InsightsBody {
  range: string
  library: {
    total: number
    added_in_range: number
    folders: number
    tags: number
    ai_status: Record<string, number>
  }
  composition: {
    languages: Array<{ name: string; count: number }>
    health: Array<{ status: string; count: number }>
    folders: Array<{ name: string; count: number }>
  }
  ai: {
    calls: number
    ok: number
    error: number
    tokens: { prompt: number; completion: number; total: number }
    by_kind: Array<{ kind: string; calls: number }>
    estimated_cost_usd: number | null
  }
  tracking: {
    tracked: number
    untracked: number
    sync_issues: Record<string, number>
  }
}

let client: TestClient
let outbound: OutboundMock

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  outbound.text(`${GITHUB}facebook/react/readme`, "# React\nUI library")
  outbound.json(`${GITHUB}vuejs/core`, githubRepoPayload("vuejs/core", {
    language: "TypeScript",
  }))
  outbound.text(`${GITHUB}vuejs/core/readme`, "# Vue")
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

describe("GET /api/insights", () => {
  it("未登录返回 401", async () => {
    const guest = new TestClient()
    const res = await guest.json("/api/insights")
    expect(res.status).toBe(401)
  })

  it("空库返回零值快照与空 AI 用量", async () => {
    const { status, body } = await client.json<InsightsBody>("/api/insights")
    expect(status).toBe(200)
    expect(body.range).toBe("30d")
    expect(body.library.total).toBe(0)
    expect(body.library.added_in_range).toBe(0)
    expect(body.library.folders).toBeGreaterThan(0) // 预置文件夹
    expect(body.ai.calls).toBe(0)
    expect(body.ai.tokens.total).toBe(0)
    expect(body.ai.estimated_cost_usd).toBeNull()
  })

  it("聚合未软删收藏；range=all 统计全部新增", async () => {
    await client.post("/api/bookmarks", { url: "facebook/react" })
    await client.post("/api/bookmarks", { url: "vuejs/core" })

    const list = await client.json<{ items: Array<{ id: string }> }>(
      "/api/bookmarks",
    )
    expect(list.body.items.length).toBe(2)
    await client.delete(`/api/bookmarks/${list.body.items[0]!.id}`)

    const insight = await client.json<InsightsBody>("/api/insights?range=all")
    expect(insight.status).toBe(200)
    expect(insight.body.library.total).toBe(1)
    expect(insight.body.library.added_in_range).toBe(1)
    expect(
      insight.body.composition.languages.some((l) => l.name === "TypeScript"),
    ).toBe(true)
  })

  it("DeepSeek 成功分类后写入用量，测试连接也记入", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })
    outbound.json(DEEPSEEK, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "声明式 UI 库",
              folder_path: ["前端框架"],
              tags: ["react", "ui", "frontend"],
              use_cases: [],
              confidence: 0.88,
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
      },
    })

    await client.post("/api/bookmarks", { url: "facebook/react" })

    outbound.json(DEEPSEEK, {
      choices: [{ message: { content: "pong" } }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    })
    await client.post("/api/settings/deepseek/test")

    const { status, body } = await client.json<InsightsBody>(
      "/api/insights?range=all",
    )
    expect(status).toBe(200)
    expect(body.ai.calls).toBeGreaterThanOrEqual(2)
    expect(body.ai.ok).toBeGreaterThanOrEqual(2)
    expect(body.ai.tokens.total).toBeGreaterThanOrEqual(146)
    expect(body.ai.by_kind.some((k) => k.kind === "classify")).toBe(true)
    expect(body.ai.by_kind.some((k) => k.kind === "connection_test")).toBe(true)
    expect(body.library.ai_status.done).toBeGreaterThanOrEqual(1)
    expect(body.ai.estimated_cost_usd).not.toBeNull()
    expect(body.ai.estimated_cost_usd!).toBeGreaterThan(0)
  })

  it("DeepSeek 失败调用仍记 error 用量", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })
    outbound.json(DEEPSEEK, { error: "server error" }, 500)

    await client.post("/api/bookmarks", { url: "facebook/react" })

    const { body } = await client.json<InsightsBody>("/api/insights?range=all")
    expect(body.ai.calls).toBeGreaterThanOrEqual(1)
    expect(body.ai.error).toBeGreaterThanOrEqual(1)
    expect(body.library.ai_status.failed).toBeGreaterThanOrEqual(1)
  })

  it("非法 range 返回 400", async () => {
    const res = await client.json<{ code: string }>("/api/insights?range=1y")
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })
})

describe("clear-data 清空 ai_usage_logs", () => {
  it("清空后用量表为空", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })
    outbound.json(DEEPSEEK, {
      choices: [{ message: { content: "pong" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    await client.post("/api/settings/deepseek/test")

    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM ai_usage_logs",
    ).first<{ c: number }>()
    expect(Number(before?.c)).toBeGreaterThan(0)

    await client.post("/api/settings/clear-data")

    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM ai_usage_logs",
    ).first<{ c: number }>()
    expect(Number(after?.c)).toBe(0)

    // 重新登录验证 insights 仍可用
    const relogin = new TestClient()
    await relogin.post("/api/auth/login", {
      username: OWNER.username,
      password: OWNER.password,
    })
    const insight = await relogin.json<InsightsBody>("/api/insights")
    expect(insight.status).toBe(200)
    expect(insight.body.ai.calls).toBe(0)
  })
})
