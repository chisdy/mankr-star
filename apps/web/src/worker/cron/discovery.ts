import { createDb } from "@mankr/db"
import {
  DISCOVERY_CHANNEL_IDS,
  type DiscoveryChannelId,
  type DiscoveryItem,
} from "@mankr/shared"
import type { Env } from "../env"
import { resolveGithubToken } from "../lib/ai-service"
import {
  DISCOVERY_CONFIG,
  enabledDiscoveryFeeds,
} from "../lib/discovery/channels"
import {
  fetchGithubRepository,
  fetchGithubSearch,
  selectGithubPool,
} from "../lib/discovery/github"
import { fetchHnStoryIds, fetchHnItem } from "../lib/discovery/hacker-news"
import {
  validateDiscoveryConfig,
  parseDiscoveryConfig,
  parseModuleBudget,
  moduleBudget,
  executionConfig,
  DISCOVERY_HARD_LIMITS,
  type DiscoveryModuleBudget,
} from "../lib/discovery/config"
import { rankDiscoveryCandidates } from "../lib/discovery/ranking"
import { fetchRssFeed, type RssFetchResult } from "../lib/discovery/rss"
import {
  DiscoveryLimitError,
  DiscoveryRepository,
  EXECUTION_SCHEMA_VERSION,
  parseStored,
  shanghaiDay,
  type DiscoveryJob,
  type DiscoveryLease,
} from "../lib/discovery/repository"
import { resolveDiscoveryEnabled } from "../lib/discovery/settings"
import {
  SourceFetchError,
  type DiscoveryCandidate,
  type DiscoveryConfig,
  type DiscoveryRequestKind,
  type GithubPoolMember,
  type SourceFetchContext,
} from "../lib/discovery/types"

