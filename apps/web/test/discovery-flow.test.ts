import { env } from "cloudflare:test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DISCOVERY_CHANNEL_IDS } from "@mankr/shared"
import {
  runDiscoveryScheduled,
  type DiscoveryRoundResult,
} from "../src/worker/cron/discovery"
import { DISCOVERY_CONFIG } from "../src/worker/lib/discovery/channels"
import { readDiscovery } from "../src/worker/lib/discovery/repository"
import { githubRepoPayload } from "./helpers"
import type { DiscoveryConfig } from "../src/worker/lib/discovery/types"

afterEach(() => vi.restoreAllMocks())
const config = structuredClone(DISCOVERY_CONFIG)
const testEnv = {
  ...env,
  DISCOVERY_ENABLED: "true",
  GITHUB_TOKEN: "discovery-test-token",
}
const TERMINAL = ["succeeded", "failed"]
const SOURCE_KINDS = ["github", "hn", "rss"]

type Job = {
  partition_key: string
  kind: string
  state: string
  error_code: string | null
  pool_state_json: string
  cursor_json: string
  finished_at: string | null
  lease_token: string | null
}
type UpstreamOptions = {
  failed?: "none" | "ai" | "all"
  emptySearch?: boolean
  sharedRepos?: boolean
  renewFeeds?: boolean
  largeMetadata?: boolean
  escapedMetadata?: boolean
  retryAfter?: string
  rssBudgetScenario?: boolean
}

function dayStart(index: number) {
  return new Date(Date.UTC(2026, 9, 8 + index, 0, 5))
}
function editionDay(index: number) {
  return dayStart(index).toISOString().slice(0, 10)
}
async function jobsFor(index: number) {
  return (
    await env.DB.prepare(
      "SELECT partition_key,kind,state,error_code,pool_state_json,cursor_json,finished_at,lease_token FROM discovery_sync_jobs WHERE edition_day=? AND kind!='budget' ORDER BY partition_key"
    )
      .bind(editionDay(index))
      .all<Job>()
  ).results
}
function quietLogs() {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
}
function capacityContract(
  summary: Awaited<ReturnType<typeof collectDay>>["summary"]
) {
  const {
    rounds,
    actualRequests,
    reservedRequests,
    maxRequests,
    maxConcurrent,
    published,
    cleanup,
  } = summary
  return {
    rounds,
    actualRequests,
    reservedRequests,
    maxRequests,
    maxConcurrent,
    published,
    cleanup,
  }
}
function resourceEvidence(
  label: string,
  result: Awaited<ReturnType<typeof collectDay>>
) {
  vi.restoreAllMocks()
  console.info(
    "DISCOVERY_RESOURCE_EVIDENCE",
    label,
    JSON.stringify(result.summary)
  )
}
function expectFinishedWithinDeadline(
  result: Awaited<ReturnType<typeof collectDay>>,
  index: number
) {
  for (const job of result.jobs.filter(
    (job) => job.kind === "publish" || job.kind === "cleanup"
  ))
    expect(Date.parse(job.finished_at!)).toBeLessThanOrEqual(
      dayStart(index).getTime() + 6 * 3600_000
    )
}
function metadataName(id: number, channel: string, large: boolean) {
  return large
    ? `${"o".repeat(39)}/${`repo-${id}-`.padEnd(100, "r")}`
    : `discovery-${channel}/repo-${id}`
}
function metadataUrl(url: string, large: boolean) {
  return large ? url.padEnd(2048, "x") : url
}
function escapedText(prefix: string, length: number, illegal = false) {
  const start = `${prefix}\ue000\ue001😀`
  const text =
    `${start}${'"\\'.repeat(Math.ceil((length - start.length) / 2))}`.slice(
      0,
      length
    )
  return illegal
    ? `${String.fromCharCode(0xd800)}${text}${String.fromCharCode(0xdfff)}`
    : text
}
function metadataSummary(
  options: UpstreamOptions,
  prefix = "",
  illegal = false
) {
  return options.escapedMetadata
    ? escapedText(prefix, 2000, illegal)
    : `${prefix}${"D".repeat(2000)}`.slice(0, 2000)
}

