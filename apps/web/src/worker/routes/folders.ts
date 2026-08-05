import { bookmarks, folders, type Db, type Folder } from "@mankr/db"
import {
  FOLDER_MAX_DEPTH,
  createFolderSchema,
  deleteFolderSchema,
  suggestFolderSlugSchema,
  updateFolderSchema,
} from "@mankr/shared"
import { and, asc, count, eq, isNull, ne } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { suggestFolderSlug } from "../lib/ai-service"
import {
  buildPathLabel,
  collectSubtreeIds,
  folderPathOf,
  isAncestorPath,
  maxDescendantDepth,
} from "../lib/folder-utils"
import { rateLimit } from "../lib/rate-limit"
import { getClientIp, nowIso } from "../lib/utils"
import { authByMethod } from "../middleware/auth"

export const folderRoutes = new Hono<AppEnv>()

folderRoutes.use("/folders", authByMethod())
folderRoutes.use("/folders/*", authByMethod())

function serializeFolder(
  r: Folder,
  bookmarkCount: number,
  pathLabel: string,
) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    color: r.color,
    sort_order: r.sortOrder,
    description: r.description,
    is_preset: r.isPreset,
    parent_id: r.parentId,
    depth: r.depth,
    path: r.path,
    path_label: pathLabel,
    count: bookmarkCount,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }
}

async function assertValidParent(
  db: Db,
  parentId: string | null | undefined,
  selfId?: string,
): Promise<
  | { ok: true; parent: Folder | null; depth: number }
  | { ok: false; status: 400 | 404; error: string; code: string }
> {
  if (parentId == null || parentId === undefined) {
    return { ok: true, parent: null, depth: 0 }
  }
  if (selfId && parentId === selfId) {
    return {
      ok: false,
      status: 400,
      error: "不能将自身设为父文件夹",
      code: "INVALID_PARENT",
    }
  }
  const parent = await db
    .select()
    .from(folders)
    .where(eq(folders.id, parentId))
    .get()
  if (!parent) {
    return { ok: false, status: 404, error: "父文件夹不存在", code: "NOT_FOUND" }
  }
  if (parent.depth >= FOLDER_MAX_DEPTH) {
    return {
      ok: false,
      status: 400,
      error: `最多 ${FOLDER_MAX_DEPTH + 1} 级文件夹`,
      code: "INVALID_PARENT",
    }
  }
  if (selfId) {
    const self = await db.select().from(folders).where(eq(folders.id, selfId)).get()
    if (self && isAncestorPath(self.path, parent.path)) {
      return {
        ok: false,
        status: 400,
        error: "不能移动到自身的子文件夹下",
        code: "INVALID_PARENT",
      }
    }
  }
  return { ok: true, parent, depth: parent.depth + 1 }
}

async function assertSlugUnique(
  db: Db,
  slug: string,
  parentId: string | null,
  excludeId?: string,
): Promise<boolean> {
  if (parentId == null) {
    const rows = await db.select().from(folders).where(isNull(folders.parentId))
    return !rows.some(
      (r) => r.slug === slug && (!excludeId || r.id !== excludeId),
    )
  }
  const conflict = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.parentId, parentId),
        eq(folders.slug, slug),
        excludeId ? ne(folders.id, excludeId) : undefined,
      ),
    )
    .get()
  return !conflict
}

folderRoutes.get("/folders", async (c) => {
  const db = c.get("db")
  const rows = await db
    .select()
    .from(folders)
    .orderBy(asc(folders.sortOrder), asc(folders.name))

  const countRows = await db
    .select({ folderId: bookmarks.folderId, value: count() })
    .from(bookmarks)
    .where(isNull(bookmarks.deletedAt))
    .groupBy(bookmarks.folderId)
  const directCount = new Map(
    countRows
      .filter((r) => r.folderId)
      .map((r) => [r.folderId as string, Number(r.value)]),
  )

  const byId = new Map(rows.map((r) => [r.id, r]))

  const subtreeCount = (id: string): number => {
    const ids = collectSubtreeIds(id, rows)
    return ids.reduce((sum, fid) => sum + (directCount.get(fid) ?? 0), 0)
  }

  return c.json({
    items: rows.map((r) =>
      serializeFolder(r, subtreeCount(r.id), buildPathLabel(r, byId)),
    ),
  })
})

folderRoutes.post("/folders/suggest-slug", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`folder-suggest-slug:${ip}`, 30, 60_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = suggestFolderSlugSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      400,
    )
  }

  const db = c.get("db")
  const result = await suggestFolderSlug(db, c.env, {
    name: parsed.data.name,
    parentId: parsed.data.parentId,
    excludeId: parsed.data.excludeId,
  })
  return c.json(result)
})

folderRoutes.post("/folders", async (c) => {
  const db = c.get("db")
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = createFolderSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      400,
    )
  }

  const parentCheck = await assertValidParent(db, parsed.data.parentId)
  if (!parentCheck.ok) {
    return c.json(
      { error: parentCheck.error, code: parentCheck.code },
      parentCheck.status,
    )
  }

  const name = parsed.data.name
  const parentId = parentCheck.parent?.id ?? null
  const explicitSlug = parsed.data.slug
  let slug: string
  if (explicitSlug) {
    if (!(await assertSlugUnique(db, explicitSlug, parentId))) {
      return c.json({ error: "同级 slug 已存在", code: "DUPLICATE" }, 409)
    }
    slug = explicitSlug
  } else {
    // 省略 slug：AI/回退管道 + 自动后缀，避免 409
    const suggested = await suggestFolderSlug(db, c.env, { name, parentId })
    slug = suggested.slug
  }

  const id = crypto.randomUUID()
  const now = nowIso()
  const path = folderPathOf(id, parentCheck.parent?.path)
  await db.insert(folders).values({
    id,
    name,
    slug,
    color: parsed.data.color ?? "#64748B",
    sortOrder: parsed.data.sortOrder ?? 200,
    description: parsed.data.description ?? null,
    isPreset: false,
    parentId,
    depth: parentCheck.depth,
    path,
    createdAt: now,
    updatedAt: now,
  })

  const row = await db.select().from(folders).where(eq(folders.id, id)).get()
  const byId = new Map([[id, row!]])
  if (parentCheck.parent) byId.set(parentCheck.parent.id, parentCheck.parent)
  return c.json(serializeFolder(row!, 0, buildPathLabel(row!, byId)), 201)
})

