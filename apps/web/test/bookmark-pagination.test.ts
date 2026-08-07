import { describe, expect, it } from "vitest"
import {
  clampPage,
  dedupeById,
  hasNextPage,
  nextPageParam,
  paginationItems,
  parsePageParam,
  totalPageCount,
} from "../src/features/bookmarks/bookmark-pagination"

describe("parsePageParam", () => {
  it("缺省与非法值都回到第 1 页", () => {
    for (const raw of [null, undefined, "", "0", "-3", "abc", "1.5"]) {
      expect(parsePageParam(raw)).toBe(1)
    }
  })

  it("正整数原样返回", () => {
    expect(parsePageParam("4")).toBe(4)
  })
})

describe("totalPageCount", () => {
  it("按 pageSize 向上取整，空列表也算一页", () => {
    expect(totalPageCount(0, 20)).toBe(1)
    expect(totalPageCount(20, 20)).toBe(1)
    expect(totalPageCount(21, 20)).toBe(2)
    expect(totalPageCount(21, 7)).toBe(3)
    expect(totalPageCount(100, 1)).toBe(100)
  })
})

describe("clampPage", () => {
  it("超出总页数时回退到最后有效页", () => {
    expect(clampPage(9, 20, 45)).toBe(3)
    expect(clampPage(2, 20, 0)).toBe(1)
    expect(clampPage(0, 20, 45)).toBe(1)
  })

  it("范围内页码保持不变", () => {
    expect(clampPage(2, 20, 45)).toBe(2)
  })

  it("pageSize 变大后落在新的末页上", () => {
    expect(clampPage(3, 50, 45)).toBe(1)
  })
})

describe("hasNextPage / nextPageParam", () => {
  it("按 pageSize 判断终页", () => {
    expect(hasNextPage(1, 20, 45)).toBe(true)
    expect(hasNextPage(3, 20, 45)).toBe(false)
    expect(hasNextPage(45, 1, 45)).toBe(false)
    expect(hasNextPage(44, 1, 45)).toBe(true)
  })

  it("终页时返回 undefined", () => {
    expect(nextPageParam({ page: 1, limit: 20, total: 45 })).toBe(2)
    expect(nextPageParam({ page: 3, limit: 20, total: 45 })).toBeUndefined()
    expect(nextPageParam({ page: 1, limit: 20, total: 0 })).toBeUndefined()
  })
})

describe("dedupeById", () => {
  it("跨页重复项只保留先出现的一条", () => {
    const items = [
      { id: "a", title: "first" },
      { id: "b", title: "second" },
      { id: "a", title: "duplicate" },
    ]
    expect(dedupeById(items)).toEqual([
      { id: "a", title: "first" },
      { id: "b", title: "second" },
    ])
  })

  it("空数组安全", () => {
    expect(dedupeById([])).toEqual([])
  })
})

describe("paginationItems", () => {
  it("单页只有 1", () => {
    expect(paginationItems(1, 1)).toEqual([1])
  })

  it("页数少时不出现省略号", () => {
    expect(paginationItems(2, 4)).toEqual([1, 2, 3, 4])
  })

  it("当前页居中，两端出现省略号", () => {
    expect(paginationItems(6, 12)).toEqual([1, "ellipsis", 5, 6, 7, "ellipsis", 12])
  })

  it("靠近首尾时只在另一侧省略", () => {
    expect(paginationItems(1, 12)).toEqual([1, 2, "ellipsis", 12])
    expect(paginationItems(12, 12)).toEqual([1, "ellipsis", 11, 12])
  })

  it("越界的当前页按边界处理", () => {
    expect(paginationItems(99, 5)).toEqual([1, "ellipsis", 4, 5])
  })
})
