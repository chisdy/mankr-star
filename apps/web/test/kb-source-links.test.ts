import type { KbChatSource } from "@mankr/shared"
import { describe, expect, it } from "vitest"
import { bookmarkInternalHref } from "../src/features/kb/kb-source-links"

const bookmark: KbChatSource = {
  type: "bookmark",
  id: "bm_1",
  title: "某个收藏",
  url: "https://github.com/owner/repo",
  snippet: "摘要",
}

const web: KbChatSource = {
  type: "web",
  title: "某个网页",
  url: "https://example.com/post",
  snippet: "摘要",
}

describe("bookmarkInternalHref", () => {
  it("收藏来源给出站内详情链接", () => {
    expect(bookmarkInternalHref(bookmark)).toBe("/?bookmark=bm_1")
  })

  it("网页来源没有站内位置", () => {
    expect(bookmarkInternalHref(web)).toBeNull()
  })

  it("收藏来源缺 id 时降级为纯外链", () => {
    expect(bookmarkInternalHref({ ...bookmark, id: undefined })).toBeNull()
    expect(bookmarkInternalHref({ ...bookmark, id: "  " })).toBeNull()
  })
})
