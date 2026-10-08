import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { discoveryResponseSchema } from "@mankr/shared"
import { app } from "../src/worker/app"
import { runDiscoveryScheduled } from "../src/worker/cron/discovery"
import {
  validateDiscoveryConfig,
  executionConfig,
  moduleBudget,
  DISCOVERY_HARD_LIMITS,
} from "../src/worker/lib/discovery/config"
import { DISCOVERY_CONFIG } from "../src/worker/lib/discovery/channels"
import {
  DiscoveryRepository,
  readDiscovery,
  type DiscoveryJob,
  type DiscoveryLease,
} from "../src/worker/lib/discovery/repository"
import type {
  DiscoveryCandidate,
  DiscoveryConfig,
} from "../src/worker/lib/discovery/types"
import { registerOwner, TestClient } from "./helpers"

const NOW = new Date("2026-10-08T00:05:00Z")
function candidate(
  id: number | null = 42,
  url = "https://github.com/acme/model",
  source: "github" | "hn" = "github",
  stars = 100,
  observedAt = NOW.toISOString()
): DiscoveryCandidate {
  return {
    externalId: id !== null ? String(id) : "10",
    source,
    sourceId: source,
    title: source === "github" ? "acme/model" : "AI model release",
    summary: "An AI model",
    url,
    canonicalUrl: url,
    bookmarkSourceType: url.startsWith("https://github.com/")
      ? "github"
      : "url",
    githubRepoId: id,
    channels: ["ai"],
    observedAt,
    publishedAt: observedAt,
    evidence:
      source === "github"
        ? {
            source,
            sourceId: source,
            url,
            observedAt,
            publishedAt: observedAt,
            stars,
            growth: null,
            previousObservedAt: null,
          }
        : {
            source,
            sourceId: source,
            url: "https://news.ycombinator.com/item?id=10",
            observedAt,
            publishedAt: observedAt,
            score: 5,
            comments: 2,
            position: 0,
          },
  }
}
async function init(now = NOW, day = "2026-10-08", clock = () => now) {
  const repo = new DiscoveryRepository(env.DB, clock, 200),
    module = (await repo.acquireModule(day))!
  await repo.ensureDailyJobs(
    day,
    DISCOVERY_CONFIG,
    DISCOVERY_CONFIG.ruleVersion,
    [
      { key: "github:ai", kind: "github" },
      { key: "hn", kind: "hn" },
      { key: "publish:ai", kind: "publish" },
    ],
    module
  )
  const jobs = await repo.jobs(day)
  return {
    repo,
    module,
    jobs,
    source: jobs.find((j) => j.partition_key === "github:ai")!,
  }
}
async function claim(
  repo: DiscoveryRepository,
  job: DiscoveryJob,
  module: DiscoveryLease
) {
  return (await repo.claim(job, module))!
}
async function apiRequest(path: string, cookie = "") {
  const ctx = createExecutionContext()
  const response = await app.request(
    path,
    { headers: { Cookie: cookie, "cf-connecting-ip": "10.20.30.40" } },
    { ...env, DISCOVERY_ENABLED: "true" },
    ctx
  )
  await waitOnExecutionContext(ctx)
  return response
}
afterEach(() => vi.restoreAllMocks())

