import { describe, expect, it } from "vitest"
import { parseWechatArticleHtml } from "../src/worker/lib/wechat"

const ARTICLE = `<!doctype html><html><head>
  <title>备用标题</title>
  <meta property="og:title" content="知识库怎么建" />
  <meta property="og:description" content="摘录说明" />
  <meta property="og:image" content="https://mmbiz.qpic.cn/cover.jpg" />
</head><body>
  <a id="js_name">曼库笔记</a>
  <div id="js_content">
    <p>第一段讲收藏时要保存清洗后的正文，供检索和摘要使用。</p>
    <p>第二段讲提问时只放短摘录，不要把整篇文章塞进每一次对话。</p>
    <script>var secret = "不要进正文"</script>
  </div>
</body></html>`

describe("parseWechatArticleHtml", () => {
  it("抽出纯文本正文和公众号名，不保留 HTML", async () => {
    const article = await parseWechatArticleHtml(
      ARTICLE,
      "https://mp.weixin.qq.com/s?__biz=MzA&mid=9&idx=1&sn=abc"
    )
    expect(article.syncOk).toBe(true)
    expect(article.title).toBe("知识库怎么建")
    expect(article.accountName).toBe("曼库笔记")
    expect(article.contentExcerpt).toContain("第一段讲收藏时要保存清洗后的正文")
    expect(article.contentExcerpt).toContain("第二段讲提问时只放短摘录")
    expect(article.contentExcerpt).not.toContain("<p>")
    expect(article.contentExcerpt).not.toContain("不要进正文")
    expect(article.platformMeta).toMatchObject({
      kind: "wechat_article",
      biz: "MzA",
      mid: "9",
      idx: "1",
      sn: "abc",
    })
  })

  it("验证页不算成功，正文留空", async () => {
    const article = await parseWechatArticleHtml(
      "<html><head><title>环境异常</title></head><body>环境异常，完成验证后即可继续访问</body></html>",
      "https://mp.weixin.qq.com/s/blocked"
    )
    expect(article.syncOk).toBe(false)
    expect(article.contentExcerpt).toBeNull()
    expect(article.syncError).toBe("微信返回验证页")
  })

  it("正文够长时，文中引用验证提示也不否决", async () => {
    const article = await parseWechatArticleHtml(
      `<html><head><meta property="og:title" content="排查记录" /></head><body>
        <div id="js_content"><p>文中提到环境异常这几个字，但后面还有完整段落，说明这是文章正文而不是验证页，应当保存下来给知识库检索。</p></div>
      </body></html>`,
      "https://mp.weixin.qq.com/s/quoted"
    )
    expect(article.syncOk).toBe(true)
    expect(article.contentExcerpt).toContain("环境异常")
  })
})
