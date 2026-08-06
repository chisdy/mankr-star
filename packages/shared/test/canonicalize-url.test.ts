import { describe, expect, it } from "vitest"
import { canonicalizeUrl, urlExternalId } from "../src/canonicalize-url"

describe("canonicalizeUrl", () => {
  it("补全 https 并小写 hostname", () => {
    const res = canonicalizeUrl("Example.COM/Path/")
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.canonicalUrl).toBe("https://example.com/Path")
      expect(res.hostname).toBe("example.com")
      expect(res.pathname).toBe("/Path")
    }
  })

  it("剥离 utm 与常见追踪参数，去掉 hash", () => {
    const res = canonicalizeUrl(
      "https://example.com/a?utm_source=x&id=1&fbclid=y#section",
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.canonicalUrl).toBe("https://example.com/a?id=1")
    }
  })

  it("根路径保留斜杠", () => {
    const res = canonicalizeUrl("https://example.com/")
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.canonicalUrl).toBe("https://example.com/")
  })

  it("空输入无效", () => {
    const res = canonicalizeUrl("  ")
    expect(res.ok).toBe(false)
  })
})

describe("urlExternalId", () => {
  it("拼接 hostname 与 pathname", () => {
    expect(urlExternalId("example.com", "/docs/a")).toBe("example.com/docs/a")
    expect(urlExternalId("example.com", "/")).toBe("example.com")
  })

  it("超长截断", () => {
    const long = "/" + "a".repeat(300)
    expect(urlExternalId("h.com", long, 20).length).toBe(20)
  })
})
