import { describe, expect, it } from "vitest"
import { isLikelySiteIconUrl } from "../src/site-icon-url"

describe("isLikelySiteIconUrl", () => {
  it("detects favicon and icon paths", () => {
    expect(isLikelySiteIconUrl("https://example.com/favicon.ico")).toBe(true)
    expect(isLikelySiteIconUrl("https://example.com/apple-touch-icon.png")).toBe(
      true,
    )
    expect(
      isLikelySiteIconUrl("https://webtomind.com/icons/logo-icon.svg"),
    ).toBe(true)
    expect(isLikelySiteIconUrl("https://cdn.example.com/static/icons/a.png")).toBe(
      true,
    )
  })

  it("detects icon-named SVGs", () => {
    expect(isLikelySiteIconUrl("https://example.com/assets/logo.svg")).toBe(true)
    expect(isLikelySiteIconUrl("https://example.com/brand-icon.svg")).toBe(true)
  })

  it("allows real cover images", () => {
    expect(
      isLikelySiteIconUrl(
        "https://cdn.example.com/og/article-cover-1200x630.jpg",
      ),
    ).toBe(false)
    expect(
      isLikelySiteIconUrl("https://pbs.twimg.com/media/ABC123?format=jpg&name=large"),
    ).toBe(false)
  })

  it("ignores query and hash when classifying", () => {
    expect(
      isLikelySiteIconUrl(
        "https://webtomind.com/icons/logo-icon.svg?v=2#frag",
      ),
    ).toBe(true)
  })
})

