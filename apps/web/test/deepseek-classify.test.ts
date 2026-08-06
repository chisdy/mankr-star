import { describe, expect, it } from "vitest"
import {
  normalizeFolderName,
  ruleBasedClassify,
  truncateFolderPath,
} from "../src/worker/lib/deepseek"
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