describe("discovery persistence and read isolation", () => {
  it("applies the five-table migration and does not read a draft edition", async () => {
    const { repo, module, jobs } = await init()
    const publish = jobs.find((j) => j.kind === "publish")!
    await env.DB.prepare(
      "INSERT INTO discovery_editions(id,edition_day,channel_id,revision,rule_version,sources_json,source_job_ids_json,publish_job_id,lease_token) VALUES('draft','2026-10-08','ai',1,'v','[]','[]',?,'expired')"
    )
      .bind(publish.id)
      .run()
    const read = await readDiscovery(env.DB, true, "ai", false)
    expect(read.edition).toBeNull()
    expect(read.items).toEqual([])
    expect((await repo.jobs("2026-10-08")).length).toBe(3)
    await repo.releaseModule(module)
  })
  it("starts the same day and partition from an empty test database", async () => {
    const { repo, module } = await init()
    expect(
      await repo.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM discovery_editions"
      )
    ).toEqual({ count: 0 })
    await repo.releaseModule(module)
  })
  it("fences observations, pool and terminal writes and preserves successful snapshots", async () => {
    let now = NOW
    const { repo, module, source } = await init(now, "2026-10-08", () => now)
    const old = await claim(repo, source, module)
    now = new Date(NOW.getTime() + 121000)
    const nextModule = (await repo.acquireModule("2026-10-08"))!
    const next = await claim(repo, source, nextModule)
    await expect(
      repo.persistCandidates(source, old, [candidate()])
    ).rejects.toThrow("LEASE_LOST")
    await expect(
      repo.checkpoint(old, { pool: [{ githubRepoId: 42 }], state: "succeeded" })
    ).rejects.toThrow("LEASE_LOST")
    expect(
      await repo.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM discovery_items"
      )
    ).toEqual({ count: 0 })
    await repo.persistCandidates(source, next, [candidate()])
    await repo.checkpoint(next, {
      state: "succeeded",
      pool: [{ githubRepoId: 42 }],
      cursor: { persisted: 1 },
    })
    await expect(
      repo.persistCandidates(source, next, [
        candidate(42, undefined, undefined, 999),
      ])
    ).rejects.toThrow("LEASE_LOST")
    const observations = await repo.all<{ candidate_json: string }>(
      "SELECT candidate_json FROM discovery_observations"
    )
    expect(JSON.parse(observations[0]!.candidate_json).evidence.stars).toBe(100)
  })
  it("keeps numeric identity on rename, merges a generic article and leaves published fields unchanged", async () => {
    const first = await init()
    const lease = await claim(first.repo, first.source, first.module)
    await first.repo.persistCandidates(first.source, lease, [candidate()])
    await first.repo.checkpoint(lease, {
      state: "succeeded",
      cursor: { persisted: 1 },
    })
    const hn = first.jobs.find((j) => j.kind === "hn")!,
      hnLease = await claim(first.repo, hn, first.module)
    await first.repo.persistCandidates(hn, hnLease, [
      candidate(null, "https://github.com/acme/new-model", "hn"),
    ])
    await first.repo.checkpoint(hnLease, {
      state: "succeeded",
      cursor: { persisted: 1 },
    })
    const generic = (await first.repo.first<{ id: string }>(
      "SELECT id FROM discovery_items WHERE github_repo_id IS NULL"
    ))!
    const publish = first.jobs.find((j) => j.kind === "publish")!,
      publishLease = await claim(first.repo, publish, first.module)
    await first.repo.publish(
      publish,
      publishLease,
      "ai",
      [
        {
          id: generic.id,
          title: "old frozen title",
          summary: null,
          url: "https://github.com/acme/new-model",
          sourceType: "github",
          rank: 1,
          publishedAt: null,
          evidence: [
            candidate(null, "https://github.com/acme/new-model", "hn").evidence,
          ],
        },
      ],
      [],
      [hn]
    )
    await first.repo.checkpoint(publishLease, { state: "succeeded" })
    await first.repo.releaseModule(first.module)
    const later = new Date(NOW.getTime() + 86400000),
      second = await init(later, "2026-10-09")
    const next = await claim(second.repo, second.source, second.module)
    await second.repo.persistCandidates(second.source, next, [
      candidate(
        42,
        "https://github.com/acme/new-model",
        "github",
        110,
        later.toISOString()
      ),
    ])
    const items = await second.repo.all<{
      id: string
      canonical_url: string | null
      merged_into_id: string | null
      aliases_json: string
    }>("SELECT * FROM discovery_items")
    const winner = items.find((i) => i.id === "gh:42")!
    expect(winner.canonical_url).toBe("https://github.com/acme/new-model")
    expect(JSON.parse(winner.aliases_json)).toContain(
      "https://github.com/acme/model"
    )
    expect(items.find((i) => i.id === generic.id)?.merged_into_id).toBe(
      winner.id
    )
    const old = await readDiscovery(env.DB, true, "ai", false)
    expect(old.items[0]?.title).toBe("old frozen title")
    const observation = await second.repo.first<{ candidate_json: string }>(
      "SELECT candidate_json FROM discovery_observations WHERE job_id=?",
      [second.source.id]
    )
    expect(JSON.parse(observation!.candidate_json).evidence.growth).toBe(10)
  })
  it("distinguishes absent baseline, actual zero and negative growth", async () => {
    const first = await init(),
      lease = await claim(first.repo, first.source, first.module)
    await first.repo.persistCandidates(first.source, lease, [
      candidate(1, "https://github.com/a/one"),
      candidate(2, "https://github.com/a/two"),
    ])
    await first.repo.checkpoint(lease, { state: "succeeded" })
    await first.repo.releaseModule(first.module)
    const later = new Date(NOW.getTime() + 86400000),
      second = await init(later, "2026-10-09"),
      next = await claim(second.repo, second.source, second.module)
    await second.repo.persistCandidates(second.source, next, [
      candidate(
        1,
        "https://github.com/a/one",
        "github",
        100,
        later.toISOString()
      ),
      candidate(
        2,
        "https://github.com/a/two",
        "github",
        90,
        later.toISOString()
      ),
      candidate(
        3,
        "https://github.com/a/three",
        "github",
        999,
        later.toISOString()
      ),
    ])
    const observations = await second.repo.all<{
      external_id: string
      candidate_json: string
    }>("SELECT * FROM discovery_observations WHERE job_id=?", [
      second.source.id,
    ])
    const growth = new Map(
      observations.map((o) => [
        o.external_id,
        JSON.parse(o.candidate_json).evidence.growth,
      ])
    )
    expect([...growth.entries()]).toEqual([
      ["1", 0],
      ["2", -10],
      ["3", null],
    ])
  })
  it("skips a reused path owned by a different numeric GitHub ID without merging or altering old baselines", async () => {
    const first = await init(),
      sourceLease = await claim(first.repo, first.source, first.module)
    const original = candidate(42, "https://github.com/acme/original"),
      other = candidate(43, "https://github.com/acme/reused")
    await first.repo.persistCandidates(first.source, sourceLease, [
      original,
      other,
    ])
    await first.repo.checkpoint(sourceLease, { state: "succeeded" })
    const publish = first.jobs.find((job) => job.kind === "publish")!,
      publisher = await claim(first.repo, publish, first.module)
    await first.repo.publish(
      publish,
      publisher,
      "ai",
      [
        {
          id: "gh:42",
          title: "original frozen title",
          summary: original.summary,
          url: original.url,
          sourceType: "github",
          rank: 1,
          publishedAt: original.publishedAt,
          evidence: [original.evidence],
        },
      ],
      [],
      [first.source]
    )
    await first.repo.checkpoint(publisher, { state: "succeeded" })
    const baseline = await first.repo.all(
      "SELECT * FROM discovery_observations WHERE job_id=? ORDER BY external_id",
      [first.source.id]
    )
    const frozen = await first.repo.all("SELECT * FROM discovery_edition_items")
    await first.repo.releaseModule(first.module)
    const later = new Date(NOW.getTime() + 86400000),
      second = await init(later, "2026-10-09"),
      next = await claim(second.repo, second.source, second.module)
    expect(
      await second.repo.persistCandidates(second.source, next, [
        candidate(42, other.url, "github", 999, later.toISOString()),
      ])
    ).toEqual({ persisted: 0, conflicts: 1 })
    const identities = await second.repo.all<{
      github_repo_id: number
      canonical_url: string
      merged_into_id: string | null
    }>(
      "SELECT github_repo_id,canonical_url,merged_into_id FROM discovery_items ORDER BY github_repo_id"
    )
    expect(identities).toEqual([
      { github_repo_id: 42, canonical_url: original.url, merged_into_id: null },
      { github_repo_id: 43, canonical_url: other.url, merged_into_id: null },
    ])
    expect(
      await second.repo.all(
        "SELECT * FROM discovery_observations WHERE job_id=? ORDER BY external_id",
        [first.source.id]
      )
    ).toEqual(baseline)
    expect(
      await second.repo.all("SELECT * FROM discovery_edition_items")
    ).toEqual(frozen)
    expect(
      await second.repo.first<number>(
        "SELECT COUNT(*) AS count FROM discovery_observations WHERE job_id=?",
        [second.source.id]
      )
    ).toEqual({ count: 0 })
    expect(
      (await readDiscovery(env.DB, true, "ai", false)).items[0]?.title
    ).toBe("original frozen title")
  })
  it("uses one bounded bookmark match, excludes deleted rows and omits guest saved state", async () => {
    const client = await registerOwner()
    const { repo, module, source, jobs } = await init(),
      lease = await claim(repo, source, module)
    await repo.persistCandidates(source, lease, [candidate()])
    await repo.checkpoint(lease, { state: "succeeded" })
    const publish = jobs.find((j) => j.kind === "publish")!,
      publisher = await claim(repo, publish, module)
    await repo.publish(
      publish,
      publisher,
      "ai",
      [
        {
          id: "gh:42",
          title: "AI",
          summary: null,
          url: candidate().url,
          sourceType: "github",
          rank: 1,
          publishedAt: NOW.toISOString(),
          evidence: [candidate().evidence],
        },
      ],
      [],
      [source]
    )
    await repo.checkpoint(publisher, { state: "succeeded" })
    await env.DB.prepare(
      "INSERT INTO bookmarks(id,source_type,canonical_url,external_id,title,archived_at,ai_status) VALUES('saved','github',?,'acme/model','AI',?,'done')"
    )
      .bind(candidate().url, NOW.toISOString())
      .run()
    expect(
      (await readDiscovery(env.DB, true, "ai", true)).items[0]?.savedBookmarkId
    ).toBe("saved")
    expect(
      (await readDiscovery(env.DB, true, "ai", false)).items[0]
    ).not.toHaveProperty("savedBookmarkId")
    await env.DB.prepare("UPDATE bookmarks SET deleted_at=? WHERE id='saved'")
      .bind(NOW.toISOString())
      .run()
    expect(
      (await readDiscovery(env.DB, true, "ai", true)).items[0]?.savedBookmarkId
    ).toBeNull()
    const response = await apiRequest(
      "/api/discovery?channel=ai",
      client.cookieHeader
    )
    expect(response.status).toBe(200)
    expect(
      discoveryResponseSchema.safeParse(await response.json()).success
    ).toBe(true)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
})

