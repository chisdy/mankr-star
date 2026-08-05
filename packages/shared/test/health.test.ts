import { describe, expect, it } from "vitest"
import {
  computeHealthStatus,
  detectSourceType,
  recomputeActivityHealth,
} from "../src"

const NOW = Date.parse("2026-08-05T00:00:00Z")

describe("detectSourceType", () => {
  it("识别 owner/repo 短形式为 github", () => {
    const res = detectSourceType("facebook/react")
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.sourceType).toBe("github")
      expect(res.implemented).toBe(true)
    }
  })

  it("识别 github.com URL", () => {
    const res = detectSourceType("https://github.com/vercel/next.js")
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.sourceType).toBe("github")
  })

  it("twitter 返回 UNSUPPORTED_SOURCE", () => {
    const res = detectSourceType("https://x.com/someone/status/1")
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("UNSUPPORTED_SOURCE")
      expect(res.detectedType).toBe("twitter")
    }
  })

  it("通用 https 返回 UNSUPPORTED_SOURCE (url)", () => {
    const res = detectSourceType("https://gitlab.com/foo/bar")
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("UNSUPPORTED_SOURCE")
      expect(res.detectedType).toBe("url")
    }
  })

  it("非法输入返回 INVALID_URL", () => {
    const res = detectSourceType("not a url")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("INVALID_URL")
  })
})

describe("computeHealthStatus", () => {
  it("not_found / forbidden → unavailable", () => {
    expect(
      computeHealthStatus({ syncStatus: "not_found", nowMs: NOW }),
    ).toBe("unavailable")
    expect(
      computeHealthStatus({ syncStatus: "forbidden", nowMs: NOW }),
    ).toBe("unavailable")
  })

  it("disabled → unavailable", () => {
    expect(
      computeHealthStatus({
        syncStatus: "ok",
        githubDisabled: true,
        nowMs: NOW,
      }),
    ).toBe("unavailable")
  })

  it("size===0 → empty", () => {
    expect(
      computeHealthStatus({
        syncStatus: "ok",
        repoSize: 0,
        pushedAt: "2026-08-01T00:00:00Z",
        nowMs: NOW,
      }),
    ).toBe("empty")
  })

  it("archived → archived", () => {
    expect(
      computeHealthStatus({
        syncStatus: "ok",
        repoSize: 100,
        githubArchived: true,
        pushedAt: "2026-08-01T00:00:00Z",
        nowMs: NOW,
      }),
    ).toBe("archived")
  })

  it("近期推送 → hot", () => {
    expect(
      computeHealthStatus({
        syncStatus: "ok",
        repoSize: 100,
        pushedAt: "2026-07-20T00:00:00Z",
        hotWithinDays: 30,
        staleAfterDays: 180,
        nowMs: NOW,
      }),
    ).toBe("hot")
  })

  it("中等间隔 → active", () => {
    expect(
      computeHealthStatus({
        syncStatus: "ok",
        repoSize: 100,
        pushedAt: "2026-05-01T00:00:00Z",
        hotWithinDays: 30,
        staleAfterDays: 180,
        nowMs: NOW,
      }),
    ).toBe("active")
  })

  it("长期无推送 → stale", () => {
    expect(
      computeHealthStatus({
        syncStatus: "ok",
        repoSize: 100,
        pushedAt: "2025-01-01T00:00:00Z",
        hotWithinDays: 30,
        staleAfterDays: 180,
        nowMs: NOW,
      }),
    ).toBe("stale")
  })

  it("error 且无事实 → unknown", () => {
    expect(
      computeHealthStatus({ syncStatus: "error", nowMs: NOW }),
    ).toBe("unknown")
  })
})

describe("recomputeActivityHealth", () => {
  it("不改写 unavailable/empty/archived/unknown", () => {
    expect(
      recomputeActivityHealth("unavailable", "2026-08-01T00:00:00Z", {
        nowMs: NOW,
      }),
    ).toBe("unavailable")
    expect(
      recomputeActivityHealth("archived", "2026-08-01T00:00:00Z", {
        nowMs: NOW,
      }),
    ).toBe("archived")
  })

  it("按新阈值重算 hot→stale", () => {
    expect(
      recomputeActivityHealth("hot", "2026-05-01T00:00:00Z", {
        hotWithinDays: 7,
        staleAfterDays: 60,
        nowMs: NOW,
      }),
    ).toBe("stale")
  })
})
