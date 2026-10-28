import { folders, type Db, type Folder } from "@mankr/db"
import { eq, isNull } from "drizzle-orm"

export { wouldExceedMaxDepth } from "@mankr/shared"

export async function nextFolderSortOrder(
  db: Db,
  parentId: string | null | undefined
): Promise<number> {
  const pid = parentId ?? null
  const rows = await db
    .select({ sortOrder: folders.sortOrder })
    .from(folders)
    .where(pid === null ? isNull(folders.parentId) : eq(folders.parentId, pid))
  if (rows.length === 0) return 10
  const max = Math.max(...rows.map((r) => r.sortOrder))
  return max + 10
}

export function folderPathOf(
  id: string,
  parentPath: string | null | undefined
): string {
  if (!parentPath || parentPath === "/") return `/${id}/`
  return `${parentPath}${id}/`
}

export function buildPathLabel(
  folder: Pick<Folder, "id" | "name" | "path">,
  byId: Map<string, Pick<Folder, "id" | "name">>
): string {
  const ids = folder.path.split("/").filter(Boolean)
  const names = ids.map((id) => byId.get(id)?.name ?? id)
  return names.join(" / ")
}

/** 收集某文件夹及其全部子孙 id（含自身） */
export function collectSubtreeIds(
  rootId: string,
  all: Array<Pick<Folder, "id" | "path">>
): string[] {
  const root = all.find((f) => f.id === rootId)
  if (!root) return [rootId]
  return all.filter((f) => f.path.startsWith(root.path)).map((f) => f.id)
}

export function maxDescendantDepth(
  rootId: string,
  all: Array<Pick<Folder, "id" | "path" | "depth">>
): number {
  const root = all.find((f) => f.id === rootId)
  if (!root) return 0
  let max = root.depth
  for (const f of all) {
    if (f.path.startsWith(root.path) && f.depth > max) max = f.depth
  }
  return max
}

export function isAncestorPath(
  ancestorPath: string,
  candidatePath: string
): boolean {
  return (
    candidatePath.startsWith(ancestorPath) && candidatePath !== ancestorPath
  )
}
