import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DiscoverySettingsResponse } from "@mankr/shared"
import { createDb } from "@mankr/db"
import { app } from "../src/worker/app"
import { runDiscoveryScheduled } from "../src/worker/cron/discovery"
import { DiscoveryRepository } from "../src/worker/lib/discovery/repository"
import { readDiscoveryEnabled } from "../src/worker/lib/discovery/settings"
import { initializeSettings } from "../src/worker/lib/settings-store"
import {
  mockOutboundFetch,
  registerOwner,
  TestClient,
  type OutboundMock,
} from "./helpers"

let owner: TestClient
let outbound: OutboundMock

beforeEach(async () => {
  outbound = mockOutboundFetch()
  owner = await registerOwner()
})
afterEach(() => outbound.restore())

async function request(
  envValue: string | undefined,
  init: RequestInit = {},
  cookie = owner.cookieHeader,
  path = "/api/settings/discovery"
) {
  const context = createExecutionContext()
  const headers = new Headers(init.headers)
  if (cookie) headers.set("Cookie", cookie)
  if (init.body) headers.set("Content-Type", "application/json")
  const response = await app.request(
    path,
    { ...init, headers },
    { ...env, DISCOVERY_ENABLED: envValue },
    context
  )
  await waitOnExecutionContext(context)
  return response
}

