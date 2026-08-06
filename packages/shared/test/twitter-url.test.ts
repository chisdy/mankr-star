import { describe, expect, it } from "vitest"
import { parseTwitterStatusInput, twitterCanonicalUrl } from "../src"

describe("parseTwitterStatusInput", () => {
  it("解析 x.com status URL", () => {
    const res = parseTwitterStatusInput(
      "https://x.com/elonmusk/status/20?s=20",
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.tweetId).toBe("20")
      expect(res.data.handle).toBe("elonmusk")
      expect(res.data.canonicalUrl).toBe(
        "https://x.com/elonmusk/status/20",
      )
    }
  })

  it("解析 twitter.com 与 /i/web/status", () => {
    const a = parseTwitterStatusInput(
      "https://twitter.com/foo/status/1234567890",
    )
    expect(a.ok).toBe(true)
    if (a.ok) expect(a.data.tweetId).toBe("1234567890")

    const b = parseTwitterStatusInput(
      "https://x.com/i/web/status/9876543210",
    )
    expect(b.ok).toBe(true)
    if (b.ok) {
      expect(b.data.tweetId).toBe("9876543210")
      expect(b.data.handle).toBeNull()
      expect(b.data.canonicalUrl).toBe(
        "https://x.com/i/web/status/9876543210",
      )
    }
  })

  it("拒绝主页与纯 article URL", () => {
    const profile = parseTwitterStatusInput("https://x.com/elonmusk")
    expect(profile.ok).toBe(false)
    if (!profile.ok) {
      expect(profile.code).toBe("INVALID_URL")
      expect(profile.error).toContain("X")
      expect(profile.error).not.toMatch(/twitter/i)
    }

    const article = parseTwitterStatusInput(
      "https://x.com/i/article/123456",
    )
    expect(article.ok).toBe(false)
    if (!article.ok) expect(article.code).toBe("INVALID_URL")
  })
})

describe("twitterCanonicalUrl", () => {
  it("生成 x.com canonical", () => {
    expect(twitterCanonicalUrl("@Someone", "99")).toBe(
      "https://x.com/Someone/status/99",
    )
  })
})
