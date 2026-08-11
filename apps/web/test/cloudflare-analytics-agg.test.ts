import { describe, expect, it } from "vitest"
import {
  buildQuotaMetric,
  resolveStorageBytes,
  sumRequests,
} from "../src/worker/lib/cloudflare-analytics"

describe("sumRequests", () => {
  it("累加多行 Adaptive 桶，避免只取一条", () => {
    expect(
      sumRequests([
        { sum: { requests: 100 } },
        { sum: { requests: 250 } },
        { sum: { requests: 50 } },
      ]),
    ).toBe(400)
  })

  it("空数组为 0", () => {
    expect(sumRequests([])).toBe(0)
    expect(sumRequests(undefined)).toBe(0)
  })
})

describe("resolveStorageBytes", () => {
  it("无 databaseId 时只取最新一条（datetime_DESC），不把时间序列相加", () => {
    expect(
      resolveStorageBytes([
        {
          max: { databaseSizeBytes: 10_000 },
          dimensions: { datetime: "2026-08-11T12:00:00Z" },
        },
        {
          max: { databaseSizeBytes: 9_000 },
          dimensions: { datetime: "2026-08-11T06:00:00Z" },
        },
        {
          max: { databaseSizeBytes: 8_000 },
          dimensions: { datetime: "2026-08-11T00:00:00Z" },
        },
      ]),
    ).toBe(10_000)
  })

  it("有 databaseId 时各库取最新快照再求和", () => {
    expect(
      resolveStorageBytes([
        {
          max: { databaseSizeBytes: 5_000 },
          dimensions: {
            datetime: "2026-08-11T12:00:00Z",
            databaseId: "db-a",
          },
        },
        {
          max: { databaseSizeBytes: 4_000 },
          dimensions: {
            datetime: "2026-08-11T06:00:00Z",
            databaseId: "db-a",
          },
        },
        {
          max: { databaseSizeBytes: 3_000 },
          dimensions: {
            datetime: "2026-08-11T12:00:00Z",
            databaseId: "db-b",
          },
        },
        {
          max: { databaseSizeBytes: 2_000 },
          dimensions: {
            datetime: "2026-08-11T01:00:00Z",
            databaseId: "db-b",
          },
        },
      ]),
    ).toBe(8_000)
  })
})

describe("buildQuotaMetric", () => {
  it("ratio 上限为 1，remaining 不为负", () => {
    const over = buildQuotaMetric(150, 100)
    expect(over.remaining).toBe(0)
    expect(over.ratio).toBe(1)
  })
})
