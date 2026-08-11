import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"
const EMBED_URL = "https://api.openai.com/v1/embeddings"

function unitVec(seed: number, dims = 8): number[] {
  const v = Array.from({ length: dims }, (_, i) =>
    Math.sin(seed * 10 + i) * 0.5 + 0.5,
  )
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

let client: TestClient
let outbound: OutboundMock

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  outbound.json(`${GITHUB}vercel/next.js`, githubRepoPayload("vercel/next.js"))
  outbound.on(EMBED_URL, async (req) => {
    const body = (await req.json()) as { input?: string }
    const input = String(body.input ?? "")
    // 语义簇：react / hooks → seed1；next / ssr → seed2；其它 → 远向量
    const seed = /hooks|components|react/i.test(input)
      ? 1
      : /next|ssr/i.test(input)
        ? 2
        : 99
    return new Response(
      JSON.stringify({
        data: [{ embedding: unitVec(seed), index: 0 }],
        model: "text-embedding-3-small",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  })
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

describe("Wave C: embedding hybrid search", () => {
  it("配置 embedding 后可测试连接，并在混合检索中命中", async () => {
    const put = await client.put<{ embedding_configured: boolean }>(
      "/api/settings/embedding",
      {
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
        apiKey: "sk-test-embedding-key",
      },
    )
    expect(put.status).toBe(200)
    expect(put.body.embedding_configured).toBe(true)

    const test = await client.post<{ ok: boolean; dims?: number }>(
      "/api/settings/embedding/test",
    )
    expect(test.status).toBe(200)
    expect(test.body.ok).toBe(true)
    expect(test.body.dims).toBe(8)

    const a = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const b = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/vercel/next.js",
    })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)

    const list = await client.json<{ items: Array<{ id: string }> }>(
      "/api/bookmarks?q=react&searchMode=hybrid",
    )
    expect(list.status).toBe(200)
    expect(list.body.items.some((i) => i.id === a.body.id)).toBe(true)
  })

  it("未配置 embedding 时 hybrid 退化为 keyword", async () => {
    await client.post("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const list = await client.json<{ items: Array<{ id: string }> }>(
      "/api/bookmarks?q=facebook&searchMode=hybrid",
    )
    expect(list.status).toBe(200)
    expect(list.body.items.length).toBeGreaterThan(0)
  })

  it("纯语义查询：keyword 无命中时 hybrid 仍可命中", async () => {
    await client.put("/api/settings/embedding", {
      baseUrl: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
      apiKey: "sk-test-embedding-key",
    })

    const react = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    const next = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/vercel/next.js",
    })
    expect(react.status).toBe(201)
    expect(next.status).toBe(201)

    // 触发 notes 变更重嵌（waitUntil 由 TestClient 冲刷）
    await client.patch(`/api/bookmarks/${react.body.id}`, {
      notes: "react ui runtime",
    })
    await client.patch(`/api/bookmarks/${next.body.id}`, {
      notes: "next ssr framework",
    })

    const keyword = await client.json<{ items: Array<{ id: string }> }>(
      "/api/bookmarks?q=hooks&searchMode=keyword",
    )
    expect(keyword.status).toBe(200)
    expect(keyword.body.items).toHaveLength(0)

    const hybrid = await client.json<{ items: Array<{ id: string }> }>(
      "/api/bookmarks?q=hooks&searchMode=hybrid",
    )
    expect(hybrid.status).toBe(200)
    expect(hybrid.body.items.some((i) => i.id === react.body.id)).toBe(true)
  })
})
