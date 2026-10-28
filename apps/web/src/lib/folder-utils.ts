import { wouldExceedMaxDepth } from "@mankr/shared"

import { DEFAULT_LOCALE, readStoredLocale } from "../i18n/locales"
import type { Folder } from "@/lib/types"

function sortLocale(): string {
  return readStoredLocale() ?? DEFAULT_LOCALE
}

function folderSort(a: Folder, b: Folder): number {
  return (
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    a.name.localeCompare(b.name, sortLocale(), { sensitivity: "base" })
  )
}

/** 展示用：path_label 或从 path 拼接「父 / 子」 */
export function folderPathLabel(folder: Folder, all: Folder[]): string {
  if (folder.path_label) return folder.path_label
  const ids = folder.path.split("/").filter(Boolean)
  const names = ids.map((id) => all.find((f) => f.id === id)?.name ?? id)
  return names.join(" / ")
}

/** 下拉选项：按 path 深度优先排序，label 按 depth 缩进 */
export function sortedFoldersForSelect(folders: Folder[]): Folder[] {
  return [...folders].sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path)
    if (pathCmp !== 0) return pathCmp
    return folderSort(a, b)
  })
}

export function folderSelectLabel(folder: Folder, all: Folder[]): string {
  const indent = folder.depth > 0 ? `${"　".repeat(folder.depth)}` : ""
  return `${indent}${folderPathLabel(folder, all)}`
}

export function childrenOf(
  parentId: string | null,
  folders: Folder[]
): Folder[] {
  return folders
    .filter((f) =>
      parentId === null ? f.parent_id == null : f.parent_id === parentId
    )
    .sort(folderSort)
}

export function topLevelFolders(folders: Folder[]): Folder[] {
  return childrenOf(null, folders)
}

/** 收集某文件夹及其全部子孙 id（含自身） */
export function collectSubtreeFolderIds(
  rootId: string,
  all: Pick<Folder, "id" | "path">[]
): string[] {
  const root = all.find((f) => f.id === rootId)
  if (!root) return [rootId]
  return all.filter((f) => f.path.startsWith(root.path)).map((f) => f.id)
}

/**
 * 按名称模糊过滤文件夹树：保留匹配项及其祖先，便于树形展示。
 * 返回 `{ folders, expandIds }`，`expandIds` 为搜索时应展开的父节点。
 */
export function filterFoldersByName(
  folders: Folder[],
  query: string
): { folders: Folder[]; expandIds: string[] } {
  const q = query.trim().toLowerCase()
  if (!q) return { folders, expandIds: [] }

  const matched = folders.filter((f) => f.name.toLowerCase().includes(q))
  if (matched.length === 0) return { folders: [], expandIds: [] }

  const keep = new Set<string>()
  for (const folder of matched) {
    for (const id of folder.path.split("/").filter(Boolean)) {
      keep.add(id)
    }
  }

  const filtered = folders.filter((f) => keep.has(f.id))
  const expandIds = filtered
    .filter((f) => filtered.some((c) => c.parent_id === f.id))
    .map((f) => f.id)

  return { folders: filtered, expandIds }
}

export type FolderDropPosition = "before" | "after" | "inside"

export type FolderDropPlan =
  | {
      ok: true
      parentId: string | null
      orderedIds: string[]
      parentChanged: boolean
    }
  | { ok: false; reason: "invalid" | "depth" | "noop" }

/** 子树比自身深几级；叶子为 0 */
function subtreeDepthSpan(root: Folder, folders: Folder[]): number {
  let max = root.depth
  for (const folder of folders) {
    if (folder.path.startsWith(root.path) && folder.depth > max) {
      max = folder.depth
    }
  }
  return max - root.depth
}

/**
 * 计算拖放后的父级与同级顺序。
 * before/after：排到目标行的同一父级；inside：成为目标文件夹的最后一个子级。
 * 不能拖进自身子树，移动后也不能超过最大深度。
 */
export function planFolderDrop(
  folders: Folder[],
  draggedId: string,
  targetId: string,
  position: FolderDropPosition
): FolderDropPlan {
  const dragged = folders.find((folder) => folder.id === draggedId)
  const target = folders.find((folder) => folder.id === targetId)
  if (!dragged || !target) return { ok: false, reason: "invalid" }
  if (target.path.startsWith(dragged.path))
    return { ok: false, reason: "invalid" }

  const parentId =
    position === "inside" ? target.id : (target.parent_id ?? null)
  let newParentDepth = -1
  if (parentId) {
    const parent = folders.find((folder) => folder.id === parentId)
    if (!parent || parent.path.startsWith(dragged.path)) {
      return { ok: false, reason: "invalid" }
    }
    newParentDepth = parent.depth
  }
  if (wouldExceedMaxDepth(subtreeDepthSpan(dragged, folders), newParentDepth)) {
    return { ok: false, reason: "depth" }
  }

  const siblings = childrenOf(parentId, folders).filter(
    (folder) => folder.id !== dragged.id
  )
  let insertIdx = siblings.length
  if (position !== "inside") {
    const targetIdx = siblings.findIndex((folder) => folder.id === target.id)
    if (targetIdx < 0) return { ok: false, reason: "invalid" }
    insertIdx = position === "after" ? targetIdx + 1 : targetIdx
  }

  const next = [...siblings]
  next.splice(insertIdx, 0, dragged)
  const orderedIds = next.map((folder) => folder.id)
  const sameParent = (dragged.parent_id ?? null) === parentId
  if (sameParent) {
    const originalIds = childrenOf(parentId, folders).map((folder) => folder.id)
    if (orderedIds.every((id, index) => id === originalIds[index])) {
      return { ok: false, reason: "noop" }
    }
  }

  return {
    ok: true,
    parentId,
    orderedIds,
    parentChanged: !sameParent,
  }
}
