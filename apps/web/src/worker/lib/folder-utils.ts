import type { Folder } from "@mankr/db"
import { FOLDER_MAX_DEPTH } from "@mankr/shared"

export function folderPathOf(id: string, parentPath: string | null | undefined): string {
  if (!parentPath || parentPath === "/") return `/${id}/`
  return `${parentPath}${id}/`
}

export function buildPathLabel(
  folder: Pick<Folder, "id" | "name" | "path">,
  byId: Map<string, Pick<Folder, "id" | "name">>,
): string {
  const ids = folder.path.split("/").filter(Boolean)
  const names = ids.map((id) => byId.get(id)?.name ?? id)
  return names.join(" / ")
}

/** 收集某文件夹及其全部子孙 id（含自身） */
export function collectSubtreeIds(
  rootId: string,
  all: Array<Pick<Folder, "id" | "path">>,
): string[] {
  const root = all.find((f) => f.id === rootId)
  if (!root) return [rootId]
  return all.filter((f) => f.path.startsWith(root.path)).map((f) => f.id)
}

export function maxDescendantDepth(
  rootId: string,
  all: Array<Pick<Folder, "id" | "path" | "depth">>,
): number {
  const root = all.find((f) => f.id === rootId)
  if (!root) return 0
  let max = root.depth
  for (const f of all) {
    if (f.path.startsWith(root.path) && f.depth > max) max = f.depth
  }
  return max
}

/** 移动后子树相对深度差；校验不超过 FOLDER_MAX_DEPTH */
export function wouldExceedMaxDepth(
  nodeDepthRelToRoot: number,
  newParentDepth: number,
): boolean {
  return newParentDepth + 1 + nodeDepthRelToRoot > FOLDER_MAX_DEPTH
}

export function isAncestorPath(ancestorPath: string, candidatePath: string): boolean {
  return candidatePath.startsWith(ancestorPath) && candidatePath !== ancestorPath
}
