import { describe, expect, it } from "vitest"
import { parsePricingFilterParam } from "../src/features/bookmarks/pricing-filter"

describe("parsePricingFilterParam", () => {
  it("接受合法筛选值", () => {
    expect(parsePricingFilterParam("free")).toBe("free")
    expect(parsePricingFilterParam("freemium")).toBe("freemium")
    expect(parsePricingFilterParam("paid")).toBe("paid")
    expect(parsePricingFilterParam("unset")).toBe("unset")
  })

  it("非法或空值视为未筛选", () => {
    expect(parsePricingFilterParam(null)).toBeUndefined()
    expect(parsePricingFilterParam("")).toBeUndefined()
    expect(parsePricingFilterParam("bogus")).toBeUndefined()
    expect(parsePricingFilterParam("FREE")).toBeUndefined()
  })
})
