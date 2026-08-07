import { describe, expect, it } from "vitest"
import {
  bookmarkDetailHref,
  readBookmarkDetailParams,
  tagFilterHref,
  withBookmarkDetail,
  withoutBookmarkDetail,
  withTagFilter,
} from "../src/features/bookmarks/bookmark-detail-params"

describe("readBookmarkDetailParams", () => {
  it("没有参数时不选中任何收藏", () => {
    expect(readBookmarkDetailParams(new URLSearchParams())).toEqual({
      bookmarkId: null,
      editing: false,
    })
  })

  it("只有 bookmark 时是展示态", () => {
    expect(
      readBookmarkDetailParams(new URLSearchParams("bookmark=bm_1")),
    ).toEqual({ bookmarkId: "bm_1", editing: false })
  })

  it("bookmark + edit=1 是编辑态", () => {
    expect(
      readBookmarkDetailParams(new URLSearchParams("bookmark=bm_1&edit=1")),
    ).toEqual({ bookmarkId: "bm_1", editing: true })
  })

  it("edit 只认 1，其它值一律当展示态", () => {
    expect(
      readBookmarkDetailParams(new URLSearchParams("bookmark=bm_1&edit=true"))
        .editing,
    ).toBe(false)
  })

  it("没选中收藏时残留的 edit 不生效", () => {
    expect(readBookmarkDetailParams(new URLSearchParams("edit=1"))).toEqual({
      bookmarkId: null,
      editing: false,
    })
  })

  it("空白 bookmark 视作未选中", () => {
    expect(
      readBookmarkDetailParams(new URLSearchParams("bookmark=%20")).bookmarkId,
    ).toBeNull()
  })
})

describe("withBookmarkDetail", () => {
  it("保留既有筛选参数", () => {
    const next = withBookmarkDetail(
      new URLSearchParams("folder_id=f_1&q=react&sort=stars"),
      "bm_1",
    )
    expect(next.get("folder_id")).toBe("f_1")
    expect(next.get("q")).toBe("react")
    expect(next.get("sort")).toBe("stars")
    expect(next.get("bookmark")).toBe("bm_1")
    expect(next.get("edit")).toBeNull()
  })

  it("进入编辑态写 edit=1，退出时删掉", () => {
    const editing = withBookmarkDetail(new URLSearchParams(), "bm_1", true)
    expect(editing.get("edit")).toBe("1")

    const viewing = withBookmarkDetail(editing, "bm_1", false)
    expect(viewing.get("bookmark")).toBe("bm_1")
    expect(viewing.get("edit")).toBeNull()
  })

  it("不改动传入的 URLSearchParams", () => {
    const original = new URLSearchParams("q=react")
    withBookmarkDetail(original, "bm_1", true)
    expect(original.get("bookmark")).toBeNull()
    expect(original.toString()).toBe("q=react")
  })

  it("切换收藏时覆盖旧 id", () => {
    const next = withBookmarkDetail(
      new URLSearchParams("bookmark=bm_1&edit=1"),
      "bm_2",
    )
    expect(next.getAll("bookmark")).toEqual(["bm_2"])
  })
})

describe("withoutBookmarkDetail", () => {
  it("只删详情参数，筛选条件原样保留", () => {
    const next = withoutBookmarkDetail(
      new URLSearchParams("folder_id=f_1&bookmark=bm_1&edit=1&archived=true"),
    )
    expect(next.get("bookmark")).toBeNull()
    expect(next.get("edit")).toBeNull()
    expect(next.get("folder_id")).toBe("f_1")
    expect(next.get("archived")).toBe("true")
  })
})

describe("bookmarkDetailHref", () => {
  it("指向收藏列表页并带上收藏参数", () => {
    expect(bookmarkDetailHref("bm_1")).toBe("/?bookmark=bm_1")
  })

  it("转义 id 里的特殊字符", () => {
    expect(bookmarkDetailHref("a b&c")).toBe("/?bookmark=a%20b%26c")
  })
})

describe("withTagFilter", () => {
  it("关掉详情弹窗并写入 tag，页码回到第一页", () => {
    const next = withTagFilter(
      new URLSearchParams(
        "bookmark=bm_1&edit=1&page=3&folder_id=f_1&source_type=url",
      ),
      "beam.jakubantalik.com",
    )
    expect(next.get("bookmark")).toBeNull()
    expect(next.get("edit")).toBeNull()
    expect(next.get("page")).toBeNull()
    expect(next.get("tag")).toBe("beam.jakubantalik.com")
    expect(next.get("folder_id")).toBe("f_1")
    expect(next.get("source_type")).toBe("url")
  })

  it("覆盖已有 tag", () => {
    const next = withTagFilter(
      new URLSearchParams("tag=old&q=react"),
      "new",
    )
    expect(next.get("tag")).toBe("new")
    expect(next.get("q")).toBe("react")
  })
})

describe("tagFilterHref", () => {
  it("回首页并只带 tag", () => {
    expect(tagFilterHref("react")).toBe("/?tag=react")
  })

  it("转义特殊字符", () => {
    expect(tagFilterHref("beam.jakubantalik.com")).toBe(
      "/?tag=beam.jakubantalik.com",
    )
    expect(tagFilterHref("a b&c")).toBe("/?tag=a%20b%26c")
  })
})
