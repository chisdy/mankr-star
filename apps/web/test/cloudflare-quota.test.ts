import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CF_FREE_D1_ROWS_READ_PER_DAY,
  CF_FREE_D1_ROWS_WRITTEN_PER_DAY,
  CF_FREE_D1_STORAGE_BYTES,
  CF_FREE_WORKERS_REQUESTS_PER_DAY,
} from "@mankr/shared"
import {
  clearCloudflareQuotaCacheForTests,
  CF_GRAPHQL_URL,
} from "../src/worker/lib/cloudflare-analytics"
import {
  TestClient,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const ACCOUNT_ID = "cf_account_test_001"
const API_TOKEN = "cf-analytics-token-abcdef1234"

interface CloudflareSettingsResponse {
  cloudflare_configured: boolean
  cloudflare_account_id: string | null
  cloudflare_token_last4: string | null
  code?: string
  error?: string
}

type QuotaConfigured = {
  configured: true
  cached: boolean
  stale?: boolean
  scope: "account"
  workers: { requests: { used: number; limit: number; remaining: number } }
  d1: {
    rows_read: { used: number; limit: number }
    rows_written: { used: number; limit: number }
    storage_bytes: { used: number; limit: number }
  }
}

let client: TestClient
let outbound: OutboundMock

function mockQuotaGraphql(opts?: {
  requests?: number
  requestBuckets?: number[]
  rowsRead?: number
  rowsWritten?: number
  storageBytes?: number
  storageRows?: Array<{
    bytes: number
    datetime: string
    databaseId?: string
  }>
  fail?: boolean
  failHttp401?: boolean
}) {
  outbound.on(CF_GRAPHQL_URL, async (req) => {
    const body = (await req.json()) as {
      query?: string
      variables?: { accountTag?: string }
    }
    if (opts?.failHttp401) {
      return new Response(
        JSON.stringify({ errors: [{ message: "Authentication error" }] }),
        { status: 401, headers: { "content-type": "application/json" } },
      )
    }
    if (opts?.fail) {
      return new Response(
        JSON.stringify({ errors: [{ message: "unauthorized" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    // test probe query
    if (body.query?.includes("CloudflareQuotaTest")) {
      return new Response(
        JSON.stringify({
          data: {
            viewer: {
              accounts: [{ __typename: "Account" }],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    const requestBuckets = opts?.requestBuckets ?? [
      opts?.requests ?? 12_340,
    ]
    const storageRows = opts?.storageRows ?? [
      {
        bytes: opts?.storageBytes ?? 52_428_800,
        datetime: "2026-08-11T12:00:00Z",
      },
    ]

    return new Response(
      JSON.stringify({
        data: {
          viewer: {
            accounts: [
              {
                workersInvocationsAdaptive: requestBuckets.map((requests) => ({
                  sum: { requests },
                })),
                d1AnalyticsAdaptiveGroups: [
                  {
                    sum: {
                      rowsRead: opts?.rowsRead ?? 800_000,
                      rowsWritten: opts?.rowsWritten ?? 12_000,
                    },
                  },
                ],
                d1StorageAdaptiveGroups: storageRows.map((row) => ({
                  max: { databaseSizeBytes: row.bytes },
                  dimensions: {
                    datetime: row.datetime,
                    ...(row.databaseId ? { databaseId: row.databaseId } : {}),
                  },
                })),
              },
            ],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  })
}

beforeEach(async () => {
  clearCloudflareQuotaCacheForTests()
  outbound = mockOutboundFetch()
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
  clearCloudflareQuotaCacheForTests()
})

describe("PUT /api/settings/cloudflare", () => {
  it("保存后只回显 configured / account_id / last4，永不回显 Token", async () => {
    const res = await client.fetch("/api/settings/cloudflare", {
      method: "PUT",
      body: JSON.stringify({
        accountId: ACCOUNT_ID,
        apiToken: API_TOKEN,
      }),
    })
    const text = await res.text()
    const body = JSON.parse(text) as CloudflareSettingsResponse

    expect(res.status).toBe(200)
    expect(body.cloudflare_configured).toBe(true)
    expect(body.cloudflare_account_id).toBe(ACCOUNT_ID)
    expect(body.cloudflare_token_last4).toBe(API_TOKEN.slice(-4))
    expect(text).not.toContain(API_TOKEN)
    expect(text).not.toContain("apiTokenEncrypted")
  })

  it("GET /api/me 同步暴露配置状态且不回显 Token", async () => {
    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })

    const res = await client.fetch("/api/me")
    const text = await res.text()
    const body = JSON.parse(text) as Record<string, unknown>

    expect(body.cloudflare_configured).toBe(true)
    expect(body.cloudflare_account_id).toBe(ACCOUNT_ID)
    expect(body.cloudflare_token_last4).toBe(API_TOKEN.slice(-4))
    expect(text).not.toContain(API_TOKEN)
  })

  it("仅 Account ID 不足以 configured；DELETE 可清除", async () => {
    const onlyAccount = await client.put<CloudflareSettingsResponse>(
      "/api/settings/cloudflare",
      { accountId: ACCOUNT_ID },
    )
    expect(onlyAccount.status).toBe(200)
    expect(onlyAccount.body.cloudflare_configured).toBe(false)

    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })
    const deleted = await client.delete<CloudflareSettingsResponse>(
      "/api/settings/cloudflare",
    )
    expect(deleted.status).toBe(200)
    expect(deleted.body.cloudflare_configured).toBe(false)
    expect(deleted.body.cloudflare_account_id).toBeNull()
  })

  it("空请求体返回 400", async () => {
    const empty = await client.put<CloudflareSettingsResponse>(
      "/api/settings/cloudflare",
      {},
    )
    expect(empty.status).toBe(400)
  })
})

describe("POST /api/settings/cloudflare/test", () => {
  it("未配置时返回 400 NOT_CONFIGURED", async () => {
    const { status, body } = await client.post<{ ok: boolean; code: string }>(
      "/api/settings/cloudflare/test",
    )
    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.code).toBe("NOT_CONFIGURED")
  })

  it("配置后探测成功返回 ok", async () => {
    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })
    mockQuotaGraphql()
    const ok = await client.post<{ ok: boolean }>(
      "/api/settings/cloudflare/test",
    )
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)
  })
})

describe("GET /api/insights/cloudflare-quota", () => {
  it("未登录返回 401", async () => {
    const guest = new TestClient()
    const res = await guest.json("/api/insights/cloudflare-quota")
    expect(res.status).toBe(401)
  })

  it("未配置返回 configured:false", async () => {
    const { status, body } = await client.json<{ configured: boolean }>(
      "/api/insights/cloudflare-quota",
    )
    expect(status).toBe(200)
    expect(body.configured).toBe(false)
  })

  it("已配置时返回账户级用量与 Free 上限", async () => {
    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })
    mockQuotaGraphql({
      requests: 12_340,
      rowsRead: 800_000,
      rowsWritten: 12_000,
      storageBytes: 52_428_800,
    })

    const { status, body } = await client.json<QuotaConfigured>(
      "/api/insights/cloudflare-quota",
    )
    expect(status).toBe(200)
    expect(body.configured).toBe(true)
    expect(body.scope).toBe("account")
    expect(body.workers.requests.used).toBe(12_340)
    expect(body.workers.requests.limit).toBe(CF_FREE_WORKERS_REQUESTS_PER_DAY)
    expect(body.workers.requests.remaining).toBe(
      CF_FREE_WORKERS_REQUESTS_PER_DAY - 12_340,
    )
    expect(body.d1.rows_read.used).toBe(800_000)
    expect(body.d1.rows_read.limit).toBe(CF_FREE_D1_ROWS_READ_PER_DAY)
    expect(body.d1.rows_written.used).toBe(12_000)
    expect(body.d1.rows_written.limit).toBe(CF_FREE_D1_ROWS_WRITTEN_PER_DAY)
    expect(body.d1.storage_bytes.used).toBe(52_428_800)
    expect(body.d1.storage_bytes.limit).toBe(CF_FREE_D1_STORAGE_BYTES)
    expect(body.cached).toBe(false)
  })

  it("短时间内再次请求命中内存缓存", async () => {
    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })
    mockQuotaGraphql({ requests: 100 })

    const first = await client.json<QuotaConfigured>(
      "/api/insights/cloudflare-quota",
    )
    expect(first.body.cached).toBe(false)

    const graphqlCallsBefore = outbound.calls.filter((u) =>
      u.startsWith(CF_GRAPHQL_URL),
    ).length

    const second = await client.json<QuotaConfigured>(
      "/api/insights/cloudflare-quota",
    )
    expect(second.status).toBe(200)
    expect(second.body.cached).toBe(true)
    expect(second.body.workers.requests.used).toBe(100)

    const graphqlCallsAfter = outbound.calls.filter((u) =>
      u.startsWith(CF_GRAPHQL_URL),
    ).length
    expect(graphqlCallsAfter).toBe(graphqlCallsBefore)
  })

  it("上游失败且无缓存时返回 502", async () => {
    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })
    mockQuotaGraphql({ fail: true })

    const { status, body } = await client.json<{ code: string }>(
      "/api/insights/cloudflare-quota",
    )
    expect(status).toBe(502)
    expect(body.code).toBe("CLOUDFLARE_QUOTA_FAILED")
  })

  it("上游 HTTP 401 映射为 502 CLOUDFLARE_UNAUTHORIZED，不伪装会话过期", async () => {
    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })
    mockQuotaGraphql({ failHttp401: true })

    const { status, body } = await client.json<{ code: string }>(
      "/api/insights/cloudflare-quota",
    )
    expect(status).toBe(502)
    expect(body.code).toBe("CLOUDFLARE_UNAUTHORIZED")
  })

  it("Workers 多桶请求数累加", async () => {
    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })
    mockQuotaGraphql({ requestBuckets: [100, 250, 50] })

    const { body } = await client.json<QuotaConfigured>(
      "/api/insights/cloudflare-quota",
    )
    expect(body.workers.requests.used).toBe(400)
  })

  it("D1 存储取最新快照，不把时间序列相加", async () => {
    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })
    mockQuotaGraphql({
      storageRows: [
        { bytes: 10_000, datetime: "2026-08-11T12:00:00Z" },
        { bytes: 9_000, datetime: "2026-08-11T06:00:00Z" },
        { bytes: 8_000, datetime: "2026-08-11T00:00:00Z" },
      ],
    })

    const { body } = await client.json<QuotaConfigured>(
      "/api/insights/cloudflare-quota",
    )
    expect(body.d1.storage_bytes.used).toBe(10_000)
  })

  it("上游失败但有缓存时强制刷新降级返回 stale", async () => {
    await client.put("/api/settings/cloudflare", {
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
    })
    mockQuotaGraphql({ requests: 42 })
    const warm = await client.json<QuotaConfigured>(
      "/api/insights/cloudflare-quota",
    )
    expect(warm.body.workers.requests.used).toBe(42)

    mockQuotaGraphql({ fail: true })
    const stale = await client.json<QuotaConfigured>(
      "/api/insights/cloudflare-quota?refresh=1",
    )
    expect(stale.status).toBe(200)
    expect(stale.body.stale).toBe(true)
    expect(stale.body.cached).toBe(true)
    expect(stale.body.workers.requests.used).toBe(42)
  })
})