export const DISCOVERY_CRON = "5-55/10 * * * *"
export const BUSINESS_CRON = "*/10 * * * *"
export type DiscoveryRoundOptions = {
  now?: Date | number
  fetcher?: typeof fetch
  /** Tests can install a complete snapshot; real resumes always use the stored snapshot. */
  config?: DiscoveryConfig
  clock?: () => Date
}
export type DiscoveryRoundResult = {
  day: string
  partition: string | null
  requests: number
  statements: number
  elapsedMs: number
  rowsRead: number
  rowsWritten: number
  outcome: string
  phase: string | null
  candidatesWritten: number
  identityConflicts: number
}
type GithubCursor = {
  queryIndex?: number
  search?: DiscoveryCandidate[]
  searchCompact?: GithubCompact[]
  detailCompact?: GithubCompact[]
  pool?: GithubPoolMember[]
  poolIndex?: number
  candidates?: DiscoveryCandidate[]
  persisted?: number
}
type HnCursor = {
  lists?: number[][]
  ids?: number[]
  index?: number
  persisted?: number
}
type RssCompact = {
  candidates: RssTuple[]
  etag: string | null
  lastModified: string | null
  notModified: boolean
}
type RssCursor = {
  rss?: RssFetchResult
  rssCompact?: RssCompact
  persisted?: number
}
type GithubCompact = [
  number,
  CursorText,
  CursorText | null,
  CursorText,
  string,
  string | null,
  number,
  number,
]
type RssTuple = [
  CursorText,
  CursorText,
  CursorText | null,
  CursorText,
  DiscoveryChannelId[],
  string,
  string | null,
]
type CursorText = string | [text: string, alphabet: string]
/** Avoid JSON's escaping expansion without losing source text or truncating candidates. */
function packCursorText(text: string): CursorText {
  if (!/["\\]/u.test(text)) return text
  const used = new Set(text),
    alphabet: string[] = []
  for (let code = 0xe000; alphabet.length < 2 && code <= 0xf8ff; code++) {
    const character = String.fromCharCode(code)
    if (!used.has(character)) alphabet.push(character)
  }
  if (alphabet.length !== 2) throw new Error("CURSOR_TEXT_ALPHABET_EXHAUSTED")
  return [
    text.replace(
      /["\\]/gu,
      (character) => alphabet[character === '"' ? 0 : 1]!
    ),
    alphabet.join(""),
  ]
}
function unpackCursorText(value: CursorText): string {
  if (typeof value === "string") return value
  const [text, alphabet] = value
  return text.replace(/[\ue000-\uf8ff]/gu, (character) =>
    character === alphabet[0]
      ? '"'
      : character === alphabet[1]
        ? "\\"
        : character
  )
}
function packGithub(candidate: DiscoveryCandidate): GithubCompact {
  return [
    candidate.githubRepoId!,
    packCursorText(candidate.title),
    candidate.summary === null ? null : packCursorText(candidate.summary),
    packCursorText(candidate.canonicalUrl),
    candidate.observedAt,
    candidate.publishedAt,
    candidate.evidence.stars!,
    candidate.evidence.position ?? 0,
  ]
}
function unpackGithub(
  tuple: GithubCompact,
  channel: DiscoveryChannelId
): DiscoveryCandidate {
  const [
    id,
    titleText,
    summaryText,
    urlText,
    observedAt,
    publishedAt,
    stars,
    position,
  ] = tuple
  const title = unpackCursorText(titleText),
    summary = summaryText === null ? null : unpackCursorText(summaryText),
    url = unpackCursorText(urlText)
  return {
    externalId: String(id),
    source: "github",
    sourceId: "github",
    title,
    summary,
    url,
    canonicalUrl: url,
    bookmarkSourceType: "github",
    githubRepoId: id,
    channels: [channel],
    observedAt,
    publishedAt,
    evidence: {
      source: "github",
      sourceId: "github",
      url,
      observedAt,
      publishedAt,
      stars,
      position,
      growth: null,
      previousObservedAt: null,
    },
  }
}
function githubSearch(cursor: GithubCursor, channel: DiscoveryChannelId) {
  return (
    cursor.searchCompact?.map((tuple) => unpackGithub(tuple, channel)) ??
    cursor.search ??
    []
  )
}
function githubDetails(cursor: GithubCursor, channel: DiscoveryChannelId) {
  return (
    cursor.detailCompact?.map((tuple) => unpackGithub(tuple, channel)) ??
    cursor.candidates ??
    []
  )
}
function compactGithubCursor(
  cursor: GithubCursor,
  search: DiscoveryCandidate[],
  details: DiscoveryCandidate[]
): GithubCursor {
  const result = {
    ...cursor,
    searchCompact: search.map(packGithub),
    detailCompact: details.map(packGithub),
  }
  delete result.search
  delete result.candidates
  return result
}
function packRss(rss: RssFetchResult): RssCompact {
  return {
    ...rss,
    candidates: rss.candidates.map((c) => [
      packCursorText(c.externalId),
      packCursorText(c.title),
      c.summary === null ? null : packCursorText(c.summary),
      packCursorText(c.canonicalUrl),
      c.channels,
      c.observedAt,
      c.publishedAt,
    ]),
  }
}
function previousRss(
  cursor: RssCursor,
  sourceId: string
): RssFetchResult | undefined {
  if (!cursor.rssCompact) return cursor.rss
  return {
    ...cursor.rssCompact,
    candidates: cursor.rssCompact.candidates.map(
      ([
        externalIdText,
        titleText,
        summaryText,
        urlText,
        channels,
        observedAt,
        publishedAt,
      ]) => {
        const externalId = unpackCursorText(externalIdText),
          title = unpackCursorText(titleText),
          summary = summaryText === null ? null : unpackCursorText(summaryText),
          url = unpackCursorText(urlText)
        return {
          externalId,
          title,
          summary,
          url,
          canonicalUrl: url,
          source: "rss",
          sourceId,
          bookmarkSourceType:
            new URL(url).hostname === "github.com" ? "github" : "url",
          githubRepoId: null,
          channels,
          observedAt,
          publishedAt,
          evidence: { source: "rss", sourceId, url, observedAt, publishedAt },
        }
      }
    ),
  }
}

function partitions(config: DiscoveryConfig) {
  return [
    ...DISCOVERY_CHANNEL_IDS.map((channel) => ({
      key: `github:${channel}`,
      kind: "github",
    })),
    { key: "hn", kind: "hn" },
    ...enabledDiscoveryFeeds(config).map((feed) => ({
      key: `rss:${feed.id}`,
      kind: "rss",
    })),
    ...DISCOVERY_CHANNEL_IDS.map((channel) => ({
      key: `publish:${channel}`,
      kind: "publish",
    })),
    { key: "cleanup", kind: "cleanup" },
  ]
}
function dependencies(channel: DiscoveryChannelId, config: DiscoveryConfig) {
  return [
    `github:${channel}`,
    "hn",
    ...enabledDiscoveryFeeds(config)
      .filter((feed) => feed.channels.includes(channel))
      .map((feed) => `rss:${feed.id}`),
  ]
}
function runnable(job: DiscoveryJob, now: Date) {
  return (
    ["pending", "running"].includes(job.state) &&
    (!job.lease_until || job.lease_until <= now.toISOString()) &&
    (!job.next_retry_at || job.next_retry_at <= now.toISOString())
  )
}
function selectJob(
  jobs: DiscoveryJob[],
  configs: Map<string, DiscoveryConfig | null>,
  now: Date
) {
  // Publication becomes runnable as soon as its own dependencies terminate.
  const publish = jobs.find(
    (job) =>
      job.kind === "publish" &&
      runnable(job, now) &&
      !!configs.get(job.id) &&
      dependencies(
        job.partition_key.slice(8) as DiscoveryChannelId,
        configs.get(job.id)!
      ).every((key) =>
        jobs.some(
          (source) =>
            source.partition_key === key &&
            ["succeeded", "failed"].includes(source.state)
        )
      )
  )
  if (publish) return publish
  const sources = jobs.filter(
    (job) =>
      !!configs.get(job.id) &&
      ["github", "hn", "rss"].includes(job.kind) &&
      runnable(job, now)
  )
  const githubSearch = sources.find(
    (job) =>
      job.kind === "github" &&
      (parseStored<GithubCursor>(job.cursor_json, {}).queryIndex ?? 0) < 4
  )
  if (githubSearch) return githubSearch
  // All search data is available before selecting pools and performing global-ID detail dedup.
  if (sources.length) return sources[0]
  if (
    jobs
      .filter((job) => job.kind === "publish")
      .every((job) => ["succeeded", "failed"].includes(job.state))
  )
    return jobs.find((job) => job.kind === "cleanup" && runnable(job, now))
  return undefined
}
async function parallelMap<T, R>(
  items: T[],
  limit: number,
  callback: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const failures: unknown[] = []
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        try {
          results[index] = await callback(items[index]!, index)
        } catch (error) {
          failures.push(error)
          break
        }
      }
    })
  )
  if (failures.length) throw failures[0]
  return results
}

