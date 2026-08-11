import {
  CF_FREE_D1_ROWS_READ_PER_DAY,
  CF_FREE_D1_ROWS_WRITTEN_PER_DAY,
  CF_FREE_D1_STORAGE_BYTES,
  CF_FREE_WORKERS_REQUESTS_PER_DAY,
  CF_QUOTA_CACHE_TTL_MS,
  type CloudflareQuotaMetric,
  type CloudflareQuotaResponse,
} from "@mankr/shared"

export const CF_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"

type QuotaConfigured = Extract<CloudflareQuotaResponse, { configured: true }>

type CacheEntry = {
  expiresAt: number
  payload: QuotaConfigured
}

/** isolate 内存缓存：不写 D1，避免污染 rows_written */
const quotaCache = new Map<string, CacheEntry>()

function utcDayBounds(now = new Date()): {
  startDate: string
  endDate: string
  datetimeStart: string
  datetimeEnd: string
} {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, "0")
  const d = String(now.getUTCDate()).padStart(2, "0")
  const startDate = `${y}-${m}-${d}`
  return {
    startDate,
    endDate: startDate,
    datetimeStart: `${startDate}T00:00:00.000Z`,
    datetimeEnd: now.toISOString(),
  }
}

export function buildQuotaMetric(
  used: number,
  limit: number,
): CloudflareQuotaMetric {
  const safeUsed = Math.max(0, used)
  const remaining = Math.max(0, limit - safeUsed)
  const ratio = limit > 0 ? Math.min(1, safeUsed / limit) : 0
  return {
    used: safeUsed,
    limit,
    remaining,
    ratio: Math.round(ratio * 10_000) / 10_000,
  }
}

type GraphQLErrorBody = {
  errors?: Array<{ message?: string }>
  data?: unknown
}

async function postGraphql<T>(
  apiToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  let res: Response
  try {
    res = await fetch(CF_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "网络请求失败",
      status: 502,
    }
  }

  let body: GraphQLErrorBody
  try {
    body = (await res.json()) as GraphQLErrorBody
  } catch {
    return { ok: false, error: "Cloudflare 响应无法解析", status: 502 }
  }

  if (!res.ok) {
    const msg =
      body.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `HTTP ${res.status}`
    return { ok: false, error: msg, status: res.status === 401 ? 401 : 502 }
  }

  if (body.errors?.length) {
    const msg = body.errors.map((e) => e.message).filter(Boolean).join("; ")
    return { ok: false, error: msg || "GraphQL 错误", status: 502 }
  }

  return { ok: true, data: body.data as T }
}

const TEST_QUERY = `
query CloudflareQuotaTest($accountTag: string!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      __typename
    }
  }
}
`

/** 探测 Account ID + Token 是否可读取 Analytics */
export async function testCloudflareAnalyticsAccess(
  accountId: string,
  apiToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  type TestData = {
    viewer?: { accounts?: Array<{ __typename?: string }> }
  }
  const result = await postGraphql<TestData>(apiToken, TEST_QUERY, {
    accountTag: accountId,
  })
  if (!result.ok) return { ok: false, error: result.error }

  const accounts = result.data.viewer?.accounts
  if (!accounts || accounts.length === 0) {
    return {
      ok: false,
      error: "无法读取该 Account（请检查 Account ID 与 Token 权限）",
    }
  }
  return { ok: true }
}

const QUOTA_QUERY = `
query CloudflareFreeQuota(
  $accountTag: string!
  $startDate: Date!
  $endDate: Date!
  $datetimeStart: Time!
  $datetimeEnd: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(
        limit: 10000
        filter: {
          datetime_geq: $datetimeStart
          datetime_leq: $datetimeEnd
        }
      ) {
        sum {
          requests
        }
      }
      d1AnalyticsAdaptiveGroups(
        limit: 10000
        filter: {
          date_geq: $startDate
          date_leq: $endDate
        }
      ) {
        sum {
          rowsRead
          rowsWritten
        }
      }
      d1StorageAdaptiveGroups(
        limit: 10000
        filter: {
          datetime_geq: $datetimeStart
          datetime_leq: $datetimeEnd
        }
        orderBy: [datetime_DESC]
      ) {
        max {
          databaseSizeBytes
        }
        dimensions {
          datetime
          databaseId
        }
      }
    }
  }
}
`

type StorageRow = {
  max?: { databaseSizeBytes?: number }
  dimensions?: { datetime?: string; databaseId?: string }
}

type QuotaGraphData = {
  viewer?: {
    accounts?: Array<{
      workersInvocationsAdaptive?: Array<{
        sum?: { requests?: number }
      }>
      d1AnalyticsAdaptiveGroups?: Array<{
        sum?: { rowsRead?: number; rowsWritten?: number }
      }>
      d1StorageAdaptiveGroups?: StorageRow[]
    }>
  }
}

