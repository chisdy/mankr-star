import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"

let client: TestClient
let outbound: OutboundMock

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

describe("Wave B: API tokens + MCP", () => {
  it("创建 Token 后 Bearer 可搜索；read-only 禁止写收藏", async () => {
    const created = await client.post<{
      token: string
      id: string
    }>("/api/api-tokens", {
      name: "mcp",
      scopes: ["read"],
    })
    expect(created.status).toBe(201)
    expect(created.body.token.startsWith("msk_live_")).toBe(true)

    await client.post("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })

    const bearer = new TestClient()
    const listTools = await bearer.json<{
      result?: { tools?: Array<{ name: string }> }
    }>("/api/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${created.body.token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    })
    expect(listTools.status).toBe(200)
    expect(listTools.body.result?.tools?.some((t) => t.name === "search_bookmarks")).toBe(
      true,
    )

    const search = await bearer.json<{
      result?: { content?: Array<{ text: string }> }
    }>("/api/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${created.body.token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "search_bookmarks",
          arguments: { query: "react", limit: 5 },
        },
      }),
    })
    expect(search.status).toBe(200)
    const text = search.body.result?.content?.[0]?.text ?? ""
    expect(text).toContain("facebook")

    const write = await bearer.post<{ code?: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    // TestClient.post doesn't set Authorization — set via fetch
    const denied = await bearer.json<{ code?: string }>("/api/bookmarks", {
      method: "POST",
      headers: { Authorization: `Bearer ${created.body.token}` },
      body: JSON.stringify({ url: "https://github.com/vercel/next.js" }),
    })
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe("FORBIDDEN")
    void write
  })

  it("write scope 可通过 MCP update_bookmark", async () => {
    const tok = await client.post<{ token: string }>("/api/api-tokens", {
      name: "writer",
      scopes: ["read", "write"],
    })
    expect(tok.status).toBe(201)

    const bm = await client.post<{ id: string }>("/api/bookmarks", {
      url: "https://github.com/facebook/react",
    })
    expect(bm.status).toBe(201)

    const agent = new TestClient()
    const updated = await agent.json<{
      result?: { content?: Array<{ text: string }>; isError?: boolean }
    }>("/api/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok.body.token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "update_bookmark",
          arguments: { id: bm.body.id, notes: "from-mcp" },
        },
      }),
    })
    expect(updated.status).toBe(200)
    expect(updated.body.result?.isError).not.toBe(true)

    const detail = await client.json<{ notes: string | null }>(
      `/api/bookmarks/${bm.body.id}`,
    )
    expect(detail.body.notes).toBe("from-mcp")
  })

  it("read-only Bearer 禁止改 settings / clear-data", async () => {
    const created = await client.post<{ token: string }>("/api/api-tokens", {
      name: "readonly",
      scopes: ["read"],
    })
    expect(created.status).toBe(201)

    const agent = new TestClient()
    const deniedSettings = await agent.json<{ code?: string }>(
      "/api/settings/public-browsing",
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${created.body.token}` },
        body: JSON.stringify({ enabled: true }),
      },
    )
    expect(deniedSettings.status).toBe(403)
    expect(deniedSettings.body.code).toBe("FORBIDDEN")

    const deniedClear = await agent.json<{ code?: string }>(
      "/api/settings/clear-data",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${created.body.token}` },
        body: "{}",
      },
    )
    expect(deniedClear.status).toBe(403)
    expect(deniedClear.body.code).toBe("FORBIDDEN")
  })
})