describe("discovery budget and API gates", () => {
  it("atomically enforces the module lease and the actual-day hard reservation", async () => {
    const repo = new DiscoveryRepository(env.DB, () => NOW, 400)
    const module = (await repo.acquireModule("2026-10-08"))!
    expect(await repo.acquireModule("2026-10-08")).toBeNull()
    for (let count = 0; count < 64; count++)
      await repo.reserveRequests(module, 5)
    await expect(repo.reserveRequests(module, 1)).rejects.toThrow(
      "DAILY_REQUEST_BUDGET_OR_LEASE"
    )
    expect(
      await repo.first<{ request_count: number }>(
        "SELECT request_count FROM discovery_sync_jobs WHERE id=?",
        [module.moduleId]
      )
    ).toEqual({ request_count: 320 })
    const next = new DiscoveryRepository(
      env.DB,
      () => new Date("2026-10-08T16:05:00Z")
    )
    expect(await next.acquireModule("2026-10-09")).not.toBeNull()
  })
  it("counts every D1 batch member and rejects a round before statement 41", async () => {
    const repo = new DiscoveryRepository(env.DB, () => NOW, 40)
    await repo.batch(
      Array.from({ length: 40 }, () => ({ sql: "SELECT 1", values: [] }))
    )
    expect(repo.statements).toBe(40)
    await expect(repo.first("SELECT 1")).rejects.toThrow("D1_ROUND_BUDGET")
  })
  it("keeps disabled scheduling and all reads free of outbound fetches", async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(
      (
        await runDiscoveryScheduled(
          { ...env, DISCOVERY_ENABLED: "false" },
          { now: NOW, fetcher }
        )
      ).outcome
    ).toBe("disabled")
    const client = await registerOwner()
    expect(
      (await apiRequest("/api/discovery/channels", client.cookieHeader)).status
    ).toBe(200)
    expect(
      (await apiRequest("/api/discovery?q=llm", client.cookieHeader)).status
    ).toBe(400)
    expect(
      (await apiRequest("/api/discovery?channel=bogus", client.cookieHeader))
        .status
    ).toBe(200)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("requires login or existing public browsing, and provides no public write endpoint", async () => {
    const guest = new TestClient()
    expect((await apiRequest("/api/discovery")).status).toBe(401)
    const owner = await registerOwner()
    await owner.put("/api/settings/public-browsing", { enabled: true })
    const response = await apiRequest("/api/discovery")
    expect(response.status).toBe(200)
    const json = (await response.json()) as { items: unknown[] }
    expect(json.items).toEqual([])
    expect((await guest.post("/api/discovery/sync")).status).toBe(404)
  })
})

describe("discovery recovery and retention", () => {
  it("freezes all partitions with the first daily snapshot across rule deployments", async () => {
    const { repo, module, source } = await init()
    await repo.ensureDailyJobs(
      "2026-10-08",
      { ...DISCOVERY_CONFIG, ruleVersion: "new-rules" },
      "new-rules",
      [{ key: "rss:new-feed", kind: "rss" }],
      module
    )
    const jobs = await repo.jobs("2026-10-08")
    expect(jobs).toHaveLength(3)
    expect(
      jobs.every(
        (job) => job.config_snapshot_json === source.config_snapshot_json
      )
    ).toBe(true)
    expect(jobs.some((job) => job.partition_key === "rss:new-feed")).toBe(false)
  })
  it("blocks every expired publication write, then resumes without duplicating a committed edition", async () => {
    let now = NOW
    const { repo, module, source, jobs } = await init(
      NOW,
      "2026-10-08",
      () => now
    )
    const sourceLease = await claim(repo, source, module)
    await repo.persistCandidates(source, sourceLease, [candidate()])
    await repo.checkpoint(sourceLease, { state: "succeeded" })
    const publish = jobs.find((job) => job.kind === "publish")!,
      old = await claim(repo, publish, module)
    const items = [
      {
        id: "gh:42",
        title: "frozen AI model",
        summary: null,
        url: candidate().url,
        sourceType: "github" as const,
        rank: 1,
        publishedAt: NOW.toISOString(),
        evidence: [candidate().evidence],
      },
    ]
    now = new Date(NOW.getTime() + 121000)
    const nextModule = (await repo.acquireModule("2026-10-08"))!,
      next = await claim(repo, publish, nextModule)
    await expect(
      repo.publish(publish, old, "ai", items, [], [source])
    ).rejects.toThrow("LEASE_LOST")
    expect(
      await repo.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM discovery_editions"
      )
    ).toEqual({ count: 0 })
    await repo.publish(publish, next, "ai", items, [], [source])
    // Crash after atomic publication, before the job's terminal checkpoint.
    now = new Date(now.getTime() + 121000)
    const lastModule = (await repo.acquireModule("2026-10-08"))!,
      last = await claim(repo, publish, lastModule)
    await repo.publish(publish, last, "ai", items, [], [source])
    await repo.checkpoint(last, { state: "succeeded" })
    expect(
      await repo.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM discovery_editions WHERE state='published'"
      )
    ).toEqual({ count: 1 })
  })
  it("matches GitHub path case without changing ordinary article path identity", async () => {
    await registerOwner()
    const { repo, module, source, jobs } = await init(),
      lease = await claim(repo, source, module)
    const url = "https://github.com/reactjs/react"
    await repo.persistCandidates(source, lease, [candidate(43, url)])
    await repo.checkpoint(lease, { state: "succeeded" })
    const publisher = jobs.find((job) => job.kind === "publish")!,
      publishLease = await claim(repo, publisher, module)
    await repo.publish(
      publisher,
      publishLease,
      "ai",
      [
        {
          id: "gh:43",
          title: "React",
          summary: null,
          url,
          sourceType: "github",
          rank: 1,
          publishedAt: null,
          evidence: [candidate(43, url).evidence],
        },
      ],
      [],
      [source]
    )
    await repo.checkpoint(publishLease, { state: "succeeded" })
    await env.DB.prepare(
      "INSERT INTO bookmarks(id,source_type,canonical_url,external_id,title,ai_status) VALUES('upper','github','https://github.com/ReactJS/React','ReactJS/React','React','done')"
    ).run()
    expect(
      (await readDiscovery(env.DB, true, "ai", true)).items[0]?.savedBookmarkId
    ).toBe("upper")
    const plan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM bookmarks INDEXED BY bookmarks_github_case_url_idx WHERE source_type='github' AND deleted_at IS NULL AND lower(canonical_url) IN(SELECT lower(value) FROM json_each(?))"
    )
      .bind(JSON.stringify([url]))
      .all<{ detail: string }>()
    expect(
      plan.results.some((row) =>
        row.detail.includes("bookmarks_github_case_url_idx")
      )
    ).toBe(true)
  })
  it("cleans old unreferenced snapshots while preserving the latest fallback edition and its source", async () => {
    let now = new Date("2026-08-01T00:05:00Z")
    const first = await init(now, "2026-08-01", () => now),
      sourceLease = await claim(first.repo, first.source, first.module)
    await first.repo.persistCandidates(first.source, sourceLease, [
      candidate(42, undefined, "github", 100, now.toISOString()),
    ])
    await first.repo.checkpoint(sourceLease, { state: "succeeded" })
    const publish = first.jobs.find((job) => job.kind === "publish")!,
      publishLease = await claim(first.repo, publish, first.module)
    await first.repo.publish(
      publish,
      publishLease,
      "ai",
      [
        {
          id: "gh:42",
          title: "retained old edition",
          summary: null,
          url: candidate().url,
          sourceType: "github",
          rank: 1,
          publishedAt: now.toISOString(),
          evidence: [
            candidate(42, undefined, "github", 100, now.toISOString()).evidence,
          ],
        },
      ],
      [],
      [first.source]
    )
    await first.repo.checkpoint(publishLease, { state: "succeeded" })
    await first.repo.releaseModule(first.module)
    now = new Date("2026-08-02T00:05:00Z")
    const second = await init(now, "2026-08-02", () => now),
      secondLease = await claim(second.repo, second.source, second.module)
    await second.repo.persistCandidates(second.source, secondLease, [
      candidate(
        77,
        "https://github.com/acme/obsolete",
        "github",
        100,
        now.toISOString()
      ),
    ])
    await second.repo.checkpoint(secondLease, { state: "succeeded" })
    await second.repo.releaseModule(second.module)
    now = NOW
    const today = await init(now, "2026-10-08", () => now),
      todayLease = await claim(today.repo, today.source, today.module)
    await today.repo.checkpoint(todayLease, {
      state: "succeeded",
      cursor: { persisted: 0 },
    })
    await today.repo.cleanup(today.module)
    expect(
      await today.repo.first("SELECT id FROM discovery_items WHERE id='gh:77'")
    ).toBeNull()
    expect(
      await today.repo.first("SELECT id FROM discovery_items WHERE id='gh:42'")
    ).not.toBeNull()
    expect(
      await today.repo.first("SELECT id FROM discovery_sync_jobs WHERE id=?", [
        first.source.id,
      ])
    ).not.toBeNull()
    const fallback = await readDiscovery(env.DB, true, "ai", false)
    expect(fallback.edition?.day).toBe("2026-08-01")
    expect(fallback.items[0]?.title).toBe("retained old edition")
  })
})

