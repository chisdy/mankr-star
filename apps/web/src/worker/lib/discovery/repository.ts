import {
  DISCOVERY_CHANNEL_IDS,
  discoveryResponseSchema,
  type DiscoveryChannelId,
  type DiscoveryEvidence,
  type DiscoveryItem,
  type DiscoveryResponse,
  type DiscoverySourceStatus,
} from "@mankr/shared"
import type { DiscoveryCandidate } from "./types"
import { githubGrowth } from "./github"
import { DISCOVERY_CONFIG } from "./channels"
import {
  DISCOVERY_EXECUTION_VERSION,
  moduleBudget,
  parseModuleBudget,
  type DiscoveryModuleBudget,
} from "./config"

export const EXECUTION_SCHEMA_VERSION = DISCOVERY_EXECUTION_VERSION
export type DiscoveryJob = {
  id: string
  edition_day: string
  partition_key: string
  kind: string
  rule_version: string
  execution_schema_version: number
  config_snapshot_json: string
  pool_state_json: string
  cursor_json: string
  state: string
  request_count: number
  attempts: number
  next_retry_at: string | null
  lease_token: string | null
  lease_until: string | null
  error_code: string | null
  started_at: string
  deadline_at: string
  finished_at: string | null
  updated_at: string
}
export type DiscoveryLease = {
  jobId: string
  token: string
  moduleId: string
  moduleToken: string
  budgetSnapshot?: DiscoveryModuleBudget | null
}
type ItemRow = {
  id: string
  canonical_url: string | null
  github_repo_id: number | null
  merged_into_id: string | null
  aliases_json: string
}
export class DiscoveryLimitError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}
export function shanghaiDay(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10)
}
export function discoveryEnabled(value: string | undefined): boolean {
  return value === "true"
}
export function parseStored<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/** Every statement, including every batch member, is counted before dispatch. */
export class DiscoveryRepository {
  statements = 0
  rowsRead = 0
  rowsWritten = 0
  maxStatements: number
  constructor(
    readonly db: D1Database,
    readonly clock: () => Date = () => new Date(),
    maxStatements = 40
  ) {
    this.maxStatements = maxStatements
  }
  /** Existing Drizzle helpers use raw(); adapt that read through all() to retain native metadata. */
  get countedDb(): D1Database {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get: (target, property) => {
          if (property === "bind")
            return (...values: unknown[]) => wrap(target.bind(...values))
          if (["all", "run", "raw", "first"].includes(String(property)))
            return async (options?: unknown) => {
              this.count()
              const result =
                property === "run"
                  ? await target.run()
                  : await target.all<Record<string, unknown>>()
              this.record(result)
              if (property === "raw") {
                const rows = result.results.map((row) => Object.values(row))
                return typeof options === "object" &&
                  options !== null &&
                  "columnNames" in options &&
                  options.columnNames
                  ? [Object.keys(result.results[0] ?? {}), ...rows]
                  : rows
              }
              if (property === "first")
                return typeof options === "string"
                  ? (result.results[0]?.[options] ?? null)
                  : (result.results[0] ?? null)
              return result
            }
          const value = Reflect.get(target, property)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    return new Proxy(this.db, {
      get: (target, property) => {
        if (property === "prepare")
          return (query: string) => wrap(target.prepare(query))
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }
  private record(result: D1Result) {
    this.rowsRead += result.meta.rows_read ?? 0
    this.rowsWritten += result.meta.rows_written ?? 0
  }
  private count(n = 1) {
    if (this.statements + n > this.maxStatements)
      throw new DiscoveryLimitError("D1_ROUND_BUDGET")
    this.statements += n
  }
  /** Budget the complete atomic phase before its reads, retaining both finalizers. */
  requireStatements(n: number) {
    if (this.statements + n > this.maxStatements)
      throw new DiscoveryLimitError("D1_ROUND_BUDGET")
  }
  async all<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    this.count()
    const result = await this.db
      .prepare(sql)
      .bind(...values)
      .all<T>()
    this.record(result)
    return result.results
  }
  async first<T>(sql: string, values: unknown[] = []): Promise<T | null> {
    this.count()
    const result = await this.db
      .prepare(sql)
      .bind(...values)
      .all<T>()
    this.record(result)
    return result.results[0] ?? null
  }
  async run(sql: string, values: unknown[] = []) {
    this.count()
    const result = await this.db
      .prepare(sql)
      .bind(...values)
      .run()
    this.record(result)
    return result
  }
  async batch(statements: { sql: string; values: unknown[] }[]) {
    this.count(statements.length)
    const results = await this.db.batch(
      statements.map(({ sql, values }) => this.db.prepare(sql).bind(...values))
    )
    for (const result of results) this.record(result)
    return results
  }
  private guard(lease: DiscoveryLease) {
    return {
      sql: "EXISTS (SELECT 1 FROM discovery_sync_jobs j, discovery_sync_jobs b WHERE j.id=? AND j.lease_token=? AND j.lease_until>? AND j.state='running' AND b.id=? AND b.lease_token=? AND b.lease_until>? AND b.edition_day=?)",
      args: [
        lease.jobId,
        lease.token,
        this.clock().toISOString(),
        lease.moduleId,
        lease.moduleToken,
        this.clock().toISOString(),
        shanghaiDay(this.clock()),
      ],
    }
  }
  moduleJob(day: string) {
    return this.first<DiscoveryJob>(
      "SELECT * FROM discovery_sync_jobs WHERE edition_day=? AND partition_key='__budget__'",
      [day]
    )
  }
  /** Read the switch with the existing module lookup to preserve the 16-statement budget. */
  async moduleState(day: string) {
    const row = await this.first<
      DiscoveryJob & { setting_value: string | null }
    >(
      "SELECT j.*, (SELECT value FROM settings WHERE key='discovery') AS setting_value FROM (SELECT 1) LEFT JOIN discovery_sync_jobs j ON j.edition_day=? AND j.partition_key='__budget__'",
      [day]
    )
    const { setting_value: settingValue, ...module } = row!
    return { settingValue, module: module.id ? module : null }
  }
  async acquireModule(
    day: string,
    snapshot: DiscoveryModuleBudget = moduleBudget(DISCOVERY_CONFIG),
    existing = false
  ): Promise<DiscoveryLease | null> {
    const now = this.clock().toISOString(),
      id = `discovery:${day}:__budget__`,
      token = crypto.randomUUID(),
      until = new Date(this.clock().getTime() + 120000).toISOString()
    const result = existing
      ? await this.all<{
          config_snapshot_json: string
          execution_schema_version: number
        }>(
          "UPDATE discovery_sync_jobs SET lease_token=?,lease_until=?,state='running',updated_at=? WHERE id=? AND state!='failed' AND (lease_until IS NULL OR lease_until<=?) RETURNING config_snapshot_json,execution_schema_version",
          [token, until, now, id, now]
        )
      : await this.all<{
          config_snapshot_json: string
          execution_schema_version: number
        }>(
          "INSERT INTO discovery_sync_jobs(id,edition_day,partition_key,kind,rule_version,execution_schema_version,config_snapshot_json,started_at,deadline_at,updated_at,lease_token,lease_until,state) VALUES(?,?,'__budget__','budget',?,?,?,?,?,?,?,?,'running') ON CONFLICT(edition_day,partition_key) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,state='running',updated_at=excluded.updated_at WHERE discovery_sync_jobs.state!='failed' AND (discovery_sync_jobs.lease_until IS NULL OR discovery_sync_jobs.lease_until<=excluded.updated_at) RETURNING config_snapshot_json,execution_schema_version",
          [
            id,
            day,
            snapshot.ruleVersion,
            EXECUTION_SCHEMA_VERSION,
            JSON.stringify(snapshot),
            now,
            now,
            now,
            token,
            until,
          ]
        )
    return result.length
      ? {
          jobId: id,
          token,
          moduleId: id,
          moduleToken: token,
          budgetSnapshot: parseModuleBudget(
            result[0]!.config_snapshot_json,
            result[0]!.execution_schema_version
          ),
        }
      : null
  }
  async rejectModule(module: DiscoveryLease) {
    await this.run(
      "UPDATE discovery_sync_jobs SET state='failed',error_code='RULE_VERSION_UNSUPPORTED',lease_token=NULL,lease_until=NULL,finished_at=? WHERE id=? AND lease_token=? AND lease_until>?",
      [
        this.clock().toISOString(),
        module.moduleId,
        module.moduleToken,
        this.clock().toISOString(),
      ]
    )
  }
  async releaseModule(lease: DiscoveryLease) {
    await this.run(
      "UPDATE discovery_sync_jobs SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
      [lease.moduleId, lease.moduleToken]
    )
  }
  async reserveRequests(
    lease: DiscoveryLease,
    count: number,
    kind = "all",
    maxKind = 320,
    maxDay = 320
  ): Promise<number> {
    if (!Number.isInteger(count) || count < 1 || count > 5)
      throw new DiscoveryLimitError("INVALID_RESERVATION")
    const kindCeiling =
      kind === "github-search" ? 16 : kind === "github-detail" ? 80 : 320
    maxDay = Math.min(320, maxDay)
    maxKind = Math.min(kindCeiling, maxKind)
    const path = `$."${kind}"`,
      moduleKindPath =
        kind === "github-search"
          ? "$.budgets.githubSearchesPerDay"
          : kind === "github-detail"
            ? "$.budgets.githubDetailsPerDay"
            : "$.budgets.requestsPerDay"
    const dayLimit =
      "MIN(?,COALESCE(json_extract(config_snapshot_json,'$.budgets.requestsPerDay'),320))"
    const kindLimit = "MIN(?,COALESCE(json_extract(config_snapshot_json,?),?))"
    const amount = `MIN(?,${dayLimit}-request_count,${kindLimit}-COALESCE(json_extract(cursor_json,?),0))`
    const args = [count, maxDay, maxKind, moduleKindPath, kindCeiling, path]
    const rows = await this.all<{ reserved: number }>(
      `UPDATE discovery_sync_jobs SET request_count=request_count+${amount},cursor_json=json_set(cursor_json,?,COALESCE(json_extract(cursor_json,?),0)+${amount},'$.lastReservation',${amount}) WHERE id=? AND lease_token=? AND lease_until>? AND edition_day=? AND request_count<${dayLimit} AND COALESCE(json_extract(cursor_json,?),0)<${kindLimit} RETURNING json_extract(cursor_json,'$.lastReservation') AS reserved`,
      [
        ...args,
        path,
        path,
        ...args,
        ...args,
        lease.moduleId,
        lease.moduleToken,
        this.clock().toISOString(),
        shanghaiDay(this.clock()),
        maxDay,
        path,
        maxKind,
        moduleKindPath,
        kindCeiling,
      ]
    )
    if (!rows[0]?.reserved)
      throw new DiscoveryLimitError("DAILY_REQUEST_BUDGET_OR_LEASE")
    return rows[0].reserved
  }
  /** Counts rounds for the edition across actual-day budget rows, including midnight resumes. */
  async incrementRound(
    module: DiscoveryLease,
    editionDay: string
  ): Promise<number> {
    const path = `$."rounds_${editionDay}"`
    const result = await this.first<{ total: number }>(
      "UPDATE discovery_sync_jobs SET cursor_json=json_set(cursor_json,?,COALESCE(json_extract(cursor_json,?),0)+1) WHERE id=? AND lease_token=? AND lease_until>? RETURNING (SELECT COALESCE(SUM(COALESCE(json_extract(cursor_json,?),0)),0) FROM discovery_sync_jobs WHERE kind='budget' AND edition_day>=?) AS total",
      [
        path,
        path,
        module.moduleId,
        module.moduleToken,
        this.clock().toISOString(),
        path,
        editionDay,
      ]
    )
    if (!result) throw new DiscoveryLimitError("LEASE_LOST")
    return result.total
  }
  async ensureDailyJobs(
    day: string,
    config: unknown,
    ruleVersion: string,
    partitions: { key: string; kind: string }[],
    module?: DiscoveryLease
  ) {
    const existing = await this.first<{
      config_snapshot_json: string
      rule_version: string
      started_at: string
      deadline_at: string
    }>(
      "SELECT config_snapshot_json,rule_version,started_at,deadline_at FROM discovery_sync_jobs WHERE edition_day=? AND kind!='budget' LIMIT 1",
      [day]
    )
    // The initial insert creates all partitions atomically. New deployments must not
    // append partitions from a different current config to an existing update.
    if (existing) return
    const now = this.clock().toISOString()
    const snapshot = JSON.stringify(config)
    const started = now,
      deadline = new Date(this.clock().getTime() + 21600000).toISOString()
    const rows = partitions.map(({ key, kind }) => ({
      id: `discovery:${day}:${key}`,
      day,
      key,
      kind,
    }))
    await this.run(
      "INSERT OR IGNORE INTO discovery_sync_jobs (id,edition_day,partition_key,kind,rule_version,execution_schema_version,config_snapshot_json,started_at,deadline_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.day'),json_extract(value,'$.key'),json_extract(value,'$.kind'),?,?,?,?,?,? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM discovery_sync_jobs WHERE id=? AND lease_token=? AND lease_until>?)",
      [
        ruleVersion,
        EXECUTION_SCHEMA_VERSION,
        snapshot,
        started,
        deadline,
        now,
        JSON.stringify(rows),
        module?.moduleId ?? `discovery:${day}:__budget__`,
        module?.moduleToken ?? "",
        this.clock().toISOString(),
      ]
    )
  }
  jobs(day: string) {
    return this.all<DiscoveryJob>(
      "SELECT * FROM discovery_sync_jobs WHERE edition_day=? AND kind!='budget' ORDER BY updated_at,partition_key",
      [day]
    )
  }
  async latestResumableDay(): Promise<string | null> {
    const row = await this.first<{ edition_day: string }>(
      "SELECT edition_day FROM discovery_sync_jobs WHERE kind!='budget' AND state IN ('pending','running') ORDER BY edition_day DESC LIMIT 1"
    )
    return row?.edition_day ?? null
  }
  async claim(
    job: DiscoveryJob,
    module: DiscoveryLease,
    ignoreRetry = false
  ): Promise<DiscoveryLease | null> {
    const token = crypto.randomUUID(),
      now = this.clock().toISOString()
    const res = await this.run(
      "UPDATE discovery_sync_jobs SET lease_token=?,lease_until=?,state='running',updated_at=? WHERE id=? AND state IN ('pending','running') AND (lease_until IS NULL OR lease_until<=?) AND (?=1 OR next_retry_at IS NULL OR next_retry_at<=?) AND EXISTS(SELECT 1 FROM discovery_sync_jobs WHERE id=? AND lease_token=? AND lease_until>?)",
      [
        token,
        new Date(this.clock().getTime() + 120000).toISOString(),
        now,
        job.id,
        now,
        ignoreRetry ? 1 : 0,
        now,
        module.moduleId,
        module.moduleToken,
        now,
      ]
    )
    return res.meta.changes
      ? {
          jobId: job.id,
          token,
          moduleId: module.moduleId,
          moduleToken: module.moduleToken,
        }
      : null
  }
  async checkpoint(
    lease: DiscoveryLease,
    patch: {
      cursor?: unknown
      pool?: unknown
      state?: "pending" | "succeeded" | "failed"
      requests?: number
      attempts?: number
      retryAt?: string | null
      errorCode?: string | null
    }
  ) {
    const g = this.guard(lease),
      now = this.clock().toISOString()
    const terminal = patch.state === "succeeded" || patch.state === "failed"
    const res = await this.run(
      `UPDATE discovery_sync_jobs SET cursor_json=COALESCE(?,cursor_json),pool_state_json=COALESCE(?,pool_state_json),state=?,request_count=request_count+?,attempts=COALESCE(?,attempts),next_retry_at=?,error_code=?,finished_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND ${g.sql}`,
      [
        patch.cursor === undefined ? null : JSON.stringify(patch.cursor),
        patch.pool === undefined ? null : JSON.stringify(patch.pool),
        patch.state ?? "pending",
        patch.requests ?? 0,
        patch.attempts ?? null,
        patch.retryAt ?? null,
        patch.errorCode ?? null,
        terminal ? now : null,
        now,
        lease.jobId,
        ...g.args,
      ]
    )
    if (!res.meta.changes) throw new DiscoveryLimitError("LEASE_LOST")
  }
  async terminateSources(module: DiscoveryLease, day: string, code: string) {
    const now = this.clock().toISOString()
    await this.run(
      "UPDATE discovery_sync_jobs SET state='failed',error_code=?,finished_at=?,lease_token=NULL,lease_until=NULL WHERE edition_day=? AND kind IN ('github','hn','rss') AND state IN ('pending','running') AND EXISTS(SELECT 1 FROM discovery_sync_jobs WHERE id=? AND lease_token=? AND lease_until>?)",
      [code, now, day, module.moduleId, module.moduleToken, now]
    )
  }
  async expireEdition(module: DiscoveryLease, day: string) {
    const now = this.clock().toISOString()
    await this.run(
      "UPDATE discovery_sync_jobs SET state='failed',error_code='DISCOVERY_DEADLINE',finished_at=?,next_retry_at=NULL,lease_token=NULL,lease_until=NULL WHERE edition_day=? AND kind IN ('github','hn','rss','publish') AND state IN ('pending','running') AND deadline_at<=? AND EXISTS(SELECT 1 FROM discovery_sync_jobs WHERE id=? AND lease_token=? AND lease_until>?)",
      [now, day, now, module.moduleId, module.moduleToken, now]
    )
  }
  previousGithubPools(day: string) {
    return this.all<{ partition_key: string; pool_state_json: string }>(
      "SELECT partition_key,pool_state_json FROM discovery_sync_jobs j WHERE kind='github' AND state='succeeded' AND edition_day<? AND NOT EXISTS(SELECT 1 FROM discovery_sync_jobs n WHERE n.partition_key=j.partition_key AND n.state='succeeded' AND n.edition_day<? AND n.edition_day>j.edition_day)",
      [day, day]
    )
  }
  previousPool(partition: string, day: string) {
    return this.first<DiscoveryJob>(
      "SELECT * FROM discovery_sync_jobs WHERE partition_key=? AND edition_day<? AND state='succeeded' ORDER BY edition_day DESC LIMIT 1",
      [partition, day]
    )
  }

  /** Identity, merge and observations are committed atomically under both fences. */
  async persistCandidates(
    job: DiscoveryJob,
    lease: DiscoveryLease,
    candidates: DiscoveryCandidate[]
  ) {
    if (!candidates.length) return { persisted: 0, conflicts: 0 }
    if (candidates.length > 30)
      throw new DiscoveryLimitError("CANDIDATE_PIECE_LIMIT")
    if (this.clock().toISOString() >= job.deadline_at)
      throw new DiscoveryLimitError("DISCOVERY_DEADLINE")
    const github = candidates.some((candidate) => candidate.source === "github")
    this.requireStatements(github ? 7 : 5)
    const urls = [...new Set(candidates.map((c) => c.canonicalUrl))],
      githubIds = [
        ...new Set(
          candidates.flatMap((c) =>
            c.githubRepoId === null ? [] : [c.githubRepoId]
          )
        ),
      ]
    const placeholders = urls.map(() => "?").join(",")
    const existing = await this.all<ItemRow>(
      `SELECT * FROM discovery_items WHERE canonical_url IN (${placeholders}) OR EXISTS(SELECT 1 FROM json_each(aliases_json) WHERE value IN (${placeholders}))${githubIds.length ? ` OR github_repo_id IN (${githubIds.map(() => "?").join(",")})` : ""}`,
      [...urls, ...urls, ...githubIds]
    )
    const baseline = github
      ? await this.all<{
          item_id: string
          candidate_json: string
        }>(
          "SELECT o.item_id,o.candidate_json FROM discovery_observations o JOIN discovery_sync_jobs j ON j.id=o.job_id WHERE j.state='succeeded' AND j.edition_day=? AND o.source='github'",
          [previousDay(job.edition_day)]
        )
      : []
    const previous = new Map(
      baseline.map((b) => [
        b.item_id,
        parseStored<DiscoveryCandidate | null>(b.candidate_json, null),
      ])
    )
    const items: Record<string, unknown>[] = [],
      observations: Record<string, unknown>[] = [],
      merges: { id: string; target: string }[] = []
    let conflicts = 0
    const resolved = new Map<string, ItemRow>()
    for (const candidate of candidates) {
      const numeric =
        candidate.githubRepoId === null
          ? undefined
          : existing.find(
              (i) =>
                i.github_repo_id === candidate.githubRepoId && !i.merged_into_id
            )
      let byUrl =
        resolved.get(candidate.canonicalUrl) ??
        existing.find(
          (i) => i.canonical_url === candidate.canonicalUrl && !i.merged_into_id
        ) ??
        existing.find(
          (i) =>
            parseStored<string[]>(i.aliases_json, []).includes(
              candidate.canonicalUrl
            ) && !i.merged_into_id
        )
      // A reused repository path is not evidence that two numeric IDs are the same.
      if (
        candidate.githubRepoId !== null &&
        byUrl?.github_repo_id != null &&
        byUrl.github_repo_id !== candidate.githubRepoId
      ) {
        conflicts++
        continue
      }
      if (numeric && byUrl && numeric.id !== byUrl.id) {
        merges.push({ id: byUrl.id, target: numeric.id })
        byUrl = numeric
      }
      const current = numeric ?? byUrl
      const id =
        current?.id ??
        (candidate.githubRepoId !== null
          ? `gh:${candidate.githubRepoId}`
          : `url:${await hashUrl(candidate.canonicalUrl)}`)
      const aliases = [
        ...new Set([
          ...parseStored<string[]>(current?.aliases_json ?? "[]", []),
          ...(current?.canonical_url &&
          current.canonical_url !== candidate.canonicalUrl
            ? [current.canonical_url]
            : []),
          ...existing
            .filter((i) => merges.some((m) => m.id === i.id && m.target === id))
            .flatMap((i) => [
              ...(i.canonical_url ? [i.canonical_url] : []),
              ...parseStored<string[]>(i.aliases_json, []),
            ]),
        ]),
      ].slice(-64)
      const canonicalUrl =
        numeric || candidate.githubRepoId !== null || !current?.canonical_url
          ? candidate.canonicalUrl
          : current.canonical_url
      const row = {
        id,
        canonicalUrl,
        githubRepoId: candidate.githubRepoId ?? current?.github_repo_id ?? null,
        aliases,
        sourceType: candidate.bookmarkSourceType,
        title: candidate.title,
        summary: candidate.summary,
        publishedAt: candidate.publishedAt,
        observedAt: candidate.observedAt,
      }
      items.push(row)
      resolved.set(candidate.canonicalUrl, {
        id,
        canonical_url: canonicalUrl,
        github_repo_id: row.githubRepoId,
        merged_into_id: null,
        aliases_json: JSON.stringify(aliases),
      })
      let evidence: DiscoveryEvidence = candidate.evidence
      if (candidate.source === "github") {
        const prior = previous.get(id)
        const growth =
          typeof evidence.stars === "number" &&
          typeof prior?.evidence.stars === "number"
            ? githubGrowth(
                { stars: evidence.stars, observedAt: candidate.observedAt },
                { stars: prior.evidence.stars, observedAt: prior.observedAt },
                job.edition_day
              )
            : { growth: null, previousObservedAt: null }
        evidence = { ...evidence, ...growth }
      }
      observations.push({
        id: `${job.id}:${candidate.source}:${candidate.externalId}`,
        itemId: id,
        source: candidate.source,
        sourceId: candidate.sourceId,
        externalId: candidate.externalId,
        observedAt: candidate.observedAt,
        candidate: { ...candidate, evidence },
      })
    }
    const g = this.guard(lease)
    const statements: { sql: string; values: unknown[] }[] = []
    if (merges.length)
      statements.push({
        sql: `UPDATE discovery_items SET canonical_url=NULL,merged_into_id=(SELECT json_extract(value,'$.target') FROM json_each(?) WHERE json_extract(value,'$.id')=discovery_items.id) WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${g.sql}`,
        values: [JSON.stringify(merges), JSON.stringify(merges), ...g.args],
      })
    statements.push({
      sql: `INSERT INTO discovery_items (id,canonical_url,github_repo_id,aliases_json,bookmark_source_type,title,summary,published_at,first_seen_at,last_seen_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.canonicalUrl'),json_extract(value,'$.githubRepoId'),json_extract(value,'$.aliases'),json_extract(value,'$.sourceType'),json_extract(value,'$.title'),json_extract(value,'$.summary'),json_extract(value,'$.publishedAt'),json_extract(value,'$.observedAt'),json_extract(value,'$.observedAt') FROM json_each(?) WHERE ${g.sql} ON CONFLICT(id) DO UPDATE SET canonical_url=excluded.canonical_url,github_repo_id=COALESCE(excluded.github_repo_id,discovery_items.github_repo_id),aliases_json=excluded.aliases_json,bookmark_source_type=excluded.bookmark_source_type,title=excluded.title,summary=excluded.summary,published_at=excluded.published_at,last_seen_at=excluded.last_seen_at`,
      values: [JSON.stringify(items), ...g.args],
    })
    statements.push({
      sql: `INSERT INTO discovery_observations (id,job_id,item_id,source,source_id,external_id,observed_at,candidate_json) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.itemId'),json_extract(value,'$.source'),json_extract(value,'$.sourceId'),json_extract(value,'$.externalId'),json_extract(value,'$.observedAt'),json_extract(value,'$.candidate') FROM json_each(?) WHERE ${g.sql} ON CONFLICT(job_id,source,external_id) DO UPDATE SET item_id=excluded.item_id,observed_at=excluded.observed_at,candidate_json=excluded.candidate_json`,
      values: [job.id, JSON.stringify(observations), ...g.args],
    })
    const results = await this.batch(statements)
    if (observations.length && !results.at(-1)?.meta.changes)
      throw new DiscoveryLimitError("LEASE_LOST")
    return { persisted: observations.length, conflicts }
  }

  async selectedSources(day: string, partitions: string[]) {
    const jobs = await this.all<DiscoveryJob>(
      "SELECT * FROM discovery_sync_jobs WHERE partition_key IN(SELECT value FROM json_each(?)) AND edition_day<=? AND edition_day>=? ORDER BY edition_day DESC",
      [
        JSON.stringify(partitions),
        day,
        new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 86400000)
          .toISOString()
          .slice(0, 10),
      ]
    )
    const selected: DiscoveryJob[] = [],
      statuses: DiscoverySourceStatus[] = []
    for (const partition of partitions) {
      const current = jobs.find(
        (j) => j.partition_key === partition && j.edition_day === day
      )
      const success = jobs.find(
        (j) => j.partition_key === partition && j.state === "succeeded"
      )
      if (success) selected.push(success)
      const source = partition.startsWith("github:")
        ? "github"
        : partition.startsWith("rss:")
          ? "rss"
          : "hn"
      statuses.push({
        source,
        sourceId: partition.replace(/^rss:/, ""),
        state: success
          ? success.edition_day === day
            ? parseStored<{ persisted?: number }>(success.cursor_json, {})
                .persisted === 0
              ? "empty"
              : "fresh"
            : "stale"
          : "failed",
        lastSuccessAt: success?.finished_at ?? null,
        errorCode: current?.error_code ?? null,
      })
    }
    return { selected, statuses }
  }
  async candidatesForJobs(jobs: DiscoveryJob[]) {
    if (!jobs.length) return []
    // recursive roots preserve historical FK references without mutating published editions.
    return this.all<{ item_id: string; candidate_json: string }>(
      "WITH RECURSIVE roots(id,root,depth) AS (SELECT id,id,0 FROM discovery_items UNION ALL SELECT roots.id,i.merged_into_id,depth+1 FROM roots JOIN discovery_items i ON i.id=roots.root WHERE i.merged_into_id IS NOT NULL AND depth<16) SELECT (SELECT root FROM roots WHERE id=o.item_id ORDER BY depth DESC LIMIT 1) AS item_id,o.candidate_json FROM discovery_observations o JOIN discovery_sync_jobs j ON j.id=o.job_id WHERE o.job_id IN(SELECT value FROM json_each(?)) AND j.state='succeeded'",
      [JSON.stringify(jobs.map((j) => j.id))]
    )
  }
  async publish(
    job: DiscoveryJob,
    lease: DiscoveryLease,
    channel: DiscoveryChannelId,
    items: DiscoveryItem[],
    statuses: DiscoverySourceStatus[],
    sourceJobs: DiscoveryJob[]
  ) {
    if (this.clock().toISOString() >= job.deadline_at)
      throw new DiscoveryLimitError("DISCOVERY_DEADLINE")
    this.requireStatements(7)
    if (
      items.length > 20 ||
      new Set(items.map((i) => i.id)).size !== items.length
    )
      throw new Error("INVALID_EDITION_ITEMS")
    const alreadyPublished = await this.first<{ id: string }>(
      "SELECT id FROM discovery_editions WHERE publish_job_id=? AND state='published' LIMIT 1",
      [job.id]
    )
    if (alreadyPublished) return
    const revision = await this.first<{ next: number }>(
      "SELECT COALESCE(MAX(revision),0)+1 AS next FROM discovery_editions WHERE edition_day=? AND channel_id=?",
      [job.edition_day, channel]
    )
    const editionId = crypto.randomUUID(),
      fence = this.guard(lease),
      g = {
        sql: `${fence.sql} AND EXISTS(SELECT 1 FROM discovery_sync_jobs WHERE id=? AND deadline_at>?)`,
        args: [...fence.args, job.id, this.clock().toISOString()],
      },
      now = this.clock().toISOString()
    // Draft, complete frozen rows and publication form one atomic D1 batch. No reader sees a half version.
    const results = await this.batch([
      {
        sql: `INSERT INTO discovery_editions(id,edition_day,channel_id,revision,rule_version,sources_json,source_job_ids_json,publish_job_id,lease_token) SELECT ?,?,?,?,?,?,?,?,? WHERE ${g.sql}`,
        values: [
          editionId,
          job.edition_day,
          channel,
          revision?.next ?? 1,
          job.rule_version,
          JSON.stringify(statuses),
          JSON.stringify(sourceJobs.map((j) => j.id)),
          job.id,
          lease.token,
          ...g.args,
        ],
      },
      {
        sql: `INSERT INTO discovery_edition_items(edition_id,item_id,rank,frozen_json) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.rank'),value FROM json_each(?) WHERE ${g.sql} AND EXISTS(SELECT 1 FROM discovery_editions WHERE id=? AND state='draft' AND lease_token=?)`,
        values: [
          editionId,
          JSON.stringify(items),
          ...g.args,
          editionId,
          lease.token,
        ],
      },
      {
        sql: `UPDATE discovery_editions SET state='published',published_at=? WHERE id=? AND state='draft' AND lease_token=? AND (SELECT COUNT(*) FROM discovery_edition_items WHERE edition_id=?)=? AND ${g.sql}`,
        values: [
          now,
          editionId,
          lease.token,
          editionId,
          items.length,
          ...g.args,
        ],
      },
    ])
    if (!results[2]?.meta.changes) throw new DiscoveryLimitError("LEASE_LOST")
  }
  async cleanup(module: DiscoveryLease) {
    this.requireStatements(7)
    const cutoff = new Date(this.clock().getTime() - 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      now = this.clock().toISOString()
    const guard =
        "EXISTS(SELECT 1 FROM discovery_sync_jobs WHERE id=? AND lease_token=? AND lease_until>?)",
      args = [module.moduleId, module.moduleToken, now]
    // Keep each latest channel edition and each latest successful source snapshot even when old.
    await this.batch([
      {
        sql: `DELETE FROM discovery_edition_items WHERE edition_id IN(SELECT id FROM discovery_editions e WHERE edition_day<? AND id NOT IN(SELECT id FROM discovery_editions latest WHERE state='published' AND NOT EXISTS(SELECT 1 FROM discovery_editions n WHERE n.channel_id=latest.channel_id AND n.state='published' AND (n.edition_day>latest.edition_day OR n.edition_day=latest.edition_day AND n.revision>latest.revision))) LIMIT 100) AND ${guard}`,
        values: [cutoff, ...args],
      },
      {
        sql: `DELETE FROM discovery_editions WHERE edition_day<? AND NOT EXISTS(SELECT 1 FROM discovery_edition_items WHERE edition_id=discovery_editions.id) AND (state='draft' OR EXISTS(SELECT 1 FROM discovery_editions n WHERE n.channel_id=discovery_editions.channel_id AND n.state='published' AND (n.edition_day>discovery_editions.edition_day OR n.edition_day=discovery_editions.edition_day AND n.revision>discovery_editions.revision))) AND ${guard}`,
        values: [cutoff, ...args],
      },
      {
        sql: `DELETE FROM discovery_observations WHERE job_id IN(SELECT j.id FROM discovery_sync_jobs j WHERE j.edition_day<? AND j.id NOT IN(SELECT value FROM discovery_editions,json_each(source_job_ids_json)) AND NOT EXISTS(SELECT 1 FROM discovery_editions WHERE publish_job_id=j.id) AND NOT(j.state='succeeded' AND NOT EXISTS(SELECT 1 FROM discovery_sync_jobs n WHERE n.partition_key=j.partition_key AND n.state='succeeded' AND n.edition_day>j.edition_day)) LIMIT 100) AND ${guard}`,
        values: [cutoff, ...args],
      },
      {
        sql: `DELETE FROM discovery_sync_jobs WHERE edition_day<? AND NOT EXISTS(SELECT 1 FROM discovery_observations WHERE job_id=discovery_sync_jobs.id) AND NOT EXISTS(SELECT 1 FROM discovery_editions WHERE publish_job_id=discovery_sync_jobs.id OR discovery_sync_jobs.id IN(SELECT value FROM json_each(source_job_ids_json))) AND NOT(kind IN ('github','hn','rss') AND state='succeeded' AND NOT EXISTS(SELECT 1 FROM discovery_sync_jobs n WHERE n.partition_key=discovery_sync_jobs.partition_key AND n.state='succeeded' AND n.edition_day>discovery_sync_jobs.edition_day)) AND ${guard}`,
        values: [cutoff, ...args],
      },
      {
        sql: `DELETE FROM discovery_items WHERE last_seen_at<? AND NOT EXISTS(SELECT 1 FROM discovery_edition_items WHERE item_id=discovery_items.id) AND NOT EXISTS(SELECT 1 FROM discovery_observations WHERE item_id=discovery_items.id) AND NOT EXISTS(SELECT 1 FROM discovery_items child WHERE child.merged_into_id=discovery_items.id) AND ${guard}`,
        values: [`${cutoff}T00:00:00.000Z`, ...args],
      },
    ])
  }
}
async function hashUrl(url: string) {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(url)
  )
  return [...new Uint8Array(result)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Read side never acquires leases, writes tasks or invokes an upstream. */
export async function readDiscovery(
  db: D1Database,
  enabled: boolean,
  channel: DiscoveryChannelId,
  authenticated: boolean
): Promise<DiscoveryResponse> {
  const repo = new DiscoveryRepository(db, () => new Date(), 40)
  const empty: DiscoveryResponse = {
    enabled,
    channel,
    state: enabled ? "initializing" : "disabled",
    edition: null,
    items: [],
    sources: [],
    sync: { state: "idle", startedAt: null, finishedAt: null, errorCode: null },
  }
  if (!enabled) return empty
  const edition = await repo.first<{
    id: string
    edition_day: string
    revision: number
    published_at: string
    rule_version: string
    sources_json: string
  }>(
    "SELECT * FROM discovery_editions WHERE channel_id=? AND state='published' ORDER BY edition_day DESC,revision DESC LIMIT 1",
    [channel]
  )
  const latest = await repo.first<DiscoveryJob>(
    "SELECT * FROM discovery_sync_jobs WHERE partition_key=? ORDER BY edition_day DESC LIMIT 1",
    [`publish:${channel}`]
  )
  const active = latest?.state === "running" || latest?.state === "pending"
  const sync: DiscoveryResponse["sync"] = latest
    ? {
        state: latest.state as DiscoveryResponse["sync"]["state"],
        startedAt: latest.started_at,
        finishedAt: latest.finished_at,
        errorCode: latest.error_code,
      }
    : empty.sync
  if (!edition)
    return {
      ...empty,
      state:
        sync.state === "failed"
          ? "failed"
          : active
            ? "initializing"
            : "initializing",
      sync,
    }
  const rows = await repo.all<{
    frozen_json: string
    aliases_json: string
    canonical_url: string | null
  }>(
    "WITH RECURSIVE roots(id,root,depth) AS (SELECT id,id,0 FROM discovery_items UNION ALL SELECT roots.id,i.merged_into_id,depth+1 FROM roots JOIN discovery_items i ON i.id=roots.root WHERE i.merged_into_id IS NOT NULL AND depth<16) SELECT ei.frozen_json,i.aliases_json,i.canonical_url FROM discovery_edition_items ei JOIN discovery_items i ON i.id=(SELECT root FROM roots WHERE id=ei.item_id ORDER BY depth DESC LIMIT 1) WHERE edition_id=? ORDER BY rank LIMIT 20",
    [edition.id]
  )
  let items = rows.map((r) =>
    parseStored<DiscoveryItem>(r.frozen_json, {} as DiscoveryItem)
  )
  if (authenticated && items.length) {
    const identities = [
      ...new Set(
        rows.flatMap((r, index) => [
          items[index]!.url,
          ...parseStored<string[]>(r.aliases_json, []),
          ...(r.canonical_url ? [r.canonical_url] : []),
        ])
      ),
    ].slice(0, 20 * 65)
    // One JSON bind keeps the query beneath D1's 100 parameter cap; output is bounded by the edition identities.
    const matches = await repo.all<{
      id: string
      canonical_url: string
      source_type: string
    }>(
      "SELECT id,canonical_url,source_type FROM bookmarks INDEXED BY bookmarks_source_url_uq WHERE source_type='url' AND deleted_at IS NULL AND canonical_url IN(SELECT value FROM json_each(?)) UNION SELECT id,canonical_url,source_type FROM bookmarks INDEXED BY bookmarks_github_case_url_idx WHERE source_type='github' AND deleted_at IS NULL AND lower(canonical_url) IN(SELECT lower(value) FROM json_each(?))",
      [JSON.stringify(identities), JSON.stringify(identities)]
    )
    items = items.map((item, index) => ({
      ...item,
      savedBookmarkId:
        matches.find(
          (b) =>
            [
              item.url,
              ...parseStored<string[]>(rows[index]!.aliases_json, []),
              rows[index]!.canonical_url,
            ].some(
              (url) =>
                typeof url === "string" &&
                (item.sourceType === "github"
                  ? url.toLowerCase() === b.canonical_url.toLowerCase()
                  : url === b.canonical_url)
            ) && b.source_type === item.sourceType
        )?.id ?? null,
    }))
  }
  let sources = parseStored<DiscoverySourceStatus[]>(edition.sources_json, [])
  if (
    latest &&
    (latest.edition_day > edition.edition_day || latest.state === "failed")
  ) {
    const partitions = sources.map((s) =>
      s.source === "github"
        ? `github:${channel}`
        : s.source === "rss"
          ? `rss:${s.sourceId}`
          : "hn"
    )
    sources = (await repo.selectedSources(latest.edition_day, partitions))
      .statuses
  }
  let state: DiscoveryResponse["state"] = !items.length
    ? "empty"
    : sources.some((s) => s.state === "stale" || s.state === "failed")
      ? "partial"
      : "ready"
  if (active) state = "updating"
  else if (sync.state === "failed") state = "failed"
  return discoveryResponseSchema.parse({
    enabled,
    channel,
    state,
    edition: {
      id: edition.id,
      day: edition.edition_day,
      revision: edition.revision,
      publishedAt: edition.published_at,
      ruleVersion: edition.rule_version,
    },
    items,
    sources,
    sync,
  })
}
export async function readDiscoveryChannels(db: D1Database, enabled: boolean) {
  const ready =
    enabled &&
    !!(await db
      .prepare(
        "SELECT id FROM discovery_editions WHERE state='published' LIMIT 1"
      )
      .first())
  return {
    enabled,
    ready,
    channels: DISCOVERY_CHANNEL_IDS.map((id) => ({ id })),
  }
}
