import { describe, expect, it } from "vitest"
import { buildKbSuggestionSlots } from "../src/features/kb/kb-suggestions"

const FOLDERS = [
  { name: "前端框架", count: 12 },
  { name: "状态管理", count: 8 },
  { name: "数据库", count: 3 },
  { name: "空分类", count: 0 },
]
const TAGS = [
  { name: "react", count: 9 },
  { name: "sqlite", count: 4 },
]

describe("buildKbSuggestionSlots", () => {
  it("按热度混搭分类与标签，最多三条", () => {
    const slots = buildKbSuggestionSlots({
      folders: FOLDERS,
      tags: TAGS,
      offset: 0,
    })

    expect(slots).toEqual([
      { kind: "folderSummary", name: "前端框架" },
      { kind: "tagFind", name: "react" },
      { kind: "folderBridge", name: "前端框架", other: "状态管理" },
    ])
  })

  it("offset 循环换一批，走完候选后回到开头", () => {
    const first = buildKbSuggestionSlots({
      folders: FOLDERS,
      tags: TAGS,
      offset: 0,
    })
    const second = buildKbSuggestionSlots({
      folders: FOLDERS,
      tags: TAGS,
      offset: 1,
    })

    expect(second[0]).toEqual({ kind: "folderSummary", name: "状态管理" })
    expect(second).not.toEqual(first)
    // 三个有效分类、两个标签，各自独立循环，六次后同时回到原点
    expect(
      buildKbSuggestionSlots({ folders: FOLDERS, tags: TAGS, offset: 6 }),
    ).toEqual(first)
  })

  it("空计数的分类不进候选", () => {
    const slots = buildKbSuggestionSlots({
      folders: [{ name: "空分类", count: 0 }],
      tags: [],
      offset: 0,
    })
    expect(slots).toEqual([{ kind: "recent" }])
  })

  it("只有一个分类时不拼跨分类问题", () => {
    const slots = buildKbSuggestionSlots({
      folders: [{ name: "前端框架", count: 5 }],
      tags: [],
      offset: 0,
    })
    expect(slots).toEqual([
      { kind: "folderSummary", name: "前端框架" },
      { kind: "recent" },
    ])
  })

  it("只有标签时用标签的两种问法", () => {
    const slots = buildKbSuggestionSlots({
      folders: [],
      tags: TAGS,
      offset: 0,
    })
    expect(slots).toEqual([
      { kind: "tagFind", name: "react" },
      { kind: "tagCompare", name: "sqlite" },
      { kind: "recent" },
    ])
  })
})