/** 累加 Workers Adaptive 多行（按时间/维度拆桶），避免 limit 截断后少计 */
export function sumRequests(
  rows: Array<{ sum?: { requests?: number } }> | undefined,
): number {
  if (!rows?.length) return 0
  return rows.reduce((acc, row) => acc + (row.sum?.requests ?? 0), 0)
}

export function sumD1Rows(
  rows:
    | Array<{ sum?: { rowsRead?: number; rowsWritten?: number } }>
    | undefined,
): { rowsRead: number; rowsWritten: number } {
  let rowsRead = 0
  let rowsWritten = 0
  for (const row of rows ?? []) {
    rowsRead += row.sum?.rowsRead ?? 0
    rowsWritten += row.sum?.rowsWritten ?? 0
  }
  return { rowsRead, rowsWritten }
}

/**
 * D1 存储是「占用快照」不是流量：
 * - 有 databaseId：每个库取最新时刻的 size，再求和（账户合计）
 * - 无 databaseId：结果已按 datetime_DESC，只取最新一条，禁止把时间序列相加
 */
export function resolveStorageBytes(rows: StorageRow[] | undefined): number {
  if (!rows?.length) return 0

  const byDb = new Map<string, { datetime: string; bytes: number }>()
  let hasDbId = false

  for (const row of rows) {
    const bytes = row.max?.databaseSizeBytes ?? 0
    const datetime = row.dimensions?.datetime ?? ""
    const databaseId = row.dimensions?.databaseId
    if (databaseId) {
      hasDbId = true
      const prev = byDb.get(databaseId)
      if (!prev || datetime > prev.datetime) {
        byDb.set(databaseId, { datetime, bytes })
      }
    }
  }

  if (hasDbId) {
    let total = 0
    for (const entry of byDb.values()) total += entry.bytes
    return total
  }

  // 无库维度：orderBy datetime_DESC，首行即最新快照
  return rows[0]?.max?.databaseSizeBytes ?? 0
}

export async function fetchCloudflareFreeQuota(opts: {
  accountId: string
  apiToken: string
  forceRefresh?: boolean
}): Promise<
  | { ok: true; payload: QuotaConfigured }
  | { ok: false; error: string; status: number; stale?: QuotaConfigured }
> {
  const cacheKey = opts.accountId.trim()
  const cached = quotaCache.get(cacheKey)
  const now = Date.now()

  if (!opts.forceRefresh && cached && cached.expiresAt > now) {
    return {
      ok: true,
      payload: { ...cached.payload, cached: true, stale: false },
    }
  }

  const bounds = utcDayBounds()
  const result = await postGraphql<QuotaGraphData>(
    opts.apiToken,
    QUOTA_QUERY,
    {
      accountTag: opts.accountId.trim(),
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      datetimeStart: bounds.datetimeStart,
      datetimeEnd: bounds.datetimeEnd,
    },
  )

  if (!result.ok) {
    if (cached) {
      return {
        ok: false,
        error: result.error,
        status: result.status,
        stale: { ...cached.payload, cached: true, stale: true },
      }
    }
    return { ok: false, error: result.error, status: result.status }
  }

  const account = result.data.viewer?.accounts?.[0]
  if (!account) {
    const error = "无法读取该 Account 的 Analytics 数据"
    if (cached) {
      return {
        ok: false,
        error,
        status: 502,
        stale: { ...cached.payload, cached: true, stale: true },
      }
    }
    return { ok: false, error, status: 502 }
  }

  const requests = sumRequests(account.workersInvocationsAdaptive)
  const { rowsRead, rowsWritten } = sumD1Rows(account.d1AnalyticsAdaptiveGroups)
  const storageBytes = resolveStorageBytes(account.d1StorageAdaptiveGroups)

  const payload: QuotaConfigured = {
    configured: true,
    as_of: new Date().toISOString(),
    period: {
      kind: "utc_day",
      start: bounds.startDate,
      end: bounds.endDate,
    },
    plan: "workers_free",
    scope: "account",
    cached: false,
    stale: false,
    workers: {
      requests: buildQuotaMetric(requests, CF_FREE_WORKERS_REQUESTS_PER_DAY),
    },
    d1: {
      rows_read: buildQuotaMetric(rowsRead, CF_FREE_D1_ROWS_READ_PER_DAY),
      rows_written: buildQuotaMetric(
        rowsWritten,
        CF_FREE_D1_ROWS_WRITTEN_PER_DAY,
      ),
      storage_bytes: buildQuotaMetric(storageBytes, CF_FREE_D1_STORAGE_BYTES),
    },
  }

  quotaCache.set(cacheKey, {
    expiresAt: now + CF_QUOTA_CACHE_TTL_MS,
    payload: { ...payload, cached: true },
  })

  return { ok: true, payload }
}

/** 凭证变更或测试后清空内存缓存 */
export function clearCloudflareQuotaCache(accountId?: string): void {
  if (accountId) {
    quotaCache.delete(accountId.trim())
    return
  }
  quotaCache.clear()
}

/** @deprecated 使用 clearCloudflareQuotaCache */
export function clearCloudflareQuotaCacheForTests(): void {
  clearCloudflareQuotaCache()
}
