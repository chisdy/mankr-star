import { settings, type Db } from "@mankr/db"
import { eq, sql } from "drizzle-orm"
import { nowIso } from "./utils"

/**
 * 扩展本地身份表的版本。单独占 settings 的一行，不进入 SETTING_KEYS，
 * 因此不会出现在 /me 和设置页。只有「这个网址算不算已收藏」发生变化时才 +1。
 */
export const BOOKMARK_MATCH_REVISION_KEY = "bookmark_match_revision"

export async function readBookmarkMatchRevision(db: Db): Promise<number> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, BOOKMARK_MATCH_REVISION_KEY))
    .get()
  if (!row) return 0
  try {
    const parsed = JSON.parse(row.value) as { revision?: unknown }
    return typeof parsed.revision === "number" &&
      Number.isFinite(parsed.revision)
      ? parsed.revision
      : 0
  } catch {
    return 0
  }
}

/**
 * 同一次请求或同一轮任务里只调用一次。
 * 自增写在一条 INSERT … ON CONFLICT 里，避免两次并发都读到同一个版本再写回。
 */
export async function bumpBookmarkMatchRevision(db: Db): Promise<number> {
  const updatedAt = nowIso()
  const rows = await db
    .insert(settings)
    .values({
      key: BOOKMARK_MATCH_REVISION_KEY,
      value: JSON.stringify({ revision: 1 }),
      updatedAt,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: sql`json_object('revision', COALESCE(CAST(json_extract(${settings.value}, '$.revision') AS INTEGER), 0) + 1)`,
        updatedAt,
      },
    })
    .returning({ value: settings.value })

  const raw = rows[0]?.value
  if (!raw) return readBookmarkMatchRevision(db)
  try {
    const parsed = JSON.parse(raw) as { revision?: unknown }
    return typeof parsed.revision === "number" &&
      Number.isFinite(parsed.revision)
      ? parsed.revision
      : 0
  } catch {
    return 0
  }
}

/** If-None-Match 与当前版本一致时，调用方不得再查询 bookmarks。 */
export function ifNoneMatchSatisfied(
  header: string | undefined,
  revision: number
): boolean {
  if (!header) return false
  const want = String(revision)
  return header.split(",").some((part) => {
    const token = part.trim()
    if (token === "*") return true
    const bare = token.replace(/^W\//i, "").replace(/^"/, "").replace(/"$/, "")
    return bare === want
  })
}