folderRoutes.patch("/folders/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = updateFolderSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      400,
    )
  }

  const existing = await db.select().from(folders).where(eq(folders.id, id)).get()
  if (!existing) {
    return c.json({ error: "文件夹不存在", code: "NOT_FOUND" }, 404)
  }

  let nextParent = existing.parentId
    ? await db.select().from(folders).where(eq(folders.id, existing.parentId)).get()
    : null
  let nextDepth = existing.depth
  let nextPath = existing.path

  if (parsed.data.parentId !== undefined) {
    const parentCheck = await assertValidParent(db, parsed.data.parentId, id)
    if (!parentCheck.ok) {
      return c.json(
        { error: parentCheck.error, code: parentCheck.code },
        parentCheck.status,
      )
    }
    nextParent = parentCheck.parent
    nextDepth = parentCheck.depth

    const all = await db.select().from(folders)
    const subtreeMax = maxDescendantDepth(id, all)
    const relativeExtra = subtreeMax - existing.depth
    if (nextDepth + relativeExtra > FOLDER_MAX_DEPTH) {
      return c.json(
        {
          error: `移动后超过最大 ${FOLDER_MAX_DEPTH + 1} 级深度`,
          code: "INVALID_PARENT",
        },
        400,
      )
    }
    nextPath = folderPathOf(id, nextParent?.path)
  }

  const nextSlug = parsed.data.slug ?? existing.slug
  const nextParentId = parsed.data.parentId !== undefined
    ? (nextParent?.id ?? null)
    : existing.parentId

  if (
    nextSlug !== existing.slug ||
    nextParentId !== existing.parentId
  ) {
    if (!(await assertSlugUnique(db, nextSlug, nextParentId, id))) {
      return c.json({ error: "同级 slug 已存在", code: "DUPLICATE" }, 409)
    }
  }

  const now = nowIso()
  await db
    .update(folders)
    .set({
      name: parsed.data.name ?? existing.name,
      slug: nextSlug,
      color: parsed.data.color ?? existing.color,
      description:
        parsed.data.description !== undefined
          ? parsed.data.description
          : existing.description,
      sortOrder: parsed.data.sortOrder ?? existing.sortOrder,
      parentId: nextParentId,
      depth: nextDepth,
      path: nextPath,
      updatedAt: now,
    })
    .where(eq(folders.id, id))

  // 级联重算子孙 path/depth
  if (nextPath !== existing.path || nextDepth !== existing.depth) {
    const all = await db.select().from(folders)
    const depthDelta = nextDepth - existing.depth
    const oldPrefix = existing.path
    for (const f of all) {
      if (f.id === id) continue
      if (!f.path.startsWith(oldPrefix)) continue
      const suffix = f.path.slice(oldPrefix.length)
      await db
        .update(folders)
        .set({
          path: `${nextPath}${suffix}`,
          depth: f.depth + depthDelta,
          updatedAt: now,
        })
        .where(eq(folders.id, f.id))
    }
  }

  const row = await db.select().from(folders).where(eq(folders.id, id)).get()
  const allRows = await db.select().from(folders)
  const byId = new Map(allRows.map((r) => [r.id, r]))
  return c.json(serializeFolder(row!, 0, buildPathLabel(row!, byId)))
})

folderRoutes.delete("/folders/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")
  const existing = await db
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.id, id))
    .get()
  if (!existing) {
    return c.json({ error: "文件夹不存在", code: "NOT_FOUND" }, 404)
  }

  const child = await db
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.parentId, id))
    .get()
  if (child) {
    return c.json(
      {
        error: "请先删除或迁移子文件夹",
        code: "HAS_CHILDREN",
      },
      409,
    )
  }

  let body: unknown = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }

  const parsed = deleteFolderSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      400,
    )
  }

  const { bookmarkAction, moveToFolderId } = parsed.data
  const ts = nowIso()

  if (bookmarkAction === "move") {
    if (moveToFolderId === id) {
      return c.json(
        { error: "不能迁移到即将删除的文件夹", code: "INVALID_TARGET" },
        400,
      )
    }
    const target = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.id, moveToFolderId!))
      .get()
    if (!target) {
      return c.json(
        { error: "目标文件夹不存在", code: "TARGET_NOT_FOUND" },
        404,
      )
    }
    await db
      .update(bookmarks)
      .set({ folderId: moveToFolderId!, updatedAt: ts })
      .where(and(eq(bookmarks.folderId, id), isNull(bookmarks.deletedAt)))
  } else if (bookmarkAction === "delete") {
    await db
      .update(bookmarks)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(bookmarks.folderId, id), isNull(bookmarks.deletedAt)))
  }
  // detach：依赖 FK onDelete set null，删除文件夹后自动清空 folder_id

  await db.delete(folders).where(eq(folders.id, id))
  return c.json({ ok: true, bookmark_action: bookmarkAction })
})
