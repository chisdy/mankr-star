import { describe, expect, it } from "vitest"
import {
  paramsFromBookmarksListKey,
  sameFiltersIgnoringPage,
} from "../src/features/bookmarks/bookmark-query-params"
import { queryKeys } from "../src/lib/query-keys"

describe("sameFiltersIgnoringPage", () => {
  it("同筛选不同 page 视为相同", () => {
    expect(
      sameFiltersIgnoringPage(
        { folder_id: "f1", limit: 20, page: 1, sort: "recent" },
        { folder_id: "f1", limit: 20, page: 3, sort: "recent" },
      ),
    ).toBe(true)
  })

  it("folder / tag / q 变化视为不同筛选", () => {
    expect(
      sameFiltersIgnoringPage(
        { folder_id: "a", limit: 20, page: 1 },
        { folder_id: "b", limit: 20, page: 1 },
      ),
    ).toBe(false)
    expect(
      sameFiltersIgnoringPage(
        { tag: "react", limit: 20, page: 1 },
        { tag: "vue", limit: 20, page: 1 },
      ),
    ).toBe(false)
    expect(
      sameFiltersIgnoringPage(
        { q: "foo", limit: 20, page: 1 },
        { q: "bar", limit: 20, page: 1 },
      ),
    ).toBe(false)
  })

  it("limit 变化视为不同筛选", () => {
    expect(
      sameFiltersIgnoringPage(
        { folder_id: "f1", limit: 20, page: 1 },
        { folder_id: "f1", limit: 50, page: 1 },
      ),
    ).toBe(false)
  })

  it("任意未预先枚举的筛选项变化也会判定不同", () => {
    expect(
      sameFiltersIgnoringPage(
        { pricing: "free", limit: 20, page: 1 },
        { pricing: "paid", limit: 20, page: 1 },
      ),
    ).toBe(false)
    expect(
      sameFiltersIgnoringPage(
        { featured: true, limit: 20, page: 1 },
        { featured: undefined, limit: 20, page: 1 },
      ),
    ).toBe(false)
  })
})

describe("paramsFromBookmarksListKey", () => {
  it("从 list query key 取出 params", () => {
    const params = { folder_id: "f1", limit: 20, page: 2 }
    expect(paramsFromBookmarksListKey(queryKeys.bookmarks.list(params))).toEqual(
      params,
    )
  })

  it("非 list key 返回 undefined", () => {
    expect(
      paramsFromBookmarksListKey(["bookmarks", "detail", "id"]),
    ).toBeUndefined()
    expect(paramsFromBookmarksListKey(["bookmarks", "list"])).toBeUndefined()
  })
})
