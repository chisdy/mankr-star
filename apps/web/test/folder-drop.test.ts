import { FOLDER_MAX_DEPTH } from "@mankr/shared"
import { describe, expect, it } from "vitest"

import { planFolderDrop } from "../src/lib/folder-utils"
import type { Folder } from "../src/lib/types"

function folder(id: string, parent: Folder | null, sortOrder: number): Folder {
  return {
    id,
    name: id,
    slug: id,
    sort_order: sortOrder,
    parent_id: parent?.id ?? null,
    depth: parent ? parent.depth + 1 : 0,
    path: parent ? `${parent.path}${id}/` : `/${id}/`,
  }
}

describe("planFolderDrop", () => {
  const rootA = folder("a", null, 10)
  const childA1 = folder("a1", rootA, 10)
  const childA2 = folder("a2", rootA, 20)
  const grand = folder("a1a", childA1, 10)
  const rootB = folder("b", null, 20)
  const childB1 = folder("b1", rootB, 10)
  const folders = [rootA, childA1, childA2, grand, rootB, childB1]

  it("同级 before/after 只改顺序，不改父级", () => {
    const before = planFolderDrop(folders, "b", "a", "before")
    expect(before).toMatchObject({
      ok: true,
      parentId: null,
      orderedIds: ["b", "a"],
      parentChanged: false,
    })

    const after = planFolderDrop(folders, "a", "b", "after")
    expect(after).toMatchObject({
      ok: true,
      parentId: null,
      orderedIds: ["b", "a"],
      parentChanged: false,
    })
  })

  it("拖到其他父级的子行旁边时，父级改为该行的父文件夹", () => {
    const plan = planFolderDrop(folders, "a2", "b1", "before")
    expect(plan).toEqual({
      ok: true,
      parentId: "b",
      orderedIds: ["a2", "b1"],
      parentChanged: true,
    })
  })

  it("拖到根行旁边时，子文件夹提升为根级并插到该位置", () => {
    const plan = planFolderDrop(folders, "a2", "b", "before")
    expect(plan).toEqual({
      ok: true,
      parentId: null,
      orderedIds: ["a", "a2", "b"],
      parentChanged: true,
    })
  })

  it("拖到行中间时，目标文件夹成为新父级，并排到子级末尾", () => {
    const plan = planFolderDrop(folders, "a2", "b", "inside")
    expect(plan).toEqual({
      ok: true,
      parentId: "b",
      orderedIds: ["b1", "a2"],
      parentChanged: true,
    })
  })

  it("不能拖进自身或子树", () => {
    expect(planFolderDrop(folders, "a", "a1", "inside").ok).toBe(false)
    expect(planFolderDrop(folders, "a", "a1a", "before").ok).toBe(false)
    expect(planFolderDrop(folders, "a", "a", "after").ok).toBe(false)
  })

  it("位置没有变化时不提交", () => {
    expect(planFolderDrop(folders, "a2", "a1", "after")).toMatchObject({
      ok: false,
      reason: "noop",
    })
  })

  it("移动后超过最大深度时拒绝", () => {
    let parent: Folder | null = null
    const chain: Folder[] = []
    for (let depth = 0; depth <= FOLDER_MAX_DEPTH; depth += 1) {
      const node = folder(`d${depth}`, parent, 10)
      chain.push(node)
      parent = node
    }
    const other = folder("other", null, 20)
    const deep = planFolderDrop([...chain, other], "d0", "other", "inside")
    expect(deep).toEqual({ ok: false, reason: "depth" })
  })
})
