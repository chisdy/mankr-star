import { AI_SUMMARY_MAX_CHARS } from "@mankr/shared"
import { describe, expect, it } from "vitest"
import {
  buildClassifyMessages,
  clipSummary,
  normalizeFolderName,
  prepareExcerptForPrompt,
  PROMPT_EXCERPT_MAX_CHARS,
  ruleBasedClassify,
  truncateFolderPath,
} from "../src/worker/lib/deepseek"
import { truncateKeepingBreaks } from "../src/worker/lib/url-metadata"
import { asciiSlugify, folderSlugBase } from "../src/worker/lib/utils"

describe("normalizeFolderName", () => {
  it("去掉空白并统一全角斜杠", () => {
    expect(normalizeFolderName("AI / LLM")).toBe(normalizeFolderName("AI／LLM"))
    expect(normalizeFolderName("  Agent  Skills ")).toBe("agentskills")
  })
})

describe("truncateFolderPath", () => {
  it("最多保留 3 段路径（AI 自动创建深度上限）", () => {
    expect(truncateFolderPath(["A", "B", "C", "D", "E"])).toEqual(["A", "B", "C"])
    expect(truncateFolderPath(["  根  ", "", "子"])).toEqual(["根", "子"])
  })
})

describe("asciiSlugify / folderSlugBase", () => {
  it("只保留英文 kebab，中文名回退 folder", () => {
    expect(asciiSlugify("Agent Skills")).toBe("agent-skills")
    expect(asciiSlugify("学习与教程")).toBe("")
    expect(folderSlugBase("学习与教程")).toBe("folder")
  })
})

describe("ruleBasedClassify", () => {
  it("无 Key 兜底：按语言粗分，不做领域关键词匹配", () => {
    const out = ruleBasedClassify({
      title: "mrdoob/three.js",
      description: "JavaScript 3D Library",
      language: "JavaScript",
      topics: ["webgl", "3d"],
    })
    expect(out.folder_path).toEqual(["工具与 CLI"])
  })

  it("无语言时落到其他", () => {
    const out = ruleBasedClassify({
      title: "acme/misc",
      description: null,
      language: null,
      topics: [],
    })
    expect(out.folder_path).toEqual(["其他"])
  })

  it("url 文档类归到学习与教程，不用 webpage/link", () => {
    const out = ruleBasedClassify({
      sourceType: "url",
      title: "React 入门教程",
      description: "官方文档指南",
      language: null,
      topics: [],
      siteName: "react.dev",
      contentExcerpt: "本教程介绍如何使用 React 构建界面",
    })
    expect(out.folder_path).toEqual(["学习与教程"])
    expect(out.tags).not.toContain("webpage")
    expect(out.tags).not.toContain("link")
    expect(out.summary).not.toMatch(/网页收藏/)
    expect(out.tags.length).toBeGreaterThanOrEqual(3)
  })

  it("url 无匹配主题时落到其他，摘要用描述", () => {
    const out = ruleBasedClassify({
      sourceType: "url",
      title: "Interesting Article",
      description: "关于城市绿化的观察笔记",
      language: null,
      topics: [],
      siteName: "example.com",
    })
    expect(out.folder_path).toEqual(["其他"])
    expect(out.summary).toContain("城市绿化")
    expect(out.tags).not.toContain("webpage")
  })
})

describe("clipSummary", () => {
  it("无句读时硬切到上限并带省略号", () => {
    const out = clipSummary("甲".repeat(AI_SUMMARY_MAX_CHARS + 120))
    expect(out).toBe(`${"甲".repeat(AI_SUMMARY_MAX_CHARS - 1)}…`)
  })

  it("唯一句号早于上限 60% 时不收成那一句", () => {
    const out = clipSummary(`短句。${"甲".repeat(AI_SUMMARY_MAX_CHARS + 80)}`)
    expect(out.endsWith("…")).toBe(true)
    expect(out.length).toBe(AI_SUMMARY_MAX_CHARS)
    expect(out).toContain("甲")
  })

  it("上限内的最后一个句号会保留，后面的句子丢掉", () => {
    const head = `${"甲".repeat(400)}。`
    const out = clipSummary(`${head}${"乙".repeat(200)}`)
    expect(out.endsWith("。")).toBe(true)
    expect(out).not.toContain("乙")
    expect(out.length).toBeLessThanOrEqual(AI_SUMMARY_MAX_CHARS)
  })

  it("英文句点不断开版本号", () => {
    const text = `${"甲".repeat(350)}版本 18.2 继续${"乙".repeat(200)}`
    const out = clipSummary(text)
    expect(out).toContain("18.2")
    expect(out.endsWith("…")).toBe(true)
  })
})

