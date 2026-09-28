import { folders, type Db } from "@mankr/db"
import { FOLDER_MAX_DEPTH } from "@mankr/shared"
import { eq } from "drizzle-orm"
import { allocateFolderSlug } from "./ai-service"
import { normalizeFolderName } from "./deepseek"
import { folderPathOf } from "./folder-utils"
import { nowIso } from "./utils"

/** 书签栏根算起，最多 5 级（depth 0–4）。多出来的并进最深一级的名称。 */
const BROWSER_FOLDER_MAX_SEGMENTS = FOLDER_MAX_DEPTH + 1

/**
 * 浏览器原目录专用。不要改成 truncateFolderPath：
 * 那条只留 3 级，是给单条 AI 建夹用的。
 */
export function truncateBrowserFolderPath(names: string[]): string[] {
  const cleaned = names.map((name) => name.trim()).filter(Boolean)
  if (cleaned.length <= BROWSER_FOLDER_MAX_SEGMENTS) return cleaned
  const head = cleaned.slice(0, BROWSER_FOLDER_MAX_SEGMENTS - 1)
  const tail = cleaned.slice(BROWSER_FOLDER_MAX_SEGMENTS - 1).join(" / ")
  return [...head, tail]
}

export type BrowserFolderCache = Map<string, string>

function cacheKey(parentId: string | null, name: string): string {
  return `${parentId ?? ""}:${normalizeFolderName(name)}`
}

/**
 * 按名称路径确保文件夹存在，同级同名复用。
 * 只在用户确认写入之后调用。slug 走 allocateFolderSlug，不翻译。
 */
export async function ensureBrowserFolderPath(
  db: Db,
  names: string[],
  cache: BrowserFolderCache
): Promise<string | null> {
  const segments = truncateBrowserFolderPath(names)
  if (segments.length === 0) return null

  let parentId: string | null = null
  let parentPath: string | null = null
  let leafId = ""

  for (let i = 0; i < segments.length; i++) {
    const name = segments[i]!.trim()
    const key = cacheKey(parentId, name)
    const cached = cache.get(key)
    if (cached) {
      const row = await db
        .select({ path: folders.path })
        .from(folders)
        .where(eq(folders.id, cached))
        .get()
      leafId = cached
      parentId = cached
      parentPath = row?.path ?? parentPath
      continue
    }

    const candidates = await db.select().from(folders)
    const existing = candidates.find(
      (folder) =>
        (folder.parentId ?? null) === parentId &&
        normalizeFolderName(folder.name) === normalizeFolderName(name)
    )
    if (existing) {
      cache.set(key, existing.id)
      leafId = existing.id
      parentId = existing.id
      parentPath = existing.path
      continue
    }

    const id = crypto.randomUUID()
    const slug = await allocateFolderSlug(db, name, parentId)
    const path = folderPathOf(id, parentPath)
    const now = nowIso()
    await db.insert(folders).values({
      id,
      name,
      slug,
      color: "#64748B",
      sortOrder: 200,
      isPreset: false,
      parentId,
      depth: i,
      path,
      createdAt: now,
      updatedAt: now,
    })
    cache.set(key, id)
    leafId = id
    parentId = id
    parentPath = path
  }

  return leafId || null
}
