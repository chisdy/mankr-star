import { afterEach, describe, expect, it } from "vitest"
import { indexItems, matchUrl } from "../../extension/src/match-index"
import { savedStatusText } from "../../extension/src/source-label"

const article = {
  id: "wechat-1",
  source_type: "wechat",
  canonical_url: "https://mp.weixin.qq.com/s/abc",
  external_id: "mp.weixin.qq.com/s/abc",
  archived: false,
}

describe("extension wechat match", () => {
  afterEach(() => {
    indexItems([])
  })

  it("打开已收藏的公众号文章时匹配为已收藏，并标出来源", () => {
    indexItems([article])

    const hit = matchUrl("https://mp.weixin.qq.com/s/abc?utm_source=chat")
    expect(hit?.id).toBe("wechat-1")
    expect(hit?.source_type).toBe("wechat")
    expect(savedStatusText(hit!)).toBe("已收藏 · 微信公众号")
  })

  it("同一篇长链换了 scene、chksm 仍然对得上", () => {
    indexItems([
      {
        id: "wechat-long",
        source_type: "wechat",
        canonical_url:
          "https://mp.weixin.qq.com/s?__biz=MzA&mid=9&idx=1&sn=abc&scene=1&chksm=old",
        external_id: "mp.weixin.qq.com/s",
        archived: false,
      },
    ])

    const hit = matchUrl(
      "https://mp.weixin.qq.com/s?chksm=new&scene=126&sn=abc&idx=1&mid=9&__biz=MzA#rd"
    )
    expect(hit?.id).toBe("wechat-long")
  })

  it("未收录的公众号文章不会显示已收藏", () => {
    indexItems([article])
    expect(matchUrl("https://mp.weixin.qq.com/s/other")).toBeNull()
  })

  it("公众号不会误匹配成 GitHub 或普通网页索引", () => {
    indexItems([
      {
        ...article,
        id: "web-1",
        source_type: "url",
        canonical_url: "https://example.com/post",
        external_id: "example.com/post",
      },
    ])
    expect(matchUrl("https://mp.weixin.qq.com/s/abc")).toBeNull()
  })
})
