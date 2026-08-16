import { describe, expect, it } from "vitest"
import { searchNavigateTo, toReadableSearch } from "../src/lib/search-params"

describe("toReadableSearch", () => {
  it("有参数时以 ? 开头，中文保持原文", () => {
    expect(toReadableSearch(new URLSearchParams("q=react"))).toBe("?q=react")
    expect(toReadableSearch(new URLSearchParams({ q: "收藏" }))).toBe("?q=收藏")
  })

  it("没有参数时是空串，方便拼接 pathname", () => {
    expect(toReadableSearch(new URLSearchParams())).toBe("")
  })
})

describe("searchNavigateTo", () => {
  it("有参数时与 toReadableSearch 相同", () => {
    const params = new URLSearchParams("bookmark=bm_1")
    expect(searchNavigateTo(params)).toBe(toReadableSearch(params))
  })

  it("空查询写成 ?，避免 navigate(\"\") 被解析成首页", () => {
    expect(searchNavigateTo(new URLSearchParams())).toBe("?")
  })
})
