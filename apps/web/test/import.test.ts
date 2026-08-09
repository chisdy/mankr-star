import { env } from "cloudflare:test"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB_STARRED = "https://api.github.com/user/starred"

interface ImportJob {
  id: string
  status: string
  phase: string
  total: number
  processed: number
  imported: number
  skipped: number
  failed_count: number
  current_title: string | null
}

interface ImportStartResponse {
  job: ImportJob
  code?: string
  error?: string
}

interface ActiveResponse {
  job: ImportJob | null
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
    topics: ["cli", "tools"],
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

function mockReadme() {
  outbound.on(
    "https://api.github.com/repos/",
    () =>
      new Response("# Hello\n\nA tool for developers.", {
        headers: { "content-type": "text/plain" },
      }),
  )
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
    const res = await client.post<ImportStartResponse>(
      "/api/bookmarks/import/github",
    )
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("PAT_REQUIRED")
  })

  it("启动任务返回 202 job，并在 waitUntil 后完成逐条 AI 归类", async () => {
    await client.put("/api/settings/github-pat", { pat: "ghp_import_test_0001" })
    outbound.on(GITHUB_STARRED, starredPageResponse(["acme/repo-a"], false))
    mockReadme()

    const res = await client.post<ImportStartResponse>(
      "/api/bookmarks/import/github",
      { page: 1, perPage: 10, maxPages: 1 },
    )

    expect(res.status).toBe(202)
    expect(res.body.job?.id).toBeTruthy()
    expect(["queued", "running", "completed"]).toContain(res.body.job.status)

    const active = await client.json<ActiveResponse>(
      "/api/bookmarks/import/github/active",
    )
    expect(active.status).toBe(200)
    expect(active.body.job?.status).toBe("completed")
    expect(active.body.job?.imported).toBe(1)
    expect(active.body.job?.total).toBe(1)
    expect(active.body.job?.processed).toBe(1)

    const list = await client.json<{
      items: Array<{
        external_id: string
        folder: { name: string } | null
        tags: string[]
        summary_ai: string | null
        ai_status: string
      }>
    }>("/api/bookmarks?sourceType=github&q=acme/repo-a")
    expect(list.body.items).toHaveLength(1)
    const item = list.body.items[0]!
    expect(item.external_id).toBe("acme/repo-a")
    expect(item.ai_status === "done" || item.ai_status === "fallback").toBe(
      true,
    )
    expect(item.summary_ai).toBeTruthy()
    expect(item.tags.length).toBeGreaterThan(0)
  })

  it("进行中再次启动返回 409 IMPORT_IN_PROGRESS", async () => {
    await client.put("/api/settings/github-pat", { pat: "ghp_import_test_409" })
    const now = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO github_import_jobs (
        id, status, phase, total, processed, imported, skipped, failed_count,
        cursor, queue_json, page, per_page, max_pages, continue_token,
        created_at, updated_at
      ) VALUES (?, 'running', 'process', 1, 0, 0, 0, 0, 0, '[]', 1, 30, 1, ?, ?, ?)`,
    )
      .bind("job-active-409", "token-409", now, now)
      .run()

    const second = await client.post<ImportStartResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(second.status).toBe(409)
    expect(second.body.code).toBe("IMPORT_IN_PROGRESS")
    expect(second.body.job?.id).toBe("job-active-409")
  })

  it("已存在的仓库跳过而不重复导入", async () => {
    await client.put("/api/settings/github-pat", { pat: "ghp_import_test_0003" })
    outbound.on(GITHUB_STARRED, starredPageResponse(["acme/repo-d"], false))
    mockReadme()

    const first = await client.post<ImportStartResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(first.status).toBe(202)

    const second = await client.post<ImportStartResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(second.status).toBe(202)

    const active = await client.json<ActiveResponse>(
      "/api/bookmarks/import/github/active",
    )
    expect(active.body.job?.skipped).toBe(1)
    expect(active.body.job?.imported).toBe(0)
  })

  it("软删除后重新导入会复活并清 folder/tags，再跑 AI", async () => {
    await client.put("/api/settings/github-pat", { pat: "ghp_import_test_0004" })
    outbound.on(GITHUB_STARRED, starredPageResponse(["acme/repo-soft"], false))
    mockReadme()

    const first = await client.post<ImportStartResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(first.status).toBe(202)

    const list = await client.json<{
      items: Array<{ id: string; folder: { id: string } | null; tags: string[] }>
    }>("/api/bookmarks?sourceType=github&q=acme/repo-soft")
    const id = list.body.items[0]?.id
    expect(id).toBeTruthy()
    expect(list.body.items[0]?.tags.length).toBeGreaterThan(0)

    const deleted = await client.delete<{ ok: boolean }>(`/api/bookmarks/${id}`)
    expect(deleted.status).toBe(200)

    const revived = await client.post<ImportStartResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(revived.status).toBe(202)

    const after = await client.json<{
      items: Array<{
        id: string
        external_id: string
        tags: string[]
        folder: { name: string } | null
        summary_ai: string | null
      }>
      total: number
    }>("/api/bookmarks?sourceType=github&q=acme/repo-soft")
    expect(after.body.total).toBe(1)
    expect(after.body.items[0]?.id).toBe(id)
    expect(after.body.items[0]?.external_id).toBe("acme/repo-soft")
    expect(after.body.items[0]?.summary_ai).toBeTruthy()
    expect(after.body.items[0]?.tags.length).toBeGreaterThan(0)
  })

  it("预算用尽时保持 lease，continue 端点可续跑完成", async () => {
    await client.put("/api/settings/github-pat", { pat: "ghp_import_test_budget" })
    outbound.on(
      GITHUB_STARRED,
      starredPageResponse(["acme/one", "acme/two"], false),
    )
    mockReadme()

    const { createDb } = await import("@mankr/db")
    const { githubImportJobs } = await import("@mankr/db")
    const { eq } = await import("drizzle-orm")
    const { processGithubImportJobSlice } = await import(
      "../src/worker/lib/github-import-job"
    )
    const { env } = await import("cloudflare:test")

    const start = await client.post<ImportStartResponse>(
      "/api/bookmarks/import/github",
      { page: 1, maxPages: 1 },
    )
    expect(start.status).toBe(202)
    // 上一轮 waitUntil 可能已跑完；为测续跑，重置为 process 中途状态
    const jobId = start.body.job.id
    const db = createDb(env)
    const queue = [
      {
        owner: "acme",
        repo: "one",
        fullName: "acme/one",
        description: "one",
        language: "TypeScript",
        stars: 1,
        forks: 0,
        htmlUrl: "https://github.com/acme/one",
        topics: ["cli"],
        pushedAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-02T00:00:00Z",
        license: "MIT",
        homepage: null,
        defaultBranch: "main",
        archived: false,
        disabled: false,
        size: 10,
      },
      {
        owner: "acme",
        repo: "two",
        fullName: "acme/two",
        description: "two",
        language: "TypeScript",
        stars: 2,
        forks: 0,
        htmlUrl: "https://github.com/acme/two",
        topics: ["cli"],
        pushedAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-02T00:00:00Z",
        license: "MIT",
        homepage: null,
        defaultBranch: "main",
        archived: false,
        disabled: false,
        size: 10,
      },
    ]
    const now = new Date().toISOString()
    await db
      .update(githubImportJobs)
      .set({
        status: "queued",
        phase: "process",
        queueJson: JSON.stringify(queue),
        total: 2,
        cursor: 0,
        processed: 0,
        imported: 0,
        skipped: 0,
        failedCount: 0,
        leaseUntil: null,
        finishedAt: null,
        updatedAt: now,
      })
      .where(eq(githubImportJobs.id, jobId))

    // 清掉可能已导入的书签，避免全部 skipped
    await env.DB.prepare("DELETE FROM bookmark_tags").run()
    await env.DB.prepare("DELETE FROM bookmarks").run()

    const outcome = await processGithubImportJobSlice(db, env, jobId, {
      budgetMs: 0,
    })
    expect(outcome).toBe("continue")

    const mid = await db
      .select()
      .from(githubImportJobs)
      .where(eq(githubImportJobs.id, jobId))
      .get()
    expect(mid?.leaseUntil).toBeTruthy()
    expect(mid?.processed).toBe(0)
    expect(mid?.status).toBe("running")

    const cont = await client.post<{ ok: boolean; job: ImportJob }>(
      `/api/bookmarks/import/github/jobs/${jobId}/continue`,
      { token: mid!.continueToken },
    )
    expect(cont.status).toBe(200)
    expect(cont.body.ok).toBe(true)

    const active = await client.json<ActiveResponse>(
      "/api/bookmarks/import/github/active",
    )
    expect(active.body.job?.status).toBe("completed")
    expect(active.body.job?.processed).toBe(2)
    expect(active.body.job?.imported).toBe(2)
  })
})
