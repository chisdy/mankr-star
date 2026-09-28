import { env } from "cloudflare:test"
import {
  aiJobs,
  aiUsageLogs,
  bookmarks,
  browserImportItems,
  browserImportJobs,
  createDb,
  folders,
} from "@mankr/db"
import { and, eq, isNull } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { truncateBrowserFolderPath } from "../src/worker/lib/browser-folder-path"
import { resolveBrowserImportIdentity } from "../src/worker/lib/browser-import-identity"
import { probeBookmarkUrl } from "../src/worker/lib/browser-import-probe"
import { readBookmarkMatchRevision } from "../src/worker/lib/bookmark-match-revision"
import { truncateFolderPath } from "../src/worker/lib/deepseek"
import { parseNetscapeBookmarks } from "../src/features/import/parse-netscape-bookmarks"
import {
  TestClient,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const SAMPLE_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>书签栏</H3>
  <DL><p>
    <DT><A HREF="https://example.com/a" ICON="data:image/png;base64,aaaa">A</A>
    <DT><H3>子目录</H3>
    <DL><p>
      <DT><A HREF="https://example.com/b">B</A>
      <HR>
      <DT><A HREF="javascript:void(0)">JS</A>
      <DT><A HREF="chrome://bookmarks/">Chrome</A>
      <DT><A HREF="https://example.com/a#section">A again</A>
    </DL><p>
  </DL><p>
</DL>`

type JobBody = {
  job: {
    id: string
    status: string
    has_folders: boolean
    classified: boolean
    imported: number
    skipped: number
    summary: {
      ok: number
      dead: number
      duplicate: number
      invalid: number
      suggested_folders: { label: string; count: number }[]
    }
  }
}

async function upload(
  client: TestClient,
  items: { title: string; url: string; folderPath?: string[] }[]
) {
  const created = await client.post<JobBody>("/api/bookmarks/import/browser", {
    source: "html",
  })
  expect(created.status).toBe(201)
  const id = created.body.job.id
  const batched = await client.post(
    `/api/bookmarks/import/browser/jobs/${id}/batches`,
    {
      batchIndex: 0,
      items: items.map((item) => ({
        title: item.title,
        url: item.url,
        folderPath: item.folderPath ?? [],
      })),
    }
  )
  expect(batched.status).toBe(200)
  return id
}

async function scan(client: TestClient, id: string) {
  const started = await client.post<JobBody>(
    `/api/bookmarks/import/browser/jobs/${id}/scan`
  )
  expect(started.status).toBe(200)
  return client.json<JobBody>(`/api/bookmarks/import/browser/jobs/${id}`)
}

async function choose(
  client: TestClient,
  id: string,
  placement: string,
  deadPolicy: string
) {
  const res = await client.post<JobBody>(
    `/api/bookmarks/import/browser/jobs/${id}/choice`,
    { placement, dead_policy: deadPolicy }
  )
  expect(res.status).toBe(200)
  return client.json<JobBody>(`/api/bookmarks/import/browser/jobs/${id}`)
}

describe("netscape bookmark parser", () => {
  it("保留嵌套目录，丢掉非网页和同一文件里的重复地址", () => {
    const items = parseNetscapeBookmarks(SAMPLE_HTML)
    expect(items).toEqual([
      {
        title: "A",
        url: "https://example.com/a",
        folderPath: ["书签栏"],
      },
      {
        title: "B",
        url: "https://example.com/b",
        folderPath: ["书签栏", "子目录"],
      },
    ])
    expect(items.some((item) => item.url.includes("data:"))).toBe(false)
  })
})

describe("browser folder depth", () => {
  it("6 级原目录收成 5 级，单条 AI 截断仍是 3 级", () => {
    const names = ["L1", "L2", "L3", "L4", "L5", "L6"]
    expect(truncateBrowserFolderPath(names)).toEqual([
      "L1",
      "L2",
      "L3",
      "L4",
      "L5 / L6",
    ])
    expect(truncateFolderPath(names)).toEqual(["L1", "L2", "L3"])
  })
})

describe("browser import identity", () => {
  it("仓库用 github，普通 GitHub 页面退回网页，推文用帖子编号", () => {
    expect(resolveBrowserImportIdentity("javascript:alert(1)")).toBeNull()
    expect(
      resolveBrowserImportIdentity("https://github.com/acme/widgets")
    ).toMatchObject({
      sourceType: "github",
      externalId: "acme/widgets",
      canonicalUrl: "https://github.com/acme/widgets",
    })
    expect(
      resolveBrowserImportIdentity("https://github.com/features")
    ).toMatchObject({
      sourceType: "url",
      canonicalUrl: "https://github.com/features",
    })
    expect(
      resolveBrowserImportIdentity("https://x.com/alice/status/99")
    ).toMatchObject({
      sourceType: "twitter",
      externalId: "99",
    })
  })
})

describe("bookmark probe", () => {
  let outbound: OutboundMock

  beforeEach(() => {
    outbound = mockOutboundFetch()
  })

  afterEach(() => {
    outbound.restore()
  })

  it("404 记为失效，403 和超时记为无法确认", async () => {
    outbound.on(
      "https://dead.example/missing",
      () => new Response("no", { status: 404 })
    )
    outbound.on(
      "https://blocked.example/secret",
      () => new Response("no", { status: 403 })
    )
    outbound.on("https://slow.example/wait", () => {
      const error = new Error("timed out")
      error.name = "TimeoutError"
      throw error
    })

    await expect(
      probeBookmarkUrl("https://dead.example/missing")
    ).resolves.toEqual({
      linkStatus: "dead",
      httpStatus: 404,
    })
    await expect(
      probeBookmarkUrl("https://blocked.example/secret")
    ).resolves.toEqual({
      linkStatus: "unknown",
      httpStatus: 403,
    })
    await expect(
      probeBookmarkUrl("https://slow.example/wait")
    ).resolves.toEqual({
      linkStatus: "unknown",
      httpStatus: null,
    })
  })

  it("内网地址和跳进内网的重定向都直接拒绝", async () => {
    outbound.on(
      "http://public.example/start",
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/latest" },
        })
    )
    outbound.on("http://127.0.0.1", () => {
      throw new Error("followed private host")
    })
    outbound.on("http://169.254.169.254", () => {
      throw new Error("followed metadata host")
    })

    await expect(probeBookmarkUrl("http://127.0.0.1/secret")).resolves.toEqual({
      linkStatus: "invalid",
      httpStatus: null,
    })
    await expect(
      probeBookmarkUrl("http://169.254.169.254/latest")
    ).resolves.toEqual({
      linkStatus: "invalid",
      httpStatus: null,
    })
    await expect(
      probeBookmarkUrl("http://public.example/start")
    ).resolves.toEqual({
      linkStatus: "invalid",
      httpStatus: null,
    })
    expect(outbound.calls.some((url) => url.includes("127.0.0.1"))).toBe(false)
    expect(outbound.calls.some((url) => url.includes("169.254.169.254"))).toBe(
      false
    )
    expect(outbound.calls.some((url) => url.includes("public.example"))).toBe(
      true
    )
  })
})

describe("browser bookmark import job", () => {
  let client: TestClient
  let outbound: OutboundMock

  beforeEach(async () => {
    client = await registerOwner()
    outbound = mockOutboundFetch()
    outbound.text("https://example.com", "ok", 200)
    outbound.text("https://github.com", "ok", 200)
  })

  afterEach(() => {
    outbound.restore()
  })

  it("预置文件夹算已有目录，检查阶段不调用 AI", async () => {
    await client.put("/api/settings/deepseek", { apiKey: "sk-test-key" })
    outbound.on("https://api.deepseek.com", () => {
      throw new Error("should not classify before the user chooses")
    })

    const id = await upload(client, [
      { title: "A", url: "https://example.com/a", folderPath: ["书签栏"] },
    ])
    const job = await scan(client, id)
    expect(job.body.job.status).toBe("awaiting_choice")
    expect(job.body.job.has_folders).toBe(true)
    expect(job.body.job.classified).toBe(false)
    expect(outbound.calls.some((url) => url.includes("api.deepseek.com"))).toBe(
      false
    )
  })

  it("文件夹表为空且有密钥时，检查阶段就给出新文件夹", async () => {
    const db = createDb(env)
    await db.delete(folders)
    await client.put("/api/settings/deepseek", { apiKey: "sk-test-key" })
    outbound.on(
      "https://api.deepseek.com/chat/completions",
      async (request) => {
        const body = (await request.json()) as {
          messages: { content: string }[]
        }
        const text = body.messages.map((message) => message.content).join("\n")
        const marker = "书签："
        const items = JSON.parse(
          text.slice(text.lastIndexOf(marker) + marker.length)
        ) as { id: string }[]
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: items.map((item) => ({
                      id: item.id,
                      folder: ["阅读"],
                    })),
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
          }),
          { headers: { "content-type": "application/json" } }
        )
      }
    )

    const id = await upload(client, [
      { title: "Essay", url: "https://example.com/essay" },
    ])
    const job = await scan(client, id)
    expect(job.body.job.has_folders).toBe(false)
    expect(job.body.job.status).toBe("awaiting_choice")
    expect(job.body.job.classified).toBe(true)
    expect(job.body.job.summary.suggested_folders).toEqual([
      { label: "阅读", count: 1 },
    ])

    const usage = await db.select().from(aiUsageLogs)
    expect(usage.some((row) => row.kind === "classify")).toBe(true)

    const done = await choose(client, id, "ai_new", "skip")
    expect(done.body.job.status).toBe("completed")
    expect(done.body.job.imported).toBe(1)
    const created = await db
      .select()
      .from(folders)
      .where(eq(folders.name, "阅读"))
      .get()
    expect(created).toBeTruthy()
  })

  it("未收齐时不探测，等用户选择时也不写收藏", async () => {
    const db = createDb(env)
    const id = await upload(client, [
      { title: "A", url: "https://example.com/a" },
    ])
    const token = await db
      .select({ token: browserImportJobs.continueToken })
      .from(browserImportJobs)
      .where(eq(browserImportJobs.id, id))
      .get()

    await client.post(`/api/bookmarks/import/browser/jobs/${id}/continue`, {
      token: token?.token,
    })
    const pending = await db
      .select()
      .from(browserImportItems)
      .where(eq(browserImportItems.jobId, id))
    expect(pending.every((item) => item.linkStatus === "pending")).toBe(true)
    expect(pending.every((item) => item.canonicalUrl === null)).toBe(true)
    expect(outbound.calls.some((url) => url.includes("example.com"))).toBe(
      false
    )

    const { continueStaleBrowserImportJobs } =
      await import("../src/worker/lib/browser-import-job")
    expect(await continueStaleBrowserImportJobs(env)).toEqual({ resumed: 0 })

    const ready = await scan(client, id)
    expect(ready.body.job.status).toBe("awaiting_choice")
    const before = await db.select().from(bookmarks)
    await client.post(`/api/bookmarks/import/browser/jobs/${id}/continue`, {
      token: token?.token,
    })
    expect(await continueStaleBrowserImportJobs(env)).toEqual({ resumed: 0 })
    const after = await db.select().from(bookmarks)
    expect(after).toHaveLength(before.length)
    const still = await client.json<JobBody>(
      `/api/bookmarks/import/browser/jobs/${id}`
    )
    expect(still.body.job.status).toBe("awaiting_choice")
  })

  it("按原目录写入，6 级并进第 5 级，匹配版本只加 1", async () => {
    const db = createDb(env)
    const before = await readBookmarkMatchRevision(db)
    const id = await upload(client, [
      {
        title: "Deep",
        url: "https://example.com/deep",
        folderPath: ["L1", "L2", "L3", "L4", "L5", "L6"],
      },
    ])
    await scan(client, id)
    const done = await choose(client, id, "original", "skip")
    expect(done.body.job.status).toBe("completed")
    expect(done.body.job.imported).toBe(1)
    expect(await readBookmarkMatchRevision(db)).toBe(before + 1)

    const saved = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.canonicalUrl, "https://example.com/deep"))
      .get()
    expect(saved).toMatchObject({
      aiStatus: "fallback",
      trackUpdates: false,
      syncStatus: "never",
      title: "Deep",
    })
    const jobs = await db.select().from(aiJobs)
    expect(jobs).toHaveLength(0)

    const deep = await db
      .select()
      .from(folders)
      .where(eq(folders.name, "L5 / L6"))
      .get()
    expect(deep?.depth).toBe(4)
    const leaf = await db
      .select()
      .from(folders)
      .where(eq(folders.name, "L6"))
      .get()
    expect(leaf).toBeUndefined()

    const list = await client.json<{ items: { title: string }[] }>(
      "/api/bookmarks"
    )
    expect(list.body.items.some((item) => item.title === "Deep")).toBe(true)
  })

  it("软删除且来源相同的行恢复，未删除的另一来源则跳过", async () => {
    const db = createDb(env)
    const now = new Date().toISOString()
    await db.insert(bookmarks).values({
      id: "deleted-url",
      sourceType: "url",
      canonicalUrl: "https://example.com/a",
      externalId: "example.com/a",
      title: "Old",
      stars: 5,
      topicsJson: "[]",
      platformMetaJson: "{}",
      aiStatus: "done",
      trackUpdates: true,
      syncStatus: "ok",
      healthStatus: "unknown",
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(bookmarks).values({
      id: "live-url",
      sourceType: "url",
      canonicalUrl: "https://github.com/acme/widgets",
      externalId: "github.com/acme/widgets",
      title: "Already",
      topicsJson: "[]",
      platformMetaJson: "{}",
      aiStatus: "done",
      trackUpdates: false,
      syncStatus: "never",
      healthStatus: "unknown",
      createdAt: now,
      updatedAt: now,
    })

    const id = await upload(client, [
      { title: "Restored", url: "https://example.com/a" },
      { title: "Repo", url: "https://github.com/acme/widgets" },
    ])
    const ready = await scan(client, id)
    expect(ready.body.job.summary.duplicate).toBe(1)
    const done = await choose(client, id, "original", "skip")
    expect(done.body.job.imported).toBe(1)
    expect(done.body.job.skipped).toBe(1)

    const restored = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.id, "deleted-url"))
      .get()
    expect(restored).toMatchObject({
      title: "Restored",
      deletedAt: null,
      trackUpdates: false,
      aiStatus: "fallback",
      stars: 5,
      syncStatus: "never",
    })
    const live = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.id, "live-url"))
      .get()
    expect(live?.title).toBe("Already")
    expect(live?.sourceType).toBe("url")
    const githubRows = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.sourceType, "github"))
    expect(githubRows).toHaveLength(0)
    expect(await db.select().from(aiJobs)).toHaveLength(0)
  })

  it("来源不同的已删除行不挡住新来源，GitHub 条目不跟踪更新", async () => {
    const db = createDb(env)
    const now = new Date().toISOString()
    await db.insert(bookmarks).values({
      id: "deleted-page",
      sourceType: "url",
      canonicalUrl: "https://github.com/acme/widgets",
      externalId: "github.com/acme/widgets",
      title: "Old page",
      topicsJson: "[]",
      platformMetaJson: "{}",
      aiStatus: "done",
      trackUpdates: false,
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    })

    const id = await upload(client, [
      { title: "Widgets", url: "https://github.com/acme/widgets" },
    ])
    await scan(client, id)
    const done = await choose(client, id, "original", "skip")
    expect(done.body.job.imported).toBe(1)

    const rows = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.canonicalUrl, "https://github.com/acme/widgets"))
    expect(rows).toHaveLength(2)
    const repo = rows.find((row) => row.sourceType === "github")
    expect(repo).toMatchObject({
      title: "Widgets",
      trackUpdates: false,
      syncStatus: "never",
      aiStatus: "fallback",
      deletedAt: null,
    })
    const page = rows.find((row) => row.id === "deleted-page")
    expect(page?.deletedAt).toBe(now)
  })

  it("失效链接可以跳过，也可以标成已失效后导入", async () => {
    outbound.on(
      "https://gone.example/missing",
      () => new Response("no", { status: 404 })
    )
    const db = createDb(env)
    const before = await readBookmarkMatchRevision(db)
    const skipped = await upload(client, [
      { title: "Gone", url: "https://gone.example/missing" },
    ])
    const scanned = await scan(client, skipped)
    expect(scanned.body.job.summary.dead).toBe(1)
    const skippedJob = await choose(client, skipped, "original", "skip")
    expect(skippedJob.body.job.imported).toBe(0)
    expect(
      await db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.canonicalUrl, "https://gone.example/missing"))
        .get()
    ).toBeUndefined()
    expect(await readBookmarkMatchRevision(db)).toBe(before)

    const kept = await upload(client, [
      { title: "Gone", url: "https://gone.example/missing" },
    ])
    await scan(client, kept)
    const keptJob = await choose(client, kept, "original", "import")
    expect(keptJob.body.job.imported).toBe(1)
    const row = await db
      .select()
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.canonicalUrl, "https://gone.example/missing"),
          isNull(bookmarks.deletedAt)
        )
      )
      .get()
    expect(row).toMatchObject({
      healthStatus: "unavailable",
      aiStatus: "fallback",
      trackUpdates: false,
    })
    expect(await readBookmarkMatchRevision(db)).toBe(before + 1)
  })

  it("没有密钥时不能归入现有文件夹", async () => {
    const id = await upload(client, [
      { title: "A", url: "https://example.com/a" },
    ])
    await scan(client, id)
    const denied = await client.post(
      `/api/bookmarks/import/browser/jobs/${id}/choice`,
      { placement: "existing", dead_policy: "skip" }
    )
    expect(denied.status).toBe(400)
    expect(denied.body).toMatchObject({ code: "AI_UNAVAILABLE" })
  })
})