/** One bounded durable piece per invocation, including explicit resource diagnostics. */
export async function runDiscoveryScheduled(
  env: Env,
  options: DiscoveryRoundOptions = {}
): Promise<DiscoveryRoundResult> {
  const wallStarted = Date.now(),
    initial =
      options.now instanceof Date
        ? options.now
        : new Date(options.now ?? Date.now())
  const clock =
    options.clock ??
    (() => new Date(initial.getTime() + Date.now() - wallStarted))
  const day = shanghaiDay(clock()),
    repo = new DiscoveryRepository(env.DB, clock, 40)
  const result: DiscoveryRoundResult = {
    day,
    partition: null,
    requests: 0,
    statements: 0,
    elapsedMs: 0,
    rowsRead: 0,
    rowsWritten: 0,
    outcome: "disabled",
    phase: null,
    candidatesWritten: 0,
    identityConflicts: 0,
  }
  let module: DiscoveryLease | null = null,
    lease: DiscoveryLease | null = null,
    job: DiscoveryJob | undefined
  const credits = new Map<DiscoveryRequestKind, number>()
  let searchRequests = 0,
    mutex = Promise.resolve()
  let limits = { ...DISCOVERY_HARD_LIMITS }
  let persistenceReserve = 3
  const beforeRequest: SourceFetchContext["beforeRequest"] = (kind) => {
    const next = mutex.then(async () => {
      if (shanghaiDay(clock()) !== day)
        throw new DiscoveryLimitError("MIDNIGHT_STOP")
      if (Date.now() - wallStarted >= 60000)
        throw new DiscoveryLimitError("ROUND_DEADLINE")
      if (job && clock().toISOString() >= job.deadline_at)
        throw new DiscoveryLimitError("DISCOVERY_DEADLINE")
      if (result.requests >= limits.requestsPerRound)
        throw new DiscoveryLimitError("ROUND_REQUEST_BUDGET")
      if (
        kind === "github-search" &&
        searchRequests >= limits.githubSearchesPerRound
      )
        throw new DiscoveryLimitError("ROUND_SEARCH_BUDGET")
      if ((credits.get(kind) ?? 0) === 0) {
        const desired =
          kind === "github-search"
            ? 4
            : kind === "hn-list"
              ? 2
              : kind === "rss"
                ? 3
                : 5
        const size = Math.min(
          desired,
          limits.requestsPerRound - result.requests,
          kind === "github-search"
            ? limits.githubSearchesPerRound - searchRequests
            : 5
        )
        const hard =
          kind === "github-search"
            ? limits.githubSearchesPerDay
            : kind === "github-detail"
              ? limits.githubDetailsPerDay
              : limits.requestsPerDay
        if (repo.statements >= repo.maxStatements - persistenceReserve)
          throw new DiscoveryLimitError("D1_ROUND_BUDGET")
        const reserved = await repo.reserveRequests(
          module!,
          size,
          kind,
          hard,
          limits.requestsPerDay
        )
        credits.set(kind, reserved)
      }
      credits.set(kind, credits.get(kind)! - 1)
      result.requests++
      if (kind === "github-search") searchRequests++
    })
    mutex = next.catch(() => undefined)
    return next
  }
  try {
    const { settingValue, module: existingModule } = await repo.moduleState(day)
    if (!resolveDiscoveryEnabled(settingValue, env.DISCOVERY_ENABLED))
      return result
    const currentConfig = validateDiscoveryConfig(
      options.config ?? DISCOVERY_CONFIG
    )
    let actualBudget: DiscoveryModuleBudget | null = existingModule
      ? parseModuleBudget(
          existingModule.config_snapshot_json,
          existingModule.execution_schema_version
        )
      : currentConfig
        ? moduleBudget(currentConfig)
        : null
    if (!actualBudget && !existingModule) {
      result.outcome = "RULE_VERSION_UNSUPPORTED"
      return result
    }
    if (actualBudget)
      repo.maxStatements = actualBudget.budgets.d1StatementsPerRound
    module = await repo.acquireModule(
      day,
      actualBudget ?? moduleBudget(DISCOVERY_CONFIG),
      !!existingModule
    )
    if (!module) {
      result.outcome =
        existingModule?.error_code === "RULE_VERSION_UNSUPPORTED"
          ? "RULE_VERSION_UNSUPPORTED"
          : "locked"
      return result
    }
    actualBudget = module.budgetSnapshot ?? null
    if (!actualBudget) {
      await repo.rejectModule(module)
      result.outcome = "RULE_VERSION_UNSUPPORTED"
      return result
    }
    repo.maxStatements = actualBudget.budgets.d1StatementsPerRound
    const hour = (clock().getUTCHours() + 8) % 24
    let workDay = await repo.latestResumableDay()
    if (hour >= 8) {
      if (workDay !== day)
        await repo.ensureDailyJobs(
          day,
          currentConfig,
          currentConfig?.ruleVersion ?? "unsupported",
          currentConfig ? partitions(currentConfig) : [],
          module
        )
      workDay = workDay && workDay < day ? workDay : day
    }
    if (!workDay) {
      result.outcome = "before-start"
      return result
    }
    const jobs = await repo.jobs(workDay)
    const cache = new Map<string, DiscoveryConfig | null>(
        currentConfig ? [[JSON.stringify(currentConfig), currentConfig]] : []
      ),
      configs = new Map<string, DiscoveryConfig | null>()
    for (const candidate of jobs) {
      if (!cache.has(candidate.config_snapshot_json))
        cache.set(
          candidate.config_snapshot_json,
          parseDiscoveryConfig(candidate.config_snapshot_json)
        )
      const parsed = cache.get(candidate.config_snapshot_json) ?? null
      const partitionValid =
        parsed &&
        partitions(parsed).some(
          (partition) =>
            partition.key === candidate.partition_key &&
            partition.kind === candidate.kind
        )
      configs.set(
        candidate.id,
        candidate.execution_schema_version === EXECUTION_SCHEMA_VERSION &&
          parsed?.ruleVersion === candidate.rule_version &&
          partitionValid
          ? parsed
          : null
      )
    }
    // Reject malformed snapshots before dependencies or task selection can dereference them.
    const invalid = jobs.find(
      (candidate) =>
        !configs.get(candidate.id) &&
        ["pending", "running"].includes(candidate.state) &&
        (!candidate.lease_until ||
          candidate.lease_until <= clock().toISOString())
    )
    if (invalid) {
      job = invalid
      result.partition = job.partition_key
      lease = await repo.claim(job, module, true)
      if (lease) {
        await repo.checkpoint(lease, {
          state: "failed",
          errorCode: "RULE_VERSION_UNSUPPORTED",
        })
        lease = null
      }
      result.outcome = "RULE_VERSION_UNSUPPORTED"
      return result
    }
    const first = jobs[0]
    const round = await repo.incrementRound(module, workDay)
    if (
      first &&
      clock().toISOString() >= first.deadline_at &&
      jobs.some(
        (candidate) =>
          candidate.kind !== "cleanup" &&
          ["pending", "running"].includes(candidate.state)
      )
    ) {
      await repo.expireEdition(module, workDay)
      result.outcome = "DISCOVERY_DEADLINE"
      return result
    }
    if (
      first &&
      (round >= 32 ||
        clock().getTime() >= Date.parse(first.deadline_at) - 50 * 60000) &&
      jobs.some(
        (source) =>
          ["github", "hn", "rss"].includes(source.kind) &&
          ["pending", "running"].includes(source.state)
      )
    ) {
      await repo.terminateSources(module, workDay, "COLLECTION_DEADLINE")
      result.outcome = "COLLECTION_DEADLINE"
      return result
    }
    job = selectJob(jobs, configs, clock())
    if (!job) {
      result.outcome = jobs.length
        ? "idle"
        : currentConfig
          ? "idle"
          : "RULE_VERSION_UNSUPPORTED"
      return result
    }
    result.partition = job.partition_key
    result.phase =
      job.kind === "github"
        ? (parseStored<GithubCursor>(job.cursor_json, {}).queryIndex ?? 0) < 4
          ? "search"
          : "pool"
        : job.kind === "hn"
          ? parseStored<HnCursor>(job.cursor_json, {}).ids
            ? "items"
            : "lists"
          : job.kind
    const snapshot = executionConfig(configs.get(job.id)!, actualBudget)
    limits = snapshot.budgets
    repo.maxStatements = Math.min(
      repo.maxStatements,
      limits.d1StatementsPerRound
    )
    if (repo.statements + 3 > repo.maxStatements)
      throw new DiscoveryLimitError("D1_ROUND_BUDGET")
    lease = await repo.claim(job, module)
    if (!lease) {
      result.outcome = "locked"
      return result
    }
    const context: SourceFetchContext = {
      now: clock(),
      fetch: options.fetcher,
      beforeRequest,
    }
    if (job.kind === "github") {
      // resolveGithubToken performs one settings query; reserve it in the same D1 accounting.
      if (repo.statements >= repo.maxStatements - 3)
        throw new DiscoveryLimitError("D1_ROUND_BUDGET")
      const token =
        (await resolveGithubToken(createDb({ DB: repo.countedDb }), env)) ??
        undefined
      const channel = job.partition_key.slice(7) as DiscoveryChannelId
      const cursor = parseStored<GithubCursor>(job.cursor_json, {})
      if ((cursor.queryIndex ?? 0) < 4) {
        const queries = Array.from(
          {
            length: Math.min(
              4 - (cursor.queryIndex ?? 0),
              limits.githubSearchesPerRound,
              limits.requestsPerRound
            ),
          },
          (_, index) => index + (cursor.queryIndex ?? 0)
        )
        const results = await parallelMap(
          queries,
          limits.concurrentRequests,
          (index) => fetchGithubSearch(snapshot, channel, index, context, token)
        )
        const search = [...githubSearch(cursor, channel), ...results.flat()]
        await repo.checkpoint(lease, {
          cursor: compactGithubCursor(
            {
              ...cursor,
              queryIndex: (cursor.queryIndex ?? 0) + queries.length,
            },
            search,
            githubDetails(cursor, channel)
          ),
          requests: result.requests,
        })
      } else {
        persistenceReserve = 7
        const previous = await repo.previousGithubPools(job.edition_day)
        const globalPools = new Map<string, GithubPoolMember[]>()
        for (const sourceJob of jobs.filter(
          (source) => source.kind === "github" && !!configs.get(source.id)
        )) {
          const sourceCursor = parseStored<GithubCursor>(
              sourceJob.cursor_json,
              {}
            ),
            sourceChannel = sourceJob.partition_key.slice(
              7
            ) as DiscoveryChannelId
          const config = executionConfig(
            configs.get(sourceJob.id)!,
            actualBudget
          )
          globalPools.set(
            sourceJob.id,
            sourceCursor.pool ??
              selectGithubPool(
                parseStored<GithubPoolMember[]>(
                  previous.find(
                    (pool) => pool.partition_key === sourceJob.partition_key
                  )?.pool_state_json ?? "[]",
                  []
                ),
                githubSearch(sourceCursor, sourceChannel),
                sourceJob.edition_day,
                config.github.poolPerChannel
              )
          )
        }
        const pool = globalPools.get(job.id) ?? []
        const neededIds = new Set(
          [...globalPools.values()].flat().map((member) => member.githubRepoId)
        )
        const search = githubSearch(cursor, channel).filter((candidate) =>
          neededIds.has(candidate.githubRepoId!)
        )
        const details = githubDetails(cursor, channel).filter((candidate) =>
          neededIds.has(candidate.githubRepoId!)
        )
        if (!cursor.pool && repo.maxStatements - repo.statements < 8) {
          await repo.checkpoint(lease, {
            cursor: compactGithubCursor(
              { ...cursor, pool, poolIndex: 0 },
              search,
              details
            ),
            pool,
            state: "pending",
          })
          lease = null
          result.outcome = "advanced"
          return result
        }
        const allGithub = jobs
          .filter((source) => source.kind === "github")
          .flatMap((source) => {
            const c = parseStored<GithubCursor>(source.cursor_json, {}),
              channel = source.partition_key.slice(7) as DiscoveryChannelId
            return [...githubSearch(c, channel), ...githubDetails(c, channel)]
          })
        const index = cursor.poolIndex ?? 0
        // One reservation covers five details. Keep enough statements for the
        // largest identity merge plus both task and module finalization writes.
        const detailCapacity =
          Math.max(
            0,
            repo.maxStatements - repo.statements - persistenceReserve
          ) * 5
        let detailsNeeded = 0
        const members: GithubPoolMember[] = []
        for (const member of pool.slice(
          index,
          index + Math.min(limits.pieceSize, limits.requestsPerRound)
        )) {
          const needsDetail =
            !!token &&
            !allGithub.some(
              (candidate) => candidate.githubRepoId === member.githubRepoId
            )
          if (needsDetail && detailsNeeded >= detailCapacity) break
          members.push(member)
          if (needsDetail) detailsNeeded++
        }
        if (!members.length && index < pool.length)
          throw new DiscoveryLimitError("D1_ROUND_BUDGET")
        const candidates = (
          await parallelMap(
            members,
            limits.concurrentRequests,
            async (member) => {
              const cached = allGithub.find(
                (c) => c.githubRepoId === member.githubRepoId
              )
              const candidate =
                cached ??
                (token
                  ? await fetchGithubRepository(
                      member.githubRepoId,
                      context,
                      token,
                      channel
                    )
                  : null)
              return candidate ? { ...candidate, channels: [channel] } : null
            }
          )
        ).filter((c): c is DiscoveryCandidate => c !== null)
        const written = await repo.persistCandidates(job, lease, candidates)
        result.candidatesWritten = written.persisted
        result.identityConflicts = written.conflicts
        const poolIndex = index + members.length,
          persisted = (cursor.persisted ?? 0) + result.candidatesWritten
        await repo.checkpoint(lease, {
          cursor: compactGithubCursor(
            { ...cursor, pool, poolIndex, persisted },
            search,
            [
              ...details,
              ...candidates.filter(
                (candidate) =>
                  !allGithub.some(
                    (c) => c.githubRepoId === candidate.githubRepoId
                  )
              ),
            ]
          ),
          pool,
          state: poolIndex >= pool.length ? "succeeded" : "pending",
          requests: result.requests,
        })
      }
    } else if (job.kind === "hn") {
      const cursor = parseStored<HnCursor>(job.cursor_json, {})
      if (!cursor.ids) {
        const lists = cursor.lists ?? []
        const names = (["topstories", "beststories"] as const).slice(
          lists.length,
          lists.length + Math.min(2 - lists.length, limits.requestsPerRound)
        )
        const results = await parallelMap(
          names,
          limits.concurrentRequests,
          (name) => fetchHnStoryIds(name, context)
        )
        const merged = [...lists, ...results]
        const ids =
          merged.length === 2
            ? [...new Set(merged.flat())].slice(0, limits.hnCandidates)
            : undefined
        await repo.checkpoint(lease, {
          cursor: {
            lists: merged,
            ...(ids ? { ids, index: 0, persisted: 0 } : {}),
          },
          state: ids && !ids.length ? "succeeded" : "pending",
          requests: result.requests,
        })
      } else {
        persistenceReserve = 5
        const index = cursor.index ?? 0,
          ids = cursor.ids.slice(
            index,
            index + Math.min(limits.pieceSize, limits.requestsPerRound)
          )
        const candidates = (
          await parallelMap(ids, limits.concurrentRequests, (id, offset) =>
            fetchHnItem(id, index + offset, context, snapshot)
          )
        ).filter((c): c is DiscoveryCandidate => c !== null)
        const written = await repo.persistCandidates(job, lease, candidates)
        result.candidatesWritten = written.persisted
        result.identityConflicts = written.conflicts
        const next = index + ids.length
        await repo.checkpoint(lease, {
          cursor: {
            ...cursor,
            index: next,
            persisted: (cursor.persisted ?? 0) + result.candidatesWritten,
          },
          state: next >= cursor.ids.length ? "succeeded" : "pending",
          requests: result.requests,
        })
      }
    } else if (job.kind === "rss") {
      persistenceReserve = 5
      const feed = enabledDiscoveryFeeds(snapshot).find(
        (f) => `rss:${f.id}` === job!.partition_key
      )
      if (!feed) throw new SourceFetchError("RSS_ORDER_UNVERIFIED")
      const prior = await repo.previousPool(job.partition_key, job.edition_day)
      const previous = prior
        ? previousRss(parseStored<RssCursor>(prior.cursor_json, {}), feed.id)
        : undefined
      const rss = await fetchRssFeed(feed, context, previous, snapshot)
      const candidates = rss.candidates.filter(
        (c) =>
          c.publishedAt &&
          clock().getTime() - Date.parse(c.publishedAt) <= 7 * 86400000
      )
      const written = await repo.persistCandidates(job, lease, candidates)
      result.candidatesWritten = written.persisted
      result.identityConflicts = written.conflicts
      await repo.checkpoint(lease, {
        cursor: {
          rssCompact: packRss(rss),
          persisted: result.candidatesWritten,
        },
        state: "succeeded",
        requests: result.requests,
      })
    } else if (job.kind === "publish") {
      const channel = job.partition_key.slice(8) as DiscoveryChannelId
      const { selected, statuses } = await repo.selectedSources(
        job.edition_day,
        dependencies(channel, snapshot)
      )
      const currentSuccess = selected.some(
        (source) => source.edition_day === job!.edition_day
      )
      if (!currentSuccess) {
        await repo.checkpoint(lease, {
          state: "failed",
          errorCode: "ALL_SOURCES_FAILED",
        })
        result.outcome = "failed"
      } else {
        const rows = await repo.candidatesForJobs(selected)
        const candidates = rows
          .map((row) => ({
            ...parseStored<DiscoveryCandidate>(
              row.candidate_json,
              {} as DiscoveryCandidate
            ),
            itemId: row.item_id,
          }))
          .filter(
            (candidate) =>
              candidate.source === "github" ||
              (!!candidate.publishedAt &&
                clock().getTime() - Date.parse(candidate.publishedAt) <=
                  7 * 86400000)
          )
        for (let index = 0; index < statuses.length; index++) {
          const selectedJob = selected.find(
            (j) => j.partition_key === dependencies(channel, snapshot)[index]
          )
          if (
            selectedJob?.edition_day === job.edition_day &&
            parseStored<{ persisted?: number }>(selectedJob.cursor_json, {})
              .persisted === 0
          )
            statuses[index]!.state = "empty"
        }
        const items: DiscoveryItem[] = rankDiscoveryCandidates(
          candidates,
          channel,
          limits.maxItems,
          snapshot
        ).map((candidate) => ({
          id: candidate.itemId!,
          title: candidate.title,
          summary: candidate.summary,
          url: candidate.canonicalUrl,
          sourceType: candidate.bookmarkSourceType,
          rank: candidate.rank,
          publishedAt: candidate.publishedAt,
          evidence: candidate.evidence,
        }))
        await repo.publish(job, lease, channel, items, statuses, selected)
        await repo.checkpoint(lease, { state: "succeeded" })
      }
    } else if (job.kind === "cleanup") {
      await repo.cleanup(module)
      await repo.checkpoint(lease, { state: "succeeded" })
    }
    lease = null
    if (result.outcome !== "failed") result.outcome = "advanced"
  } catch (error) {
    const code =
      error instanceof SourceFetchError
        ? error.errorCode
        : error instanceof DiscoveryLimitError
          ? error.code
          : "DISCOVERY_INTERNAL_ERROR"
    result.outcome = code
    if (job && lease && repo.statements < repo.maxStatements - 1) {
      const attempts = job.attempts + 1
      const retryable =
        (error instanceof SourceFetchError && error.retryable) ||
        (error instanceof DiscoveryLimitError &&
          [
            "MIDNIGHT_STOP",
            "ROUND_DEADLINE",
            "ROUND_REQUEST_BUDGET",
            "ROUND_SEARCH_BUDGET",
            "D1_ROUND_BUDGET",
          ].includes(error.code))
      const retryAt =
        error instanceof SourceFetchError && error.retryAt
          ? error.retryAt
          : new Date(
              clock().getTime() +
                Math.min(3600000, 600000 * 2 ** Math.min(3, attempts - 1))
            ).toISOString()
      await repo
        .checkpoint(lease, {
          state: retryable && attempts <= 3 ? "pending" : "failed",
          attempts,
          retryAt: retryable && attempts <= 3 ? retryAt : null,
          errorCode: code,
          requests: result.requests,
        })
        .catch(() => undefined)
    }
    console.warn("[discovery]", {
      day,
      partition: job?.partition_key,
      errorCode: code,
    })
  } finally {
    if (module && repo.statements < repo.maxStatements)
      await repo.releaseModule(module).catch(() => undefined)
    result.statements = repo.statements
    result.elapsedMs = Date.now() - wallStarted
    result.rowsRead = repo.rowsRead
    result.rowsWritten = repo.rowsWritten
    console.info("[discovery]", result)
  }
  return result
}
