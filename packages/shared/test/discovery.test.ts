import { describe, expect, it } from "vitest"
import {
  discoveryChannelsResponseSchema,
  discoveryResponseSchema,
} from "../src/discovery"

const observedAt = "2026-10-08T00:05:00.000Z"
function createResponse() {
  return {
    enabled: true,
    channel: "ai",
    state: "ready",
    edition: {
      id: "edition-1",
      day: "2026-10-08",
      revision: 1,
      publishedAt: observedAt,
      ruleVersion: "v1",
    },
    items: [
      {
        id: "item-1",
        title: "LLM 工具",
        summary: null,
        url: "https://github.com/example/llm",
        sourceType: "github",
        rank: 1,
        publishedAt: null,
        evidence: [
          {
            source: "github",
            sourceId: "github:ai",
            url: "https://github.com/example/llm",
            observedAt,
            publishedAt: null,
            stars: 100,
            growth: null,
            previousObservedAt: null,
          },
        ],
      },
    ],
    sources: [
      {
        source: "github",
        sourceId: "github:ai",
        state: "fresh",
        lastSuccessAt: observedAt,
        errorCode: null,
      },
    ],
    sync: {
      state: "succeeded",
      startedAt: observedAt,
      finishedAt: observedAt,
      errorCode: null,
    },
  }
}

describe("每日发现共享契约", () => {
  it("允许访客省略私人收藏字段以及首次增长缺失", () => {
    const result = discoveryResponseSchema.parse(createResponse())
    expect(result.items[0]).not.toHaveProperty("savedBookmarkId")
    expect(result.items[0]!.evidence[0]!.growth).toBeNull()
  })

  it("保留真实零增长和负增长", () => {
    for (const growth of [0, -3]) {
      const response = createResponse()
      const evidence = { ...response.items[0]!.evidence[0]!, growth }
      const result = discoveryResponseSchema.parse({
        ...response,
        items: [{ ...response.items[0], evidence: [evidence] }],
      })
      expect(result.items[0]!.evidence[0]!.growth).toBe(growth)
    }
  })

  it("拒绝未知频道、脚本外链及超出展示上限的响应", () => {
    const response = createResponse()
    expect(
      discoveryResponseSchema.safeParse({ ...response, channel: "custom" })
        .success
    ).toBe(false)
    expect(
      discoveryResponseSchema.safeParse({
        ...response,
        items: [{ ...response.items[0], url: "javascript:alert(1)" }],
      }).success
    ).toBe(false)
    expect(
      discoveryResponseSchema.safeParse({
        ...response,
        items: Array.from({ length: 21 }, () => response.items[0]),
      }).success
    ).toBe(false)
  })

  it("频道清单分别传递部署开关与发布就绪状态", () => {
    expect(
      discoveryChannelsResponseSchema.parse({
        enabled: true,
        ready: false,
        channels: ["ai", "frontend", "backend", "tools"].map((id) => ({ id })),
      }).ready
    ).toBe(false)
    expect(
      discoveryChannelsResponseSchema.safeParse({
        enabled: true,
        ready: false,
        channels: Array.from({ length: 4 }, () => ({ id: "ai" })),
      }).success
    ).toBe(false)
  })

  it("发现内容与来源链接均限制为2048字符，保留合法链接的完整身份", () => {
    const response = createResponse()
    const prefix = "https://example.com/article?variant="
    const url = prefix + "a".repeat(2048 - prefix.length)
    const item = {
      ...response.items[0]!,
      sourceType: "url",
      url,
      evidence: [{ ...response.items[0]!.evidence[0]!, url }],
    }
    const parsed = discoveryResponseSchema.parse({ ...response, items: [item] })
    expect(parsed.items[0]!.url).toBe(url)
    expect(parsed.items[0]!.evidence[0]!.url).toBe(url)
    expect(
      discoveryResponseSchema.safeParse({
        ...response,
        items: [{ ...item, url: `${url}b` }],
      }).success
    ).toBe(false)
    expect(
      discoveryResponseSchema.safeParse({
        ...response,
        items: [
          { ...item, evidence: [{ ...item.evidence[0], url: `${url}b` }] },
        ],
      }).success
    ).toBe(false)
  })

  it("响应保留完整Unicode文本并拒绝孤立代理字符", () => {
    const response = createResponse()
    const title = '模型😀 "说明" \\ \ue000'
    const summary = "𠮷".repeat(1000)
    const item = { ...response.items[0]!, title, summary }
    const parsed = discoveryResponseSchema.parse({ ...response, items: [item] })
    expect(parsed.items[0]!.title).toBe(title)
    expect(parsed.items[0]!.summary).toBe(summary)

    for (const invalid of ["\ud800", "\udfff", "文本\ud83d结束"]) {
      for (const field of ["title", "summary"] as const) {
        expect(
          discoveryResponseSchema.safeParse({
            ...response,
            items: [{ ...item, [field]: invalid }],
          }).success
        ).toBe(false)
      }
      expect(
        discoveryResponseSchema.safeParse({
          ...response,
          items: [{ ...item, url: `https://example.com/${invalid}` }],
        }).success
      ).toBe(false)
    }
  })
})