describe("prepareExcerptForPrompt", () => {
  it("先清徽章再截断，清掉开头徽章后才能看到窗口外的能力描述", () => {
    const badge =
      "[![ci](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/acme/repo/actions)\n"
    const badges = badge.repeat(50)
    const gap = "背景".repeat(1600)
    const marker = "支持离线增量同步"
    const raw = `${badges}${gap}${marker}${"尾".repeat(400)}`
    expect(badges.length).toBeGreaterThan(4000)
    expect(raw.indexOf(marker)).toBeGreaterThan(PROMPT_EXCERPT_MAX_CHARS)

    const out = prepareExcerptForPrompt(raw)
    expect(out).toContain(marker)
    expect(out.length).toBeLessThanOrEqual(PROMPT_EXCERPT_MAX_CHARS)
    expect(out).not.toContain("shields.io")
  })

  it("只去掉徽章图床上的图片，保留地址里带 badge 的截图", () => {
    const raw = [
      "[![架构](https://example.com/docs/badge-flow.png)](https://example.com/docs)",
      "![说明](https://example.com/images/badge-hero.png)",
      '<img src="https://example.com/badge-icon.png" alt="图">',
      "[![ci](https://badgen.net/badge/build/passing)](https://github.com/acme/repo)",
      "正文还在",
    ].join("\n")

    const out = prepareExcerptForPrompt(raw)
    expect(out).toContain("badge-flow.png")
    expect(out).toContain("badge-hero.png")
    expect(out).toContain("badge-icon.png")
    expect(out).toContain("正文还在")
    expect(out).not.toContain("badgen.net")
  })
})

describe("truncateKeepingBreaks", () => {
  it("保留换行，行内多余空格会压平", () => {
    expect(truncateKeepingBreaks("第一段\n\n第二段", 100)).toBe("第一段\n\n第二段")
    expect(truncateKeepingBreaks("第一段   第二段", 100)).toBe("第一段 第二段")
  })
})

describe("buildClassifyMessages", () => {
  const base = {
    title: "示例",
    description: "一段描述",
    url: "https://example.com/item",
    contentExcerpt: "正文里写了具体能力。",
  }

  it("三类来源都要求具体事实在前，并在上限内写完", () => {
    for (const sourceType of ["github", "url", "twitter"] as const) {
      const { system } = buildClassifyMessages(
        { ...base, sourceType },
        [],
      )
      expect(system).toContain("具体事实放在前面")
      expect(system).toContain("上限内把最后一句写完")
      expect(system).toContain(String(AI_SUMMARY_MAX_CHARS))
    }
  })

  it("GitHub 要求从 README 写能力，网页忽略导航，X 写帖子本身", () => {
    const github = buildClassifyMessages({ ...base, sourceType: "github" }, [])
    expect(github.system).toContain("不要只复述仓库的一句话简介")
    expect(github.system).toContain("从 README 里写能力与适用场景")

    const url = buildClassifyMessages({ ...base, sourceType: "url" }, [])
    expect(url.system).toContain("写页面实际主题")
    expect(url.system).toContain("Cookie")

    const twitter = buildClassifyMessages(
      { ...base, sourceType: "twitter" },
      [],
    )
    expect(twitter.system).toContain("这条帖子说了什么")
    expect(twitter.system).toContain("一条社交分享")
  })
})