function upstream(index: number, options: UpstreamOptions = {}) {
  const calls: Request[] = []
  let active = 0
  let maxConcurrent = 0
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    calls.push(request)
    active++
    maxConcurrent = Math.max(maxConcurrent, active)
    try {
      // Give concurrent adapter calls an overlapping asynchronous network boundary.
      await new Promise((resolve) => setTimeout(resolve, 1))
      const url = new URL(request.url)
      if (options.failed === "all")
        return new Response("temporary outage", {
          status: 503,
          headers: options.retryAfter
            ? { "retry-after": options.retryAfter }
            : {},
        })
      if (url.hostname === "api.github.com") {
        expect(request.headers.get("authorization")).toBe(
          "Bearer discovery-test-token"
        )
        let id: number
        let channelIndex: number
        if (url.pathname === "/search/repositories") {
          const query = url.searchParams.get("q") ?? ""
          channelIndex = config.channels.findIndex((channel) =>
            channel.topics.some((topic) => query.includes(`topic:${topic}`))
          )
          const channel = config.channels[channelIndex]!
          if (options.failed === "ai" && channel.id === "ai")
            return new Response("temporary outage", { status: 503 })
          if (options.emptySearch)
            return Response.json({ incomplete_results: false, items: [] })
          const topicIndex = channel.topics.findIndex((topic) =>
            query.includes(`topic:${topic}`)
          )
          const queryIndex =
            topicIndex * 2 + Number(url.searchParams.get("sort") === "updated")
          return Response.json({
            incomplete_results: false,
            items: Array.from({ length: 25 }, (_, offset) => {
              id =
                (options.sharedRepos ? 0 : channelIndex * 1000) +
                queryIndex * 25 +
                offset +
                1
              return githubRepoPayload(
                metadataName(
                  id,
                  options.sharedRepos ? "shared" : channel.id,
                  !!options.largeMetadata
                ),
                {
                  id,
                  stargazers_count: 100 + index * 15,
                  topics: channel.topics,
                  fork: false,
                  private: false,
                  ...(options.largeMetadata
                    ? { description: metadataSummary(options, "", true) }
                    : {}),
                }
              )
            }),
          })
        }
        id = Number(url.pathname.match(/^\/repositories\/(\d+)$/)?.[1])
        if (id > 0) {
          channelIndex = options.sharedRepos ? 0 : Math.floor(id / 1000)
          const channel = config.channels[channelIndex]!
          return Response.json(
            githubRepoPayload(
              metadataName(
                id,
                options.sharedRepos ? "shared" : channel.id,
                !!options.largeMetadata
              ),
              {
                id,
                stargazers_count: 100 + index * 15,
                topics: channel.topics,
                fork: false,
                private: false,
                ...(options.largeMetadata
                  ? { description: metadataSummary(options, "", true) }
                  : {}),
              }
            )
          )
        }
      }
      if (url.hostname === "hacker-news.firebaseio.com") {
        if (url.pathname.endsWith("stories.json"))
          return Response.json(
            Array.from({ length: 40 }, (_, item) => item + 1)
          )
        const id = Number(url.pathname.match(/item\/(\d+)/)?.[1])
        const topics = [
          "LLM inference",
          "React CSS",
          "Postgres database",
          "CLI editor",
        ]
        const title = `${topics[(id - 1) % 4]} article ${id}`
        return Response.json({
          id,
          type: "story",
          title: options.escapedMetadata
            ? escapedText(title, 500, true)
            : options.largeMetadata
              ? title.padEnd(500, "h")
              : title,
          ...(options.largeMetadata
            ? { text: metadataSummary(options, "", true) }
            : {}),
          url: metadataUrl(
            `https://example.com/story/${id}`,
            !!options.largeMetadata
          ),
          score: 300 - id,
          descendants: id,
          time: dayStart(index).getTime() / 1000,
        })
      }
      const feed = config.feeds.find(
        (entry) => new URL(entry.url).hostname === url.hostname
      )
      if (feed) {
        if (options.rssBudgetScenario && feed.id === "huggingface")
          return new Response("retry later", {
            status: 503,
            headers: { "retry-after": "600" },
          })
        if (options.rssBudgetScenario && feed.id === "webdev") {
          if (!url.searchParams.has("hop"))
            return new Response(null, {
              status: 302,
              headers: { location: `${feed.url}?hop=1` },
            })
          if (url.searchParams.get("hop") === "1")
            return new Response(null, {
              status: 302,
              headers: { location: `${feed.url}?hop=2` },
            })
        }
        if (request.headers.get("if-none-match") && !options.renewFeeds)
          return new Response(null, { status: 304 })
        const topics = {
          huggingface: "LLM inference",
          webdev: "React CSS",
          cloudflare: "Postgres database",
        }
        const date = dayStart(options.renewFeeds ? index : 0).toUTCString()
        const items = Array.from({ length: 30 }, (_, item) => {
          const title = `${topics[feed.id as keyof typeof topics]} ${item}`
          const guid = `${feed.id}:${item}`
          return `<item><title>${options.escapedMetadata ? escapedText(title, 500) : options.largeMetadata ? title.padEnd(500, "r") : title}</title><link>${metadataUrl(`https://${url.hostname}/discovery-test/${item}`, !!options.largeMetadata)}</link><guid>${options.escapedMetadata ? escapedText(guid, 500) : options.largeMetadata ? guid.padEnd(500, "g") : guid}</guid><pubDate>${date}</pubDate><description>${options.largeMetadata ? metadataSummary(options, "technical release ") : "Useful technical update"}</description></item>`
        }).join("")
        return new Response(
          `<rss version="2.0"><channel>${items}</channel></rss>`,
          {
            headers: {
              "content-type": "application/rss+xml",
              etag: `"${feed.id}-v${options.renewFeeds ? index : 0}"`,
            },
          }
        )
      }
      throw new Error(`unexpected discovery upstream: ${url.href}`)
    } finally {
      active--
    }
  }) as typeof fetch
  return { fetcher, calls, maxConcurrent: () => maxConcurrent }
}

/** Count physical D1 executions independently of the scheduler's own counters. */
function measuredDb() {
  const measurement = { statements: 0, rowsRead: 0, rowsWritten: 0 }
  const underlying = new WeakMap<D1PreparedStatement, D1PreparedStatement>()
  const record = (result: D1Result) => {
    measurement.rowsRead += result.meta.rows_read ?? 0
    measurement.rowsWritten += result.meta.rows_written ?? 0
  }
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values))
        if (property === "all" || property === "run")
          return async () => {
            measurement.statements++
            const result =
              property === "all" ? await target.all() : await target.run()
            record(result)
            return result
          }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    underlying.set(wrapped, statement)
    return wrapped
  }
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => wrap(target.prepare(sql))
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          measurement.statements += statements.length
          const results = await target.batch(
            statements.map(
              (statement) => underlying.get(statement) ?? statement
            )
          )
          results.forEach(record)
          return results
        }
      const value = Reflect.get(target, property)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { db, measurement }
}