async function save(enabled: boolean, envValue?: string) {
  const response = await request(envValue, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  return response.json<DiscoverySettingsResponse>()
}

async function seedEdition(state: "draft" | "published") {
  await env.DB.prepare(
    "INSERT INTO discovery_sync_jobs(id,edition_day,partition_key,kind,rule_version,execution_schema_version,config_snapshot_json,state,started_at,deadline_at,updated_at) VALUES('settings-publish','2026-10-08','publish:ai','publish','settings-test',1,'{}','succeeded',?,?,?)"
  )
    .bind(
      "2026-10-08T00:00:00Z",
      "2026-10-08T23:59:59Z",
      "2026-10-08T00:05:00Z"
    )
    .run()
  await env.DB.prepare(
    "INSERT INTO discovery_editions(id,edition_day,channel_id,revision,state,rule_version,sources_json,source_job_ids_json,publish_job_id,lease_token,published_at) VALUES('settings-edition','2026-10-08','ai',1,?,'settings-test','[]','[]','settings-publish','test-lease','2026-10-08T00:05:00Z')"
  )
    .bind(state)
    .run()
}

describe("每日热点实例设置", () => {
  it.each([
    { value: undefined, enabled: false },
    { value: "false", enabled: false },
    { value: "TRUE", enabled: false },
    { value: "true", enabled: true },
  ])("未保存开关时继承部署默认值 $value", async ({ value, enabled }) => {
    expect(
      await env.DB.prepare(
        "SELECT value FROM settings WHERE key='discovery'"
      ).first()
    ).toBeNull()
    const response = await request(value)
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ enabled, ready: false })
    expect(outbound.calls).toEqual([])
  })

  it("关闭与开启均覆盖部署默认值，并保持注册初始化幂等", async () => {
    expect(await save(false, "true")).toEqual({ enabled: false, ready: false })
    expect(await (await request("true")).json()).toEqual({
      enabled: false,
      ready: false,
    })
    expect(await save(true, "false")).toEqual({ enabled: true, ready: false })
    await initializeSettings(createDb(env))
    expect(await (await request("false")).json()).toEqual({
      enabled: true,
      ready: false,
    })
    expect(outbound.calls).toEqual([])
  })

  it.each(["{}", '{"enabled":"true"}', '{"enabled":1}', "null", "[]"])(
    "已有损坏值 %s 时关闭，不再继承开启的部署值",
    async (value) => {
      await env.DB.prepare(
        "INSERT INTO settings(key,value) VALUES('discovery',?)"
      )
        .bind(value)
        .run()
      expect(await (await request("true")).json()).toEqual({
        enabled: false,
        ready: false,
      })
      expect(await save(true, "false")).toEqual({ enabled: true, ready: false })
      expect(outbound.calls).toEqual([])
    }
  )

  it("只将已发布批次视为就绪，关闭后保留数据并可重新显示", async () => {
    await seedEdition("draft")
    expect(await save(true)).toEqual({ enabled: true, ready: false })
    await env.DB.prepare(
      "UPDATE discovery_editions SET state='published' WHERE id='settings-edition'"
    ).run()
    expect(await (await request(undefined)).json()).toEqual({
      enabled: true,
      ready: true,
    })
    expect(await save(false)).toEqual({ enabled: false, ready: false })
    const fetcher = vi.fn<typeof fetch>()
    const stopped = await runDiscoveryScheduled(
      { ...env, DISCOVERY_ENABLED: "true" },
      { now: new Date("2026-10-08T00:05:00Z"), fetcher }
    )
    expect(stopped).toMatchObject({
      outcome: "disabled",
      requests: 0,
      statements: 1,
      rowsWritten: 0,
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM discovery_editions"
      ).first<{ count: number }>()
    ).toEqual({ count: 1 })
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM discovery_sync_jobs"
      ).first<{ count: number }>()
    ).toEqual({ count: 1 })
    expect(await save(true)).toEqual({ enabled: true, ready: true })
    expect(outbound.calls).toEqual([])
  })

  it("保存的开启覆盖部署关闭，调度器继续正常同步", async () => {
    await save(true, "false")
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes("/search/repositories")) {
        return Response.json({ items: [], incomplete_results: false })
      }
      if (
        url.includes("/topstories.json") ||
        url.includes("/beststories.json")
      ) {
        return Response.json([])
      }
      return new Response(
        "<rss><channel><title>Empty feed</title></channel></rss>",
        {
          headers: { "Content-Type": "application/rss+xml" },
        }
      )
    })
    const advanced = await runDiscoveryScheduled(
      { ...env, DISCOVERY_ENABLED: "false" },
      { now: new Date("2026-10-08T00:05:00Z"), fetcher }
    )
    expect(advanced.outcome).toBe("advanced")
    expect(advanced.requests).toBeGreaterThan(0)
    expect(advanced.statements).toBeLessThanOrEqual(40)
    expect(fetcher).toHaveBeenCalled()
  })

  it("菜单状态与内容读取采用相同的实例开关", async () => {
    await save(true, "false")
    const enabled = await request(
      "false",
      {},
      owner.cookieHeader,
      "/api/discovery/channels"
    )
    expect(await enabled.json()).toMatchObject({ enabled: true, ready: false })
    const initializing = await request(
      "false",
      {},
      owner.cookieHeader,
      "/api/discovery?channel=ai"
    )
    expect(await initializing.json()).toMatchObject({
      enabled: true,
      state: "initializing",
    })
    await save(false, "true")
    const disabled = await request(
      "true",
      {},
      owner.cookieHeader,
      "/api/discovery/channels"
    )
    expect(await disabled.json()).toMatchObject({
      enabled: false,
      ready: false,
    })
    const content = await request(
      "true",
      {},
      owner.cookieHeader,
      "/api/discovery?channel=ai"
    )
    expect(await content.json()).toMatchObject({
      enabled: false,
      state: "disabled",
      edition: null,
      items: [],
    })
    expect(outbound.calls).toEqual([])
  })

  it("未登录用户和公开访客不可读取或更改设置", async () => {
    await owner.put("/api/settings/public-browsing", { enabled: true })
    for (const init of [
      {},
      { method: "PUT", body: JSON.stringify({ enabled: true }) },
    ]) {
      const response = await request("true", init, "")
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" })
    }
    expect(await readDiscoveryEnabled(env.DB, "false")).toBe(false)
  })

  it("read-only Bearer 不能管理开关", async () => {
    const created = await owner.post<{ token: string }>("/api/api-tokens", {
      name: "discovery-read",
      scopes: ["read"],
    })
    expect(created.status).toBe(201)
    for (const method of ["GET", "PUT"]) {
      const response = await request(
        "false",
        {
          method,
          headers: { Authorization: `Bearer ${created.body.token}` },
          ...(method === "PUT" ? { body: '{"enabled":true}' } : {}),
        },
        ""
      )
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" })
    }
    expect(await readDiscoveryEnabled(env.DB, "false")).toBe(false)
  })

  it("拒绝非法 JSON、缺失字段和非布尔值，保留已保存状态", async () => {
    await save(true)
    const malformed = await request("false", { method: "PUT", body: "{" })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ code: "BAD_REQUEST" })
    for (const body of [{}, { enabled: "false" }, { enabled: 0 }, null]) {
      const response = await request("false", {
        method: "PUT",
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" })
    }
    expect(await readDiscoveryEnabled(env.DB, "false")).toBe(true)
  })

  it("调度器计数适配器将读取开关计入一个 SQL，不产生写入", async () => {
    const missing = new DiscoveryRepository(env.DB)
    expect(await readDiscoveryEnabled(missing.countedDb, "true")).toBe(true)
    expect(missing.statements).toBe(1)
    expect(missing.rowsWritten).toBe(0)
    await save(false)
    const stored = new DiscoveryRepository(env.DB)
    expect(await readDiscoveryEnabled(stored.countedDb, "true")).toBe(false)
    expect(stored.statements).toBe(1)
    expect(stored.rowsWritten).toBe(0)
  })
})