function withConfig(
  budgets: Partial<DiscoveryConfig["budgets"]> = {}
): DiscoveryConfig {
  return {
    ...DISCOVERY_CONFIG,
    feeds: [],
    budgets: { ...DISCOVERY_CONFIG.budgets, ...budgets },
  }
}
function emptySources() {
  const calls: string[] = [],
    active = { count: 0, max: 0 }
  const fetcher: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    calls.push(url)
    active.count++
    active.max = Math.max(active.max, active.count)
    await Promise.resolve()
    active.count--
    if (url.includes("/search/repositories"))
      return Response.json({ items: [], incomplete_results: false })
    if (url.includes("/topstories.json") || url.includes("/beststories.json"))
      return Response.json([])
    throw new Error(`unexpected network ${url}`)
  }
  return { calls, active, fetcher }
}

describe("validated snapshots and frozen effective budgets", () => {
  const invalidSnapshots: [
    string,
    (config: Record<string, unknown>) => void,
  ][] = [
    [
      "missing classification",
      (config) => {
        delete config.classification
      },
    ],
    [
      "missing ranking",
      (config) => {
        delete config.ranking
      },
    ],
    [
      "invalid regex",
      (config) => {
        config.classification = {
          excludedTitlePattern: "[",
          rssTechnicalPattern: "ai",
        }
      },
    ],
    [
      "invalid ranking source",
      (config) => {
        config.ranking = { cycle: ["unknown"], growthSlots: 1, newSlots: 1 }
      },
    ],
    [
      "empty ranking cycle",
      (config) => {
        config.ranking = { cycle: [], growthSlots: 1, newSlots: 1 }
      },
    ],
    [
      "string request budget",
      (config) => {
        config.budgets = { ...DISCOVERY_CONFIG.budgets, requestsPerRound: "2" }
      },
    ],
    [
      "unexecutable D1 budget",
      (config) => {
        config.budgets = {
          ...DISCOVERY_CONFIG.budgets,
          d1StatementsPerRound: 15,
        }
      },
    ],
    [
      "duplicate fixed channel",
      (config) => {
        config.channels = [
          DISCOVERY_CONFIG.channels[0],
          ...DISCOVERY_CONFIG.channels.slice(0, 3),
        ]
      },
    ],
    [
      "invalid feed URL",
      (config) => {
        config.feeds = [{ ...DISCOVERY_CONFIG.feeds[0], url: "not a URL" }]
      },
    ],
    [
      "insecure feed URL",
      (config) => {
        config.feeds = [
          {
            ...DISCOVERY_CONFIG.feeds[0],
            url: DISCOVERY_CONFIG.feeds[0]!.url.replace("https:", "http:"),
          },
        ]
      },
    ],
    [
      "nondefault feed port",
      (config) => {
        const url = new URL(DISCOVERY_CONFIG.feeds[0]!.url)
        url.port = "8443"
        config.feeds = [{ ...DISCOVERY_CONFIG.feeds[0], url: url.href }]
      },
    ],
    [
      "serialized configuration over 64 KiB",
      (config) => {
        config.channels = DISCOVERY_CONFIG.channels.map((channel) => ({
          ...channel,
          keywords: Array.from({ length: 100 }, () => "技".repeat(120)),
        }))
      },
    ],
    [
      "feed URL beyond 2048 characters",
      (config) => {
        config.feeds = [
          {
            ...DISCOVERY_CONFIG.feeds[0],
            url: `${DISCOVERY_CONFIG.feeds[0]!.url}?${"a".repeat(2048)}`,
          },
        ]
      },
    ],
    [
      "feed URL with isolated surrogate",
      (config) => {
        config.feeds = [
          {
            ...DISCOVERY_CONFIG.feeds[0],
            url: `${DISCOVERY_CONFIG.feeds[0]!.url}?\ud800`,
          },
        ]
      },
    ],
    [
      "too many feeds",
      (config) => {
        config.feeds = Array.from({ length: 5 }, (_, index) => ({
          ...DISCOVERY_CONFIG.feeds[0],
          id: `feed-${index}`,
        }))
      },
    ],
    [
      "unknown schema version",
      (config) => {
        config.schemaVersion = 99
      },
    ],
  ]
  it.each(invalidSnapshots)(
    "terminates %s before task/dependency selection and preserves published history",
    async (_label, mutate) => {
      const { repo, module, source, jobs } = await init()
      const original = JSON.parse(source.config_snapshot_json) as Record<
        string,
        unknown
      >
      mutate(original)
      const malformed = JSON.stringify(original)
      await repo.run(
        "UPDATE discovery_sync_jobs SET config_snapshot_json=? WHERE id=?",
        [malformed, source.id]
      )
      const publish = jobs.find((job) => job.kind === "publish")!
      await repo.run(
        "INSERT INTO discovery_editions(id,edition_day,channel_id,revision,state,rule_version,sources_json,source_job_ids_json,publish_job_id,lease_token,published_at) VALUES('history','2026-10-07','ai',1,'published','previous','[]','[]',?,'previous',?)",
        [publish.id, NOW.toISOString()]
      )
      await repo.releaseModule(module)
      const upstream = emptySources()
      const result = await runDiscoveryScheduled(
        { ...env, DISCOVERY_ENABLED: "true" },
        { now: NOW, fetcher: upstream.fetcher }
      )
      expect(result.outcome).toBe("RULE_VERSION_UNSUPPORTED")
      expect(upstream.calls).toHaveLength(0)
      const failed = await env.DB.prepare(
        "SELECT state,error_code,config_snapshot_json FROM discovery_sync_jobs WHERE id=?"
      )
        .bind(source.id)
        .first<{
          state: string
          error_code: string
          config_snapshot_json: string
        }>()
      expect(failed).toEqual({
        state: "failed",
        error_code: "RULE_VERSION_UNSUPPORTED",
        config_snapshot_json: malformed,
      })
      expect((await readDiscovery(env.DB, true, "ai", false)).edition?.id).toBe(
        "history"
      )
    }
  )
  it("rejects unknown executor versions, including a publisher with corrupt dependencies config", async () => {
    const { repo, module, jobs } = await init()
    const publish = jobs.find((job) => job.kind === "publish")!
    await repo.run(
      "UPDATE discovery_sync_jobs SET execution_schema_version=99,config_snapshot_json='{}' WHERE id=?",
      [publish.id]
    )
    await repo.releaseModule(module)
    const upstream = emptySources(),
      result = await runDiscoveryScheduled(
        { ...env, DISCOVERY_ENABLED: "true" },
        { now: NOW, fetcher: upstream.fetcher }
      )
    expect(result.partition).toBe(publish.partition_key)
    expect(result.outcome).toBe("RULE_VERSION_UNSUPPORTED")
    expect(upstream.calls).toHaveLength(0)
  })
  it("clips a reservation to both remaining category and frozen actual-day quota without resetting it", async () => {
    const config = withConfig({ requestsPerDay: 7, githubSearchesPerDay: 3 })
    const repo = new DiscoveryRepository(env.DB, () => NOW, 100),
      module = (await repo.acquireModule("2026-10-08", moduleBudget(config)))!
    expect(
      await repo.reserveRequests(module, 5, "github-search", 999, 999)
    ).toBe(3)
    expect(await repo.reserveRequests(module, 5, "all", 999, 999)).toBe(4)
    await expect(
      repo.reserveRequests(module, 1, "all", 999, 999)
    ).rejects.toThrow("DAILY_REQUEST_BUDGET_OR_LEASE")
    await repo.releaseModule(module)
    const again = (await repo.acquireModule(
      "2026-10-08",
      moduleBudget(DISCOVERY_CONFIG)
    ))!
    expect(again.budgetSnapshot?.budgets.requestsPerDay).toBe(7)
    await expect(
      repo.reserveRequests(again, 1, "all", 999, 999)
    ).rejects.toThrow("DAILY_REQUEST_BUDGET_OR_LEASE")
    expect((await repo.moduleJob("2026-10-08"))?.request_count).toBe(7)
  })
  it("honors lower round/search/D1/concurrency limits after current configuration changes", async () => {
    const config = withConfig({
      requestsPerRound: 2,
      requestsPerDay: 5,
      githubSearchesPerRound: 1,
      githubSearchesPerDay: 3,
      githubDetailsPerDay: 2,
      d1StatementsPerRound: 20,
      concurrentRequests: 1,
      pieceSize: 1,
      hnCandidates: 2,
      rssEntries: 1,
      maxItems: 1,
    })
    const upstream = emptySources(),
      rounds = []
    for (let index = 0; index < 24; index++)
      rounds.push(
        await runDiscoveryScheduled(
          { ...env, DISCOVERY_ENABLED: "true" },
          {
            now: new Date(NOW.getTime() + index * 600000),
            config: index === 0 ? config : DISCOVERY_CONFIG,
            fetcher: upstream.fetcher,
          }
        )
      )
    expect(upstream.calls).toHaveLength(5)
    expect(
      upstream.calls.filter((url) => url.includes("/search/repositories"))
    ).toHaveLength(3)
    expect(upstream.active.max).toBe(1)
    expect(
      rounds.every((round) => round.requests <= 2 && round.statements <= 20)
    ).toBe(true)
    const budget = await env.DB.prepare(
      "SELECT * FROM discovery_sync_jobs WHERE partition_key='__budget__'"
    ).first<{ config_snapshot_json: string; request_count: number }>()
    expect(budget?.request_count).toBe(5)
    expect(
      JSON.parse(budget!.config_snapshot_json).budgets.requestsPerDay
    ).toBe(5)
  })
  it("splits the two HN lists across rounds when requestsPerRound is one", async () => {
    const config = withConfig({
        requestsPerRound: 1,
        githubSearchesPerRound: 1,
      }),
      repo = new DiscoveryRepository(env.DB, () => NOW, 100),
      module = (await repo.acquireModule("2026-10-08", moduleBudget(config)))!
    await repo.ensureDailyJobs(
      "2026-10-08",
      config,
      config.ruleVersion,
      [{ key: "hn", kind: "hn" }],
      module
    )
    await repo.releaseModule(module)
    const upstream = emptySources()
    const first = await runDiscoveryScheduled(
      { ...env, DISCOVERY_ENABLED: "true" },
      { now: NOW, config: DISCOVERY_CONFIG, fetcher: upstream.fetcher }
    )
    const second = await runDiscoveryScheduled(
      { ...env, DISCOVERY_ENABLED: "true" },
      {
        now: new Date(NOW.getTime() + 600000),
        config: DISCOVERY_CONFIG,
        fetcher: upstream.fetcher,
      }
    )
    expect(first.requests).toBe(1)
    expect(second.requests).toBe(1)
    expect(upstream.calls.map((url) => new URL(url).pathname)).toEqual([
      "/v0/topstories.json",
      "/v0/beststories.json",
    ])
    const job = await env.DB.prepare(
      "SELECT state,cursor_json FROM discovery_sync_jobs WHERE kind='hn'"
    ).first<{ state: string; cursor_json: string }>()
    expect(job?.state).toBe("succeeded")
    expect(JSON.parse(job!.cursor_json).lists).toHaveLength(2)
  })
  it("finishes empty sources and all editions at the executable minimum of 16 D1 statements", async () => {
    const config = withConfig({ d1StatementsPerRound: 16 }),
      upstream = emptySources(),
      rounds = []
    for (let index = 0; index < 30; index++)
      rounds.push(
        await runDiscoveryScheduled(
          { ...env, DISCOVERY_ENABLED: "true" },
          {
            now: new Date(NOW.getTime() + index * 600000),
            config,
            fetcher: upstream.fetcher,
          }
        )
      )
    expect(rounds.every((round) => round.statements <= 16)).toBe(true)
    expect(rounds.some((round) => round.outcome === "D1_ROUND_BUDGET")).toBe(
      false
    )
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM discovery_editions WHERE state='published'"
      ).first<number>("count")
    ).toBe(4)
    expect(
      await env.DB.prepare(
        "SELECT state FROM discovery_sync_jobs WHERE kind='cleanup'"
      ).first<string>("state")
    ).toBe("succeeded")
  })
  it("keeps old task limits and edition identity while counting midnight resumes against new frozen budget", async () => {
    const before = new Date("2026-10-08T15:55:00Z"),
      low = withConfig({
        requestsPerRound: 1,
        requestsPerDay: 100,
        githubSearchesPerRound: 1,
        d1StatementsPerRound: 20,
        concurrentRequests: 1,
        pieceSize: 1,
      })
    const repo = new DiscoveryRepository(env.DB, () => before, 100),
      module = (await repo.acquireModule("2026-10-08", moduleBudget(low)))!
    await repo.ensureDailyJobs(
      "2026-10-08",
      low,
      low.ruleVersion,
      [{ key: "github:ai", kind: "github" }],
      module
    )
    await repo.releaseModule(module)
    const nextDay = withConfig({
        requestsPerRound: 2,
        requestsPerDay: 2,
        githubSearchesPerRound: 2,
      }),
      upstream = emptySources()
    for (const [index, config] of [
      low,
      nextDay,
      DISCOVERY_CONFIG,
      DISCOVERY_CONFIG,
    ].entries()) {
      const round = await runDiscoveryScheduled(
        { ...env, DISCOVERY_ENABLED: "true" },
        {
          now: new Date(before.getTime() + index * 600000),
          config,
          fetcher: upstream.fetcher,
        }
      )
      expect(round.requests).toBeLessThanOrEqual(1)
      expect(round.statements).toBeLessThanOrEqual(20)
    }
    const budgets = await env.DB.prepare(
      "SELECT edition_day,request_count,config_snapshot_json FROM discovery_sync_jobs WHERE kind='budget' ORDER BY edition_day"
    ).all<{
      edition_day: string
      request_count: number
      config_snapshot_json: string
    }>()
    expect(
      budgets.results.map((row) => [row.edition_day, row.request_count])
    ).toEqual([
      ["2026-10-08", 1],
      ["2026-10-09", 2],
    ])
    expect(
      JSON.parse(budgets.results[1]!.config_snapshot_json).budgets
        .requestsPerDay
    ).toBe(2)
    const task = await env.DB.prepare(
      "SELECT edition_day,config_snapshot_json FROM discovery_sync_jobs WHERE kind='github'"
    ).first<{ edition_day: string; config_snapshot_json: string }>()
    expect(task?.edition_day).toBe("2026-10-08")
    expect(
      JSON.parse(task!.config_snapshot_json).budgets.requestsPerRound
    ).toBe(1)
  })
  it("uses the task ranking and item limit explicitly instead of changed current defaults", async () => {
    const config = {
      ...withConfig({ maxItems: 1 }),
      ranking: {
        cycle: ["hn", "github", "rss"] as const,
        growthSlots: 1,
        newSlots: 1,
      },
    } as unknown as DiscoveryConfig
    const repo = new DiscoveryRepository(env.DB, () => NOW, 100),
      module = (await repo.acquireModule("2026-10-08", moduleBudget(config)))!
    await repo.ensureDailyJobs(
      "2026-10-08",
      config,
      config.ruleVersion,
      [
        { key: "github:ai", kind: "github" },
        { key: "hn", kind: "hn" },
        { key: "publish:ai", kind: "publish" },
      ],
      module
    )
    const jobs = await repo.jobs("2026-10-08")
    for (const job of jobs.filter((job) => job.kind !== "publish")) {
      const lease = await claim(repo, job, module)
      await repo.persistCandidates(job, lease, [
        job.kind === "github"
          ? candidate()
          : candidate(null, "https://example.com/ai", "hn"),
      ])
      await repo.checkpoint(lease, {
        state: "succeeded",
        cursor: { persisted: 1 },
      })
    }
    await repo.releaseModule(module)
    const changed = {
      ...DISCOVERY_CONFIG,
      ranking: { cycle: ["github"] as const, growthSlots: 4, newSlots: 2 },
    } as unknown as DiscoveryConfig
    const round = await runDiscoveryScheduled(
      { ...env, DISCOVERY_ENABLED: "true" },
      { now: NOW, config: changed, fetcher: emptySources().fetcher }
    )
    expect(round.partition).toBe("publish:ai")
    const response = await readDiscovery(env.DB, true, "ai", false)
    expect(response.items).toHaveLength(1)
    expect(response.items[0]?.title).toBe("AI model release")
  })
  it("accepts larger configured values but never exceeds absolute safety ceilings", async () => {
    const larger = withConfig(
      Object.fromEntries(
        Object.keys(DISCOVERY_HARD_LIMITS).map((key) => [key, 2000])
      ) as DiscoveryConfig["budgets"]
    )
    larger.github = { ...larger.github, pageSize: 2000, poolPerChannel: 2000 }
    expect(validateDiscoveryConfig(larger)).not.toBeNull()
    const effective = executionConfig(larger, moduleBudget(larger))
    expect(effective.budgets).toEqual(DISCOVERY_HARD_LIMITS)
    expect(effective.github.pageSize).toBe(25)
    expect(effective.github.poolPerChannel).toBe(20)
    const upstream = emptySources(),
      round = await runDiscoveryScheduled(
        { ...env, DISCOVERY_ENABLED: "true" },
        { now: NOW, config: larger, fetcher: upstream.fetcher }
      )
    expect(round.requests).toBe(4)
    expect(round.statements).toBeLessThanOrEqual(40)
    expect(upstream.active.max).toBeLessThanOrEqual(3)
  })
  it("rejects an atomic identity phase before its reads when task and module finalizers cannot fit", async () => {
    const { repo, module, source } = await init(),
      lease = await claim(repo, source, module),
      spent = repo.statements
    repo.maxStatements = spent + 6
    await expect(
      repo.persistCandidates(source, lease, [candidate()])
    ).rejects.toThrow("D1_ROUND_BUDGET")
    expect(repo.statements).toBe(spent)
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM discovery_items"
      ).first<number>("count")
    ).toBe(0)
    await repo.checkpoint(lease, { state: "pending" })
    await repo.releaseModule(module)
    expect(repo.statements).toBe(spent + 2)
  })
  it("expires pending sources and publication before late processing while retaining successful source snapshots", async () => {
    const { repo, module, source, jobs } = await init(),
      lease = await claim(repo, source, module)
    await repo.persistCandidates(source, lease, [candidate()])
    await repo.checkpoint(lease, {
      state: "succeeded",
      cursor: { persisted: 1 },
    })
    const snapshot = await repo.first<DiscoveryJob>(
      "SELECT * FROM discovery_sync_jobs WHERE id=?",
      [source.id]
    )
    await repo.releaseModule(module)
    const late = new Date(NOW.getTime() + 7 * 3600000),
      upstream = emptySources()
    const round = await runDiscoveryScheduled(
      { ...env, DISCOVERY_ENABLED: "true" },
      { now: late, clock: () => late, fetcher: upstream.fetcher }
    )
    expect(round.outcome).toBe("DISCOVERY_DEADLINE")
    expect(upstream.calls).toHaveLength(0)
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM discovery_editions"
      ).first<number>("count")
    ).toBe(0)
    expect(
      await env.DB.prepare("SELECT * FROM discovery_sync_jobs WHERE id=?")
        .bind(source.id)
        .first()
    ).toEqual(snapshot)
    const pending = await env.DB.prepare(
      "SELECT state,error_code,finished_at FROM discovery_sync_jobs WHERE id IN (?,?)"
    )
      .bind(
        jobs.find((job) => job.kind === "hn")!.id,
        jobs.find((job) => job.kind === "publish")!.id
      )
      .all()
    expect(pending.results).toEqual([
      {
        state: "failed",
        error_code: "DISCOVERY_DEADLINE",
        finished_at: late.toISOString(),
      },
      {
        state: "failed",
        error_code: "DISCOVERY_DEADLINE",
        finished_at: late.toISOString(),
      },
    ])
  })
  it("prevents publication after the absolute deadline before performing any database writes", async () => {
    let current = NOW
    const { repo, module, jobs } = await init(NOW, "2026-10-08", () => current),
      job = jobs.find((job) => job.kind === "publish")!,
      lease = await claim(repo, job, module),
      spent = repo.statements
    current = new Date(job.deadline_at)
    await expect(repo.publish(job, lease, "ai", [], [], [])).rejects.toThrow(
      "DISCOVERY_DEADLINE"
    )
    expect(repo.statements).toBe(spent)
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM discovery_editions"
      ).first<number>("count")
    ).toBe(0)
  })
})