async function runRound(
  index: number,
  round: number,
  source: ReturnType<typeof upstream>,
  runConfig: DiscoveryConfig = config
) {
  const now = new Date(dayStart(index).getTime() + round * 600_000)
  const measured = measuredDb()
  const initialRequests = source.calls.length
  const result = await runDiscoveryScheduled(
    { ...testEnv, DB: measured.db },
    {
      now,
      clock: () => now,
      config: runConfig,
      fetcher: source.fetcher,
    }
  )
  expect(result.requests).toBe(source.calls.length - initialRequests)
  expect(result.statements).toBe(measured.measurement.statements)
  expect(result.rowsRead).toBe(measured.measurement.rowsRead)
  expect(result.rowsWritten).toBe(measured.measurement.rowsWritten)
  expect(result.statements).toBeLessThanOrEqual(
    runConfig.budgets.d1StatementsPerRound
  )
  expect(result.requests).toBeLessThanOrEqual(
    runConfig.budgets.requestsPerRound
  )
  expect(source.maxConcurrent()).toBeLessThanOrEqual(
    runConfig.budgets.concurrentRequests
  )
  return result
}

async function collectDay(
  index: number,
  options: UpstreamOptions = {},
  startRound = 0,
  source = upstream(index, options),
  runConfig: DiscoveryConfig = config
) {
  const rounds: DiscoveryRoundResult[] = []
  for (let round = startRound; round < Math.max(38, startRound + 8); round++) {
    rounds.push(await runRound(index, round, source, runConfig))
    const jobs = await jobsFor(index)
    if (jobs.length === 13 && jobs.every((job) => TERMINAL.includes(job.state)))
      break
  }
  const jobs = await jobsFor(index)
  expect(jobs).toHaveLength(13)
  expect(jobs.every((job) => TERMINAL.includes(job.state))).toBe(true)
  const published = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM discovery_editions WHERE edition_day=? AND state='published'"
  )
    .bind(editionDay(index))
    .first<{ count: number }>()
  const budget = await env.DB.prepare(
    "SELECT request_count,cursor_json,lease_token FROM discovery_sync_jobs WHERE edition_day=? AND kind='budget'"
  )
    .bind(editionDay(index))
    .first<{
      request_count: number
      cursor_json: string
      lease_token: string | null
    }>()
  expect(budget!.request_count).toBeLessThanOrEqual(320)
  expect(budget!.lease_token).toBeNull()
  expect(jobs.every((job) => job.lease_token === null)).toBe(true)
  const summary = {
    rounds: rounds.length,
    actualRequests: rounds.reduce((total, round) => total + round.requests, 0),
    reservedRequests: budget!.request_count,
    statements: rounds.reduce((total, round) => total + round.statements, 0),
    rowsRead: rounds.reduce((total, round) => total + round.rowsRead, 0),
    rowsWritten: rounds.reduce((total, round) => total + round.rowsWritten, 0),
    maxRequests: Math.max(...rounds.map((round) => round.requests)),
    maxStatements: Math.max(...rounds.map((round) => round.statements)),
    maxConcurrent: source.maxConcurrent(),
    published: published!.count,
    cleanup: jobs.find((job) => job.kind === "cleanup")!.state,
  }
  return {
    rounds,
    published: published!.count,
    budget: budget!.request_count,
    jobs,
    source,
    summary,
  }
}
function sourceCalls(source: ReturnType<typeof upstream>, path: string) {
  return source.calls.filter((request) =>
    new URL(request.url).pathname.startsWith(path)
  )
}
async function frozenEdition(day: string) {
  return (
    await env.DB.prepare(
      "SELECT frozen_json FROM discovery_edition_items WHERE edition_id IN(SELECT id FROM discovery_editions WHERE edition_day=?) ORDER BY edition_id,rank"
    )
      .bind(day)
      .all<{ frozen_json: string }>()
  ).results
}

function expectCompleteWithinDeadline(
  result: Awaited<ReturnType<typeof collectDay>>,
  index: number
) {
  for (const job of result.jobs.filter(
    (job) => job.kind === "publish" || job.kind === "cleanup"
  )) {
    expect(job.state).toBe("succeeded")
    expect(Date.parse(job.finished_at!)).toBeLessThanOrEqual(
      dayStart(index).getTime() + 6 * 3600_000
    )
  }
  expect(
    result.rounds.filter(
      (round) =>
        round.partition && SOURCE_KINDS.includes(round.partition.split(":")[0]!)
    ).length
  ).toBeLessThan(32)
}

