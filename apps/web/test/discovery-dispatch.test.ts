import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Env } from "../src/worker/env"

const cron = vi.hoisted(() => ({
  business: vi.fn<(env: Env, context?: ExecutionContext) => Promise<void>>(
    async () => undefined
  ),
  discovery: vi.fn<(env: Env) => Promise<void>>(async () => undefined),
}))

vi.mock("../src/worker/cron/sync", () => ({ runCronJobs: cron.business }))
vi.mock("../src/worker/cron/discovery", () => ({
  BUSINESS_CRON: "*/10 * * * *",
  DISCOVERY_CRON: "5-55/10 * * * *",
  runDiscoveryScheduled: cron.discovery,
}))

import worker from "../src/worker/index"

async function dispatch(expression: string) {
  const context = createExecutionContext()
  await worker.scheduled(
    { cron: expression, scheduledTime: Date.now(), noRetry: () => {} },
    env,
    context
  )
  await waitOnExecutionContext(context)
  return context
}

beforeEach(() => vi.clearAllMocks())

describe("发现 Cron 与已有业务的调度隔离", () => {
  it("原触发器只调用已有任务，并保留 ExecutionContext", async () => {
    const context = await dispatch("*/10 * * * *")
    expect(cron.business).toHaveBeenCalledOnce()
    expect(cron.business.mock.calls[0]?.[0]).toBe(env)
    expect(cron.business.mock.calls[0]?.[1]).toBe(context)
    expect(cron.discovery).not.toHaveBeenCalled()
  })

  it("热点触发器只推进发现任务", async () => {
    await dispatch("5-55/10 * * * *")
    expect(cron.discovery).toHaveBeenCalledOnce()
    expect(cron.discovery.mock.calls[0]?.[0]).toBe(env)
    expect(cron.business).not.toHaveBeenCalled()
  })

  it("未知触发器不误调用任一业务", async () => {
    await dispatch("0 0 * * *")
    expect(cron.business).not.toHaveBeenCalled()
    expect(cron.discovery).not.toHaveBeenCalled()
  })
})
