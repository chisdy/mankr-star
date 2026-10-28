import { describe, expect, it } from "vitest"
import { extractSlugWords } from "../src/worker/lib/deepseek"
import { slugWhenAiMissed } from "../src/worker/lib/utils"

describe("slugWhenAiMissed", () => {
  it("已有合法 slug 时保留，不按英文名称机械转写", () => {
    expect(slugWhenAiMissed("Agent Skills", "my-custom-slug")).toEqual({
      slug: "my-custom-slug",
      keptCurrent: true,
    })
    expect(slugWhenAiMissed("前端框架", "frontend-framework")).toEqual({
      slug: "frontend-framework",
      keptCurrent: true,
    })
  })

  it("没有当前 slug 时才按名称转写，中文名落到 folder", () => {
    expect(slugWhenAiMissed("Agent Skills", null)).toEqual({
      slug: "agent-skills",
      keptCurrent: false,
    })
    expect(slugWhenAiMissed("书法书法", "")).toEqual({
      slug: "folder",
      keptCurrent: false,
    })
  })

  it("当前值不是合法 slug 时不保留", () => {
    expect(slugWhenAiMissed("Tools", "工具")).toEqual({
      slug: "tools",
      keptCurrent: false,
    })
  })
})

describe("extractSlugWords", () => {
  it("从完整 JSON 取出英文词", () => {
    expect(extractSlugWords('{"slug_words":"calligraphy"}')).toBe("calligraphy")
  })

  it("思考被截断、正文为空时拿不到词", () => {
    expect(extractSlugWords("")).toBe("")
    expect(
      extractSlugWords(
        '我们需要回答 JSON only. Need process Chinese folder name "书法书法".'
      )
    ).toBe("")
  })

  it("正文为空时可以从思考文本里的 JSON 取出词", () => {
    const reasoning =
      '先想名称是书法。最终只输出 JSON：{"slug_words":"calligraphy"}'
    expect(extractSlugWords(reasoning)).toBe("calligraphy")
  })
})