describe("每日发现最大规模完整链路", () => {
  it("80仓库、40HN及3个30条Feed形成次日增长与304快照，旧版冻结不变", async () => {
    quietLogs()
    const first = await collectDay(0)
    expect(first.published).toBe(4)
    expectCompleteWithinDeadline(first, 0)
    expect(first.summary.actualRequests).toBe(61)
    const githubCount = await env.DB.prepare(
      "SELECT COUNT(DISTINCT github_repo_id) AS count FROM discovery_items WHERE github_repo_id IS NOT NULL"
    ).first<{ count: number }>()
    expect(githubCount!.count).toBe(80)
    for (const channel of DISCOVERY_CHANNEL_IDS) {
      const response = await readDiscovery(env.DB, true, channel, false)
      expect(response.items).toHaveLength(20)
      expect(
        response.items
          .flatMap((item) =>
            item.evidence.filter((evidence) => evidence.source === "github")
          )
          .every((evidence) => evidence.growth === null)
      ).toBe(true)
      expect(response.items.every((item) => !("savedBookmarkId" in item))).toBe(
        true
      )
    }
    const frozen = await frozenEdition("2026-10-08")
    const second = await collectDay(1)
    expect(second.published).toBe(4)
    for (const channel of DISCOVERY_CHANNEL_IDS) {
      const response = await readDiscovery(env.DB, true, channel, true)
      expect(response.edition?.day).toBe("2026-10-09")
      const evidence = response.items.flatMap((item) => item.evidence)
      expect(
        evidence.some(
          (entry) => entry.source === "github" && entry.growth === 15
        )
      ).toBe(true)
      for (const rss of evidence.filter((entry) => entry.source === "rss"))
        expect(rss.observedAt.slice(0, 10)).toBe("2026-10-08")
      expect(
        response.items.every((item) => item.savedBookmarkId === null)
      ).toBe(true)
    }
    expect(await frozenEdition("2026-10-08")).toEqual(frozen)
    // Local workerd D1/request evidence; these values do not measure CPU.
    expect({
      first: capacityContract(first.summary),
      second: capacityContract(second.summary),
    }).toMatchInlineSnapshot(`
      {
        "first": {
          "actualRequests": 61,
          "cleanup": "succeeded",
          "maxConcurrent": 3,
          "maxRequests": 10,
          "published": 4,
          "reservedRequests": 67,
          "rounds": 25,
        },
        "second": {
          "actualRequests": 61,
          "cleanup": "succeeded",
          "maxConcurrent": 3,
          "maxRequests": 10,
          "published": 4,
          "reservedRequests": 67,
          "rounds": 25,
        },
      }
    `)
  })

  it("16次空搜索补抓前日4频道互异的80个仓库详情，总计141次实际出站", async () => {
    quietLogs()
    const first = await collectDay(0)
    const oldPools = first.jobs
      .filter((job) => job.kind === "github")
      .map(
        (job) => JSON.parse(job.pool_state_json) as { githubRepoId: number }[]
      )
    expect(oldPools).toHaveLength(4)
    expect(oldPools.every((pool) => pool.length === 20)).toBe(true)
    const ids = oldPools.flat().map((member) => member.githubRepoId)
    expect(new Set(ids).size).toBe(80)
    const second = await collectDay(1, { emptySearch: true, renewFeeds: true })
    expectCompleteWithinDeadline(second, 1)
    expect(
      second.jobs
        .filter((job) => SOURCE_KINDS.includes(job.kind))
        .every((job) => job.state === "succeeded")
    ).toBe(true)
    expect(sourceCalls(second.source, "/search/repositories")).toHaveLength(16)
    const details = sourceCalls(second.source, "/repositories/").map(
      (request) => Number(new URL(request.url).pathname.split("/").at(-1))
    )
    expect(details.sort((a, b) => a - b)).toEqual(ids.sort((a, b) => a - b))
    expect(sourceCalls(second.source, "/v0/item/")).toHaveLength(40)
    expect(sourceCalls(second.source, "/v0/topstories")).toHaveLength(1)
    expect(sourceCalls(second.source, "/v0/beststories")).toHaveLength(1)
    const observations = (
      await env.DB.prepare(
        "SELECT j.kind,COUNT(*) AS count FROM discovery_observations o JOIN discovery_sync_jobs j ON j.id=o.job_id WHERE j.edition_day=? GROUP BY j.kind"
      )
        .bind(editionDay(1))
        .all<{ kind: string; count: number }>()
    ).results
    expect(
      Object.fromEntries(observations.map((row) => [row.kind, row.count]))
    ).toEqual({ github: 80, hn: 40, rss: 90 })
    expect(second.summary.actualRequests).toBe(141)
    expect(second.source.calls).toHaveLength(141)
    expect(second.budget).toBe(147)
    expect(second.published).toBe(4)
    expect(capacityContract(second.summary)).toMatchInlineSnapshot(`
      {
        "actualRequests": 141,
        "cleanup": "succeeded",
        "maxConcurrent": 3,
        "maxRequests": 10,
        "published": 4,
        "reservedRequests": 147,
        "rounds": 25,
      }
    `)
  })

  it("同一仓库跨4频道的旧池仅补抓一次详情，仍持久化4份频道观察", async () => {
    quietLogs()
    const first = await collectDay(0, { sharedRepos: true })
    const ids = first.jobs
      .filter((job) => job.kind === "github")
      .flatMap((job) =>
        (JSON.parse(job.pool_state_json) as { githubRepoId: number }[]).map(
          (member) => member.githubRepoId
        )
      )
    expect(ids).toHaveLength(80)
    expect(new Set(ids).size).toBe(20)
    const second = await collectDay(1, {
      sharedRepos: true,
      emptySearch: true,
      renewFeeds: true,
    })
    expectCompleteWithinDeadline(second, 1)
    const details = sourceCalls(second.source, "/repositories/")
    expect(details).toHaveLength(20)
    expect(new Set(details.map((request) => request.url)).size).toBe(20)
    expect(second.summary.actualRequests).toBe(81)
    for (const channel of DISCOVERY_CHANNEL_IDS) {
      const observations = await env.DB.prepare(
        "SELECT candidate_json FROM discovery_observations WHERE job_id=?"
      )
        .bind(`discovery:${editionDay(1)}:github:${channel}`)
        .all<{ candidate_json: string }>()
      expect(observations.results).toHaveLength(20)
      expect(
        observations.results.every((row) =>
          JSON.parse(row.candidate_json).channels.includes(channel)
        )
      ).toBe(true)
    }
    expect(capacityContract(second.summary)).toMatchInlineSnapshot(`
      {
        "actualRequests": 81,
        "cleanup": "succeeded",
        "maxConcurrent": 3,
        "maxRequests": 10,
        "published": 4,
        "reservedRequests": 87,
        "rounds": 25,
      }
    `)
  })

  it("单源失败按频道保旧，全源失败保留旧版而不创建伪今日榜单", async () => {
    quietLogs()
    expect((await collectDay(0)).published).toBe(4)
    const partial = await collectDay(1, { failed: "ai" })
    expect(partial.published).toBe(4)
    const ai = await readDiscovery(env.DB, true, "ai", false)
    expect(ai.state).toBe("partial")
    expect(
      ai.sources.some(
        (source) => source.source === "github" && source.state === "stale"
      )
    ).toBe(true)
    const failed = await collectDay(2, { failed: "all" })
    expect(failed.published).toBe(0)
    for (const channel of DISCOVERY_CHANNEL_IDS) {
      const response = await readDiscovery(env.DB, true, channel, false)
      expect(response.edition?.day).toBe("2026-10-09")
      expect(response.state).toBe("failed")
      expect(response.sync.state).toBe("failed")
      expect(response.items.length).toBeGreaterThan(0)
    }
  })

  it("最大允许标题、摘要、仓库名与Feed ID仍满足游标和冻结JSON的数据库约束", async () => {
    quietLogs()
    const result = await collectDay(0, {
      largeMetadata: true,
      renewFeeds: true,
    })
    expectCompleteWithinDeadline(result, 0)
    expect(
      result.jobs
        .filter((job) => SOURCE_KINDS.includes(job.kind))
        .every((job) => job.state === "succeeded"),
      JSON.stringify(
        result.jobs.map((job) => ({
          partition: job.partition_key,
          state: job.state,
          error: job.error_code,
          cursorLength: job.cursor_json.length,
        }))
      )
    ).toBe(true)
    for (const job of result.jobs) {
      expect(() => JSON.parse(job.cursor_json)).not.toThrow()
      expect(job.cursor_json.length).toBeLessThanOrEqual(262144)
      expect(job.pool_state_json.length).toBeLessThanOrEqual(65536)
    }
    const bounds = await env.DB.prepare(
      "SELECT MAX(length(candidate_json)) AS candidate FROM discovery_observations"
    ).first<{ candidate: number }>()
    expect(bounds!.candidate).toBeLessThanOrEqual(16384)
    const candidates = await env.DB.prepare(
      "SELECT candidate_json FROM discovery_observations WHERE source!='github'"
    ).all<{ candidate_json: string }>()
    expect(candidates.results).toHaveLength(130)
    for (const row of candidates.results) {
      const candidate = JSON.parse(row.candidate_json)
      expect(candidate.url.length).toBe(2048)
      expect(candidate.canonicalUrl.length).toBe(2048)
      expect(candidate.evidence.url.length).toBeLessThanOrEqual(2048)
    }
    const frozen = await frozenEdition(editionDay(0))
    expect(frozen).toHaveLength(80)
    expect(frozen.every((row) => row.frozen_json.length <= 32768)).toBe(true)
    expect(capacityContract(result.summary)).toMatchInlineSnapshot(`
      {
        "actualRequests": 61,
        "cleanup": "succeeded",
        "maxConcurrent": 3,
        "maxRequests": 10,
        "published": 4,
        "reservedRequests": 67,
        "rounds": 25,
      }
    `)
  })

  it("重试与两个白名单重定向计入预占额度，320额度耗尽后保旧且停止出站", async () => {
    quietLogs()
    expect((await collectDay(0)).published).toBe(4)
    const source = upstream(1, { rssBudgetScenario: true, renewFeeds: true })
    const setup = await runRound(1, 0, source)
    expect(setup.requests).toBe(4)
    // Model 310 earlier requests plus the four setup searches; every subsequent
    // request/reservation is observed independently by the real scheduler.
    await env.DB.prepare(
      "UPDATE discovery_sync_jobs SET request_count=314 WHERE edition_day=? AND kind='budget'"
    )
      .bind(editionDay(1))
      .run()
    await env.DB.prepare(
      "UPDATE discovery_sync_jobs SET state='failed',error_code='FIXTURE_PREVIOUS_FAILURE',finished_at=?,lease_token=NULL,lease_until=NULL WHERE edition_day=? AND kind IN ('github','hn')"
    )
      .bind(dayStart(1).toISOString(), editionDay(1))
      .run()
    for (const [position, feed] of [
      "huggingface",
      "webdev",
      "cloudflare",
    ].entries()) {
      await env.DB.prepare(
        "UPDATE discovery_sync_jobs SET updated_at=? WHERE edition_day=? AND partition_key=?"
      )
        .bind(
          new Date(dayStart(1).getTime() - (3 - position) * 1000).toISOString(),
          editionDay(1),
          `rss:${feed}`
        )
        .run()
    }
    const result = await collectDay(1, {}, 1, source)
    expect(result.budget).toBe(320)
    expect(result.summary.actualRequests).toBe(4)
    expect(source.calls).toHaveLength(8)
    const feedRequests = source.calls.filter(
      (request) => !request.url.includes("api.github.com")
    )
    expect(
      feedRequests.map((request) => new URL(request.url).hostname)
    ).toEqual(["huggingface.co", "web.dev", "web.dev", "web.dev"])
    expect(
      feedRequests.map((request) =>
        new URL(request.url).searchParams.get("hop")
      )
    ).toEqual([null, null, "1", "2"])
    expect(
      result.jobs.find((job) => job.partition_key === "rss:webdev")?.state
    ).toBe("succeeded")
    for (const feed of ["huggingface", "cloudflare"]) {
      const job = result.jobs.find(
        (job) => job.partition_key === `rss:${feed}`
      )!
      expect(job.state).toBe("failed")
      expect(job.error_code).toBe("DAILY_REQUEST_BUDGET_OR_LEASE")
    }
    expect(result.published).toBe(1)
    const frontend = await readDiscovery(env.DB, true, "frontend", false)
    expect(frontend.edition?.day).toBe(editionDay(1))
    expect(frontend.state).toBe("partial")
    expect(
      frontend.sources.some(
        (entry) => entry.source === "github" && entry.state === "stale"
      )
    ).toBe(true)
    for (const channel of ["ai", "backend", "tools"] as const) {
      const response = await readDiscovery(env.DB, true, channel, false)
      expect(response.edition?.day).toBe(editionDay(0))
      expect(response.state).toBe("failed")
      expect(response.items).toHaveLength(20)
    }
    const callsBefore = source.calls.length
    const idle = await runRound(1, 37, source)
    expect(idle.requests).toBe(0)
    expect(source.calls).toHaveLength(callsBefore)
    expect({
      setupRequests: 4,
      seededEarlierRequests: 310,
      ...capacityContract(result.summary),
    }).toMatchInlineSnapshot(`
      {
        "actualRequests": 4,
        "cleanup": "succeeded",
        "maxConcurrent": 3,
        "maxRequests": 3,
        "published": 1,
        "reservedRequests": 320,
        "rounds": 9,
        "seededEarlierRequests": 310,
        "setupRequests": 4,
      }
    `)
  })

  it("第32轮停止长Retry-After采集，6小时内结束4个发布任务与清理并保留旧版", async () => {
    quietLogs()
    expect((await collectDay(0)).published).toBe(4)
    const frozen = await frozenEdition(editionDay(0))
    const result = await collectDay(1, { failed: "all", retryAfter: "21600" })
    const cutoff = result.rounds.findIndex(
      (round) => round.outcome === "COLLECTION_DEADLINE"
    )
    expect(cutoff).toBe(31)
    expect(
      result.rounds.slice(cutoff).every((round) => round.requests === 0)
    ).toBe(true)
    expect(
      result.jobs
        .filter((job) => SOURCE_KINDS.includes(job.kind))
        .every(
          (job) =>
            job.state === "failed" && job.error_code === "COLLECTION_DEADLINE"
        )
    ).toBe(true)
    const publication = result.jobs.filter((job) => job.kind === "publish")
    expect(publication).toHaveLength(4)
    expect(
      publication.every(
        (job) =>
          job.state === "failed" && job.error_code === "ALL_SOURCES_FAILED"
      )
    ).toBe(true)
    for (const job of result.jobs.filter(
      (job) => job.kind === "publish" || job.kind === "cleanup"
    ))
      expect(Date.parse(job.finished_at!)).toBeLessThanOrEqual(
        dayStart(1).getTime() + 6 * 3600_000
      )
    expect(result.jobs.find((job) => job.kind === "cleanup")?.state).toBe(
      "succeeded"
    )
    expect(result.published).toBe(0)
    expect(await frozenEdition(editionDay(0))).toEqual(frozen)
    for (const channel of DISCOVERY_CHANNEL_IDS) {
      const response = await readDiscovery(env.DB, true, channel, false)
      expect(response.edition?.day).toBe(editionDay(0))
      expect(response.state).toBe("failed")
      expect(response.items).toHaveLength(20)
    }
    expect({
      collectionCutoffRound: cutoff + 1,
      ...capacityContract(result.summary),
    }).toMatchInlineSnapshot(`
      {
        "actualRequests": 17,
        "cleanup": "succeeded",
        "collectionCutoffRound": 32,
        "maxConcurrent": 3,
        "maxRequests": 3,
        "published": 0,
        "reservedRequests": 27,
        "rounds": 37,
      }
    `)
  })

  it("不足32次调用时也提前50分钟停止采集，6小时内结束发布与清理", async () => {
    quietLogs()
    expect((await collectDay(0)).published).toBe(4)
    const source = upstream(1, { failed: "all", retryAfter: "21600" })
    await runRound(1, 0, source)
    const result = await collectDay(1, {}, 31, source)
    expect(result.rounds[0]?.outcome).toBe("COLLECTION_DEADLINE")
    expect(result.rounds.every((round) => round.requests === 0)).toBe(true)
    expect(
      result.jobs
        .filter((job) => SOURCE_KINDS.includes(job.kind))
        .every(
          (job) =>
            job.state === "failed" && job.error_code === "COLLECTION_DEADLINE"
        )
    ).toBe(true)
    expect(
      result.jobs
        .filter((job) => job.kind === "publish")
        .every((job) => job.state === "failed")
    ).toBe(true)
    expect(result.published).toBe(0)
    expect(result.jobs.find((job) => job.kind === "cleanup")?.state).toBe(
      "succeeded"
    )
    expectFinishedWithinDeadline(result, 1)
    expect(capacityContract(result.summary)).toMatchInlineSnapshot(`
      {
        "actualRequests": 0,
        "cleanup": "succeeded",
        "maxConcurrent": 3,
        "maxRequests": 0,
        "published": 0,
        "reservedRequests": 4,
        "rounds": 6,
      }
    `)
  })

  it("100个最坏转义搜索输入无损恢复，Unicode合法，次日304与成功冻结内容保持不变", async () => {
    quietLogs()
    const options = { largeMetadata: true, escapedMetadata: true }
    const source = upstream(0, options)
    const searchRounds = []
    for (let round = 0; round < 4; round++)
      searchRounds.push(await runRound(0, round, source))
    const searched = (await jobsFor(0)).filter((job) => job.kind === "github")
    expect(searched).toHaveLength(4)
    for (const job of searched) {
      expect(JSON.parse(job.cursor_json).searchCompact).toHaveLength(100)
      expect(job.cursor_json.length).toBeLessThanOrEqual(262144)
    }
    const first = await collectDay(0, {}, 4, source)
    expectCompleteWithinDeadline(first, 0)
    expect(
      first.jobs
        .filter((job) => SOURCE_KINDS.includes(job.kind))
        .every((job) => job.state === "succeeded")
    ).toBe(true)
    expect(source.calls).toHaveLength(61)
    const readCandidates = async (index: number) =>
      (
        await env.DB.prepare(
          "SELECT candidate_json FROM discovery_observations o JOIN discovery_sync_jobs j ON j.id=o.job_id WHERE j.edition_day=? ORDER BY j.partition_key,o.external_id"
        )
          .bind(editionDay(index))
          .all<{ candidate_json: string }>()
      ).results.map((row) => JSON.parse(row.candidate_json))
    const assertText = (
      candidates: Awaited<ReturnType<typeof readCandidates>>
    ) => {
      expect(candidates).toHaveLength(210)
      for (const candidate of candidates) {
        const expected = escapedText(
          candidate.source === "rss" ? "technical release " : "",
          2000
        )
        expect(candidate.summary).toBe(expected)
        expect(candidate.summary).toHaveLength(2000)
        expect(candidate.summary).toContain('"\\')
        expect(candidate.summary).toContain("\ue000\ue001😀")
        expect(
          /[\uD800-\uDFFF]/u.test(candidate.title + candidate.summary)
        ).toBe(false)
        expect(candidate.url.length).toBeLessThanOrEqual(2048)
        expect(JSON.stringify(candidate).length).toBeLessThanOrEqual(16384)
      }
    }
    const candidates = await readCandidates(0)
    assertText(candidates)
    const frozen = await frozenEdition(editionDay(0))
    expect(frozen).toHaveLength(80)
    expect(frozen.every((row) => row.frozen_json.length <= 32768)).toBe(true)
    const second = await collectDay(1, { ...options, emptySearch: true })
    expectCompleteWithinDeadline(second, 1)
    assertText(await readCandidates(1))
    const previousRss = candidates.filter(
      (candidate) => candidate.source === "rss"
    )
    const nextRss = (await readCandidates(1)).filter(
      (candidate) => candidate.source === "rss"
    )
    expect(nextRss).toEqual(previousRss)
    expect(await frozenEdition(editionDay(0))).toEqual(frozen)
    for (const job of [...first.jobs, ...second.jobs])
      expect(job.cursor_json.length).toBeLessThanOrEqual(262144)
    expect(second.summary.actualRequests).toBe(141)
    resourceEvidence("escaped-retained80-day2", second)
  })

  it("D1下限16仍完整持久化80仓库、40HN、90RSS，完成身份归并及4发布清理", async () => {
    quietLogs()
    const low = structuredClone(config)
    low.budgets.d1StatementsPerRound = 16
    const previousUrl = "https://github.com/old-owner/repo-1"
    const currentUrl = "https://github.com/discovery-ai/repo-1"
    for (const [id, url, numeric, type] of [
      ["numeric-root", previousUrl, 1, "github"],
      ["generic-root", currentUrl, null, "url"],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO discovery_items(id,canonical_url,github_repo_id,aliases_json,bookmark_source_type,title,first_seen_at,last_seen_at) VALUES(?,?,?,'[]',?,'Existing',?,?)"
      )
        .bind(
          id,
          url,
          numeric,
          type,
          dayStart(0).toISOString(),
          dayStart(0).toISOString()
        )
        .run()
    }
    const first = await collectDay(0, {}, 0, upstream(0), low)
    expectCompleteWithinDeadline(first, 0)
    expect(
      first.jobs
        .filter((job) => SOURCE_KINDS.includes(job.kind))
        .every((job) => job.state === "succeeded")
    ).toBe(true)
    const merged = await env.DB.prepare(
      "SELECT merged_into_id,canonical_url FROM discovery_items WHERE id='generic-root'"
    ).first<{ merged_into_id: string; canonical_url: string | null }>()
    expect(merged?.merged_into_id).toBe("numeric-root")
    expect(merged?.canonical_url).toBeNull()
    const root = await env.DB.prepare(
      "SELECT canonical_url,aliases_json FROM discovery_items WHERE id='numeric-root'"
    ).first<{ canonical_url: string; aliases_json: string }>()
    expect(root?.canonical_url).toBe(currentUrl)
    expect(JSON.parse(root!.aliases_json)).toContain(previousUrl)
    const second = await collectDay(
      1,
      { emptySearch: true, renewFeeds: true },
      0,
      upstream(1, { emptySearch: true, renewFeeds: true }),
      low
    )
    expectCompleteWithinDeadline(second, 1)
    expect(second.summary.actualRequests).toBe(141)
    const observations = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM discovery_observations o JOIN discovery_sync_jobs j ON j.id=o.job_id WHERE j.edition_day=?"
    )
      .bind(editionDay(1))
      .first<{ count: number }>()
    expect(observations?.count).toBe(210)
    expect(
      second.jobs
        .filter((job) => SOURCE_KINDS.includes(job.kind))
        .every((job) => job.state === "succeeded")
    ).toBe(true)
    expect(second.summary.maxStatements).toBeLessThanOrEqual(16)
    resourceEvidence("d1-16-retained80", second)
  })

  it("合法极低请求与片预算不会无限重试，截止后保留旧版并按时收尾", async () => {
    quietLogs()
    expect((await collectDay(0)).published).toBe(4)
    const low = structuredClone(config)
    Object.assign(low.budgets, {
      requestsPerRound: 1,
      concurrentRequests: 1,
      githubSearchesPerRound: 1,
      pieceSize: 1,
      d1StatementsPerRound: 16,
    })
    const result = await collectDay(1, {}, 0, upstream(1), low)
    expect(
      result.rounds.some((round) => round.outcome === "COLLECTION_DEADLINE")
    ).toBe(true)
    expectFinishedWithinDeadline(result, 1)
    expect(result.summary.maxRequests).toBeLessThanOrEqual(1)
    expect(result.summary.maxStatements).toBeLessThanOrEqual(16)
    expect(result.summary.maxConcurrent).toBeLessThanOrEqual(1)
    expect(result.rounds.slice(32).every((round) => round.requests === 0)).toBe(
      true
    )
    for (const channel of DISCOVERY_CHANNEL_IDS) {
      const response = await readDiscovery(env.DB, true, channel, false)
      expect(response.items.length).toBeGreaterThan(0)
      expect([editionDay(0), editionDay(1)]).toContain(response.edition?.day)
    }
    resourceEvidence("requests1-piece1", result)
  })

  it("时钟截止保留已成功来源，部分发布与全失败保旧都在6小时内完成", async () => {
    quietLogs()
    expect((await collectDay(0)).published).toBe(4)
    const source = upstream(1)
    for (let round = 0; round < 8; round++) await runRound(1, round, source)
    const before = await jobsFor(1)
    expect(
      before.some(
        (job) => SOURCE_KINDS.includes(job.kind) && job.state === "succeeded"
      )
    ).toBe(true)
    expect(
      before.some(
        (job) => SOURCE_KINDS.includes(job.kind) && job.state === "pending"
      )
    ).toBe(true)
    const result = await collectDay(1, {}, 31, source)
    expect(result.rounds[0]?.outcome).toBe("COLLECTION_DEADLINE")
    expect(result.rounds.every((round) => round.requests === 0)).toBe(true)
    expectFinishedWithinDeadline(result, 1)
    expect(result.published).toBeGreaterThan(0)
    expect(result.published).toBeLessThan(4)
    const published = await env.DB.prepare(
      "SELECT channel_id,published_at FROM discovery_editions WHERE edition_day=? AND state='published'"
    )
      .bind(editionDay(1))
      .all<{
        channel_id: (typeof DISCOVERY_CHANNEL_IDS)[number]
        published_at: string
      }>()
    for (const edition of published.results) {
      expect(Date.parse(edition.published_at)).toBeLessThan(
        dayStart(1).getTime() + 6 * 3600_000
      )
      expect(
        (await readDiscovery(env.DB, true, edition.channel_id, false)).state
      ).toBe("partial")
    }
    resourceEvidence("clock-cutoff-partial", result)
  })

  it("错过绝对期限后只终结任务及维护清理，不出站、不发布过期今日榜单", async () => {
    quietLogs()
    expect((await collectDay(0)).published).toBe(4)
    const frozen = await frozenEdition(editionDay(0))
    const source = upstream(1)
    await runRound(1, 0, source)
    const result = await collectDay(1, {}, 43, source)
    expect(result.rounds[0]?.outcome).toBe("DISCOVERY_DEADLINE")
    expect(result.rounds.every((round) => round.requests === 0)).toBe(true)
    expect(result.published).toBe(0)
    expect(
      result.jobs
        .filter((job) => job.kind !== "cleanup")
        .every(
          (job) =>
            job.state === "failed" && job.error_code === "DISCOVERY_DEADLINE"
        )
    ).toBe(true)
    expect(result.jobs.find((job) => job.kind === "cleanup")?.state).toBe(
      "succeeded"
    )
    expect(await frozenEdition(editionDay(0))).toEqual(frozen)
    for (const channel of DISCOVERY_CHANNEL_IDS)
      expect(
        (await readDiscovery(env.DB, true, channel, false)).edition?.day
      ).toBe(editionDay(0))
    resourceEvidence("missed-absolute-deadline", result)
  })
})
