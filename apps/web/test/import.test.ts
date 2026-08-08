import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB_STARRED = "https://api.github.com/user/starred"

interface ImportResponse {
  imported: number
  skipped: number
  next_page: number | null
  has_more: boolean
  pending_ai: number
  code?: string
  error?: string
}

let client: TestClient
let outbound: OutboundMock

function starredRepoPayload(fullName: string) {
  const [owner, repo] = fullName.split("/")
  return {
    full_name: fullName,
    name: repo,
    owner: { login: owner },
    description: `${repo} description`,
    language: "TypeScript",
    stargazers_count: 10,
    forks_count: 2,
    license: { spdx_id: "MIT" },
    homepage: null,
    default_branch: "main",
    topics: [],
    pushed_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-02T00:00:00Z",
    html_url: `https://github.com/${fullName}`,
    archived: false,
    disabled: false,
    size: 10,
  }
}

/** 构造一页 GitHub Stars 响应；hasMore 通过 Link 头的 rel="next" 表达 */
function starredPageResponse(fullNames: string[], hasMore: boolean) {
  return () =>
    new Response(JSON.stringify(fullNames.map(starredRepoPayload)), {
      headers: {
        "content-type": "application/json",
        ...(hasMore
          ? { link: '<https://api.github.com/user/starred?page=2>; rel="next"' }
          : {}),
      },
    })
}

beforeEach(async () => {
  outbound = mockOutboundFetch()
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

describe("POST /api/bookmarks/import/github", () => {
  it("未配置 GitHub PAT 时返回 400 PAT_REQUIRED", async () => {
    const res = await client.post<ImportResponse>(
      "/api/bookmarks/import/github",
    )
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("PAT_REQUIRED")
  })

  it("maxPages 用尽且仍有下一页时，next_page = startPage + maxPages", async () => {
    await client.put("/api/settings/github-pat", { pat: "ghp_import_test_0001" })

    outbound.on(`${GITHUB_STARRED}?page=1`, starredPageResponse(["acme/repo-a"], true))
    outbound.on(`${GITHUB_STARRED}?page=2`, starredPageResponse(["acme/repo-b"], true))

    const res = await client.post<ImportResponse>(
      "/api/bookmarks/import/github",
      { page: 1, perPage: 10, maxPages: 2 },
    )

    expect(res.status).toBe(200)
    expect(res.body.imported).toBe(2)
    expect(res.body.skipped).toBe(0)
    // 起始页 1 + maxPages 2 = 3，绝不是 maxPages+1 的二次累加
    expect(res.body.next_page).toBe(3)
    expect(res.body.has_more).toBe(true)
  })

  it("最后一页 hasMore=false 时 next_page 为 null 且 has_more 为 false", async () => {
    await client.put("/api/settings/github-pat", { pat: "ghp_import_test_0002" })

    outbound.on(GITHUB_STARRED, starredPageResponse(["acme/repo-c"], false))

    const res = await client.post<ImportResponse>(
      "/api/bookmarks/import/github",
      { page: 1, perPage: 10, maxPages: 3 },
    )

    expect(res.status).toBe(200)
    expect(res.body.imported).toBe(1)
    expect(res.body.next_page).toBeNull()
    expect(res.body.has_more).toBe(false)
  })

  it("已存在的仓库跳过而不重复导入", async () => {
    await client.put("/api/settings/github-pat", { pat: "ghp_import_test_0003" })
    outbound.on(GITHUB_STARRED, starredPageResponse(["acme/repo-d"], false))

    const first = await client.post<ImportResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(first.body.imported).toBe(1)

    const second = await client.post<ImportResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(second.body.imported).toBe(0)
    expect(second.body.skipped).toBe(1)
  })

  it("软删除后重新导入会复活而非撞唯一索引 500", async () => {
    await client.put("/api/settings/github-pat", { pat: "ghp_import_test_0004" })
    outbound.on(GITHUB_STARRED, starredPageResponse(["acme/repo-soft"], false))

    const first = await client.post<ImportResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(first.status).toBe(200)
    expect(first.body.imported).toBe(1)

    const list = await client.json<{ items: Array<{ id: string }> }>(
      "/api/bookmarks?sourceType=github&q=acme/repo-soft",
    )
    const id = list.body.items[0]?.id
    expect(id).toBeTruthy()
    const deleted = await client.delete<{ ok: boolean }>(`/api/bookmarks/${id}`)
    expect(deleted.status).toBe(200)

    const revived = await client.post<ImportResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(revived.status).toBe(200)
    expect(revived.body.imported).toBe(1)
    expect(revived.body.skipped).toBe(0)

    const after = await client.json<{
      items: Array<{ id: string; external_id: string }>
      total: number
    }>("/api/bookmarks?sourceType=github&q=acme/repo-soft")
    expect(after.body.total).toBe(1)
    expect(after.body.items[0]?.id).toBe(id)
    expect(after.body.items[0]?.external_id).toBe("acme/repo-soft")
  })
})
