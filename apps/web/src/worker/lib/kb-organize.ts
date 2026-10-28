import type { Db } from "@mankr/db"
import { bookmarks, folders, kbMessages } from "@mankr/db"
import {
  FOLDER_MAX_DEPTH,
  KB_ORGANIZE_LABEL_MAX_CHARS,
  KB_ORGANIZE_MAX_BOOKMARK_IDS,
  KB_ORGANIZE_MAX_OPS,
  KB_ORGANIZE_REASON_MAX_CHARS,
  kbOrganizeProposalSchema,
  type KbOrganizeOp,
  type KbOrganizeProposal,
  type KbOrganizeSkipped,
} from "@mankr/shared"
import { and, eq, inArray } from "drizzle-orm"
import { normalizeFolderName } from "./deepseek"
import {
  folderPathOf,
  isAncestorPath,
  maxDescendantDepth,
  wouldExceedMaxDepth,
} from "./folder-utils"
import { folderSlugBase, nowIso } from "./utils"

const ORGANIZE_UUID_NAMESPACE = new Uint8Array([
  0x6b, 0x8f, 0x3c, 0x2a, 0x1e, 0x7b, 0x64, 0x5d, 0x10, 0x9e, 0x2a, 0x4c, 0x6b,
  0x8d, 0x0e, 0x1f,
])

export type OrganizeFolder = {
  id: string
  name: string
  slug: string
  parentId: string | null
  depth: number
  path: string
}

export type OrganizeBookmark = {
  id: string
  title: string
  folderId: string | null
  deleted: boolean
  archived: boolean
}

export type OrganizeWorld = {
  folders: OrganizeFolder[]
  bookmarks: OrganizeBookmark[]
}

export type OrganizeDraft = {
  opId: string
  reason: string
} & (
  | { type: "rename_folder"; folderId: string; name: string }
  | {
      type: "create_folder"
      key: string
      name: string
      parentId: string | null
      parentKey: string | null
    }
  | {
      type: "move_folder"
      folderId: string
      parentId: string | null
      parentKey: string | null
    }
  | {
      type: "move_bookmarks"
      bookmarkIds: string[]
      folderId: string | null
      folderKey: string | null
    }
  | {
      type: "merge_folders"
      sourceId: string
      targetId: string | null
      targetKey: string | null
    }
)

export type SimulateOptions = {
  /** key → 落库用的确定性 UUID。提案阶段不传，确认时才生成 */
  createIds?: ReadonlyMap<string, string>
  allocateSlug?: (
    name: string,
    parentId: string | null,
    existing: readonly OrganizeFolder[]
  ) => string
}

export type SimulateResult = {
  ops: KbOrganizeOp[]
  skipped: KbOrganizeSkipped[]
  folders: OrganizeFolder[]
  bookmarks: OrganizeBookmark[]
}

type CreateDraft = Extract<OrganizeDraft, { type: "create_folder" }>
type MoveFolderDraft = Extract<OrganizeDraft, { type: "move_folder" }>
type MergeDraft = Extract<OrganizeDraft, { type: "merge_folders" }>

/** 消息 id + 操作 id → UUID v5。重复确认同一个新建不会再插入一条 */
export async function organizeFolderId(
  messageId: string,
  opId: string
): Promise<string> {
  const name = new TextEncoder().encode(`${messageId}\0${opId}`)
  const data = new Uint8Array(ORGANIZE_UUID_NAMESPACE.length + name.length)
  data.set(ORGANIZE_UUID_NAMESPACE)
  data.set(name, ORGANIZE_UUID_NAMESPACE.length)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", data))
  const bytes = digest.slice(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function allocateOrganizeSlug(
  name: string,
  parentId: string | null,
  existing: readonly OrganizeFolder[]
): string {
  const base = folderSlugBase(name)
  const taken = (slug: string) =>
    existing.some(
      (folder) => (folder.parentId ?? null) === parentId && folder.slug === slug
    )
  if (!taken(base)) return base
  let n = 2
  while (taken(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * 移动后尽量保留原 slug。目标同级（含根目录）已经占用时加数字后缀。
 * 排除自己，避免把尚未改父级的原 slug 当成冲突。
 */
function relocateOrganizeSlug(
  preferred: string,
  parentId: string | null,
  existing: readonly OrganizeFolder[],
  excludeId: string
): string {
  const base = preferred.trim() || "folder"
  const taken = (slug: string) =>
    existing.some(
      (folder) =>
        folder.id !== excludeId &&
        (folder.parentId ?? null) === parentId &&
        folder.slug === slug
    )
  if (!taken(base)) return base
  let n = 2
  while (taken(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * 按「新建 → 改名 → 移动文件夹 → 移动收藏 → 合并」模拟整份方案。
 * 不写库。移走子文件夹后再合并可以通过；移完仍有子文件夹、成环、
 * 或引用了未通过的临时 key，对应项会被拒绝。
 */
export function simulateOrganize(
  world: OrganizeWorld,
  drafts: readonly OrganizeDraft[],
  options: SimulateOptions = {}
): SimulateResult {
  const folders = new Map(
    world.folders.map((folder) => [folder.id, { ...folder }])
  )
  const bookmarkRows = world.bookmarks.map((bookmark) => ({ ...bookmark }))
  const bookmarksById = new Map(
    bookmarkRows.map((bookmark) => [bookmark.id, bookmark])
  )
  const ops: KbOrganizeOp[] = []
  const skipped: KbOrganizeSkipped[] = []
  const createdKeys = new Map<string, string>()

  const creates = orderCreates(
    drafts.filter((draft) => draft.type === "create_folder")
  )
  const renames = drafts.filter((draft) => draft.type === "rename_folder")
  const folderMoves = drafts.filter((draft) => draft.type === "move_folder")
  const bookmarkMoves = drafts.filter(
    (draft) => draft.type === "move_bookmarks"
  )
  const merges = drafts.filter((draft) => draft.type === "merge_folders")

  for (const draft of creates) acceptCreate(draft)
  for (const draft of renames) acceptRename(draft)
  acceptFolderMoves(folderMoves)
  let bookmarkBudget = KB_ORGANIZE_MAX_BOOKMARK_IDS
  for (const draft of bookmarkMoves) {
    bookmarkBudget = acceptBookmarkMove(draft, bookmarkBudget)
  }
  acceptMerges(merges)

  return {
    ops,
    skipped,
    folders: [...folders.values()],
    bookmarks: bookmarkRows,
  }

  function acceptCreate(draft: CreateDraft) {
    if (createdKeys.has(draft.key)) {
      skip(draft.opId, "新建的临时 key 重复了")
      return
    }
    const name = cleanName(draft.name)
    if (!name) {
      skip(draft.opId, "文件夹名称需要 1 到 64 个字符")
      return
    }
    const parent = resolveParent(draft.opId, draft.parentId, draft.parentKey)
    if (parent === undefined) return
    const parentNode = parent ? folders.get(parent) : undefined
    if (parent && !parentNode) {
      skip(draft.opId, "父文件夹没有通过校验")
      return
    }
    const depth = parentNode ? parentNode.depth + 1 : 0
    if (depth > FOLDER_MAX_DEPTH) {
      skip(draft.opId, `最多 ${FOLDER_MAX_DEPTH + 1} 级文件夹`)
      return
    }

    const sibling = [...folders.values()].find(
      (folder) =>
        (folder.parentId ?? null) === parent &&
        normalizeFolderName(folder.name) === normalizeFolderName(name)
    )
    const placeLabel = parent ? pathLabel(parent) : "根目录"
    if (sibling) {
      createdKeys.set(draft.key, sibling.id)
      ops.push({
        id: draft.opId,
        type: "create_folder",
        key: draft.key,
        name,
        parentId: draft.parentId,
        parentKey: draft.parentKey,
        reuseId: sibling.id,
        placeLabel: clipLabel(placeLabel),
        reason: cleanReason(draft.reason),
      })
      return
    }

    const assigned = options.createIds?.get(draft.key)
    if (assigned && folders.has(assigned)) {
      createdKeys.set(draft.key, assigned)
      ops.push({
        id: draft.opId,
        type: "create_folder",
        key: draft.key,
        name,
        parentId: draft.parentId,
        parentKey: draft.parentKey,
        reuseId: assigned,
        placeLabel: clipLabel(placeLabel),
        reason: cleanReason(draft.reason),
      })
      return
    }

    const id = assigned ?? `new:${draft.key}`
    const slug = options.allocateSlug
      ? options.allocateSlug(name, parent, [...folders.values()])
      : `pending-${draft.key}`.slice(0, 64)
    folders.set(id, {
      id,
      name,
      slug,
      parentId: parent,
      depth,
      path: folderPathOf(id, parentNode?.path),
    })
    createdKeys.set(draft.key, id)
    ops.push({
      id: draft.opId,
      type: "create_folder",
      key: draft.key,
      name,
      parentId: draft.parentId,
      parentKey: draft.parentKey,
      reuseId: null,
      placeLabel: clipLabel(placeLabel),
      reason: cleanReason(draft.reason),
    })
  }

  function acceptRename(
    draft: Extract<OrganizeDraft, { type: "rename_folder" }>
  ) {
    const folder = folders.get(draft.folderId)
    if (!folder || draft.folderId.startsWith("new:")) {
      skip(draft.opId, "文件夹不存在")
      return
    }
    const name = cleanName(draft.name)
    if (!name) {
      skip(draft.opId, "文件夹名称需要 1 到 64 个字符")
      return
    }
    if (name === folder.name) {
      skip(draft.opId, "名称没有变化")
      return
    }
    const fromName = clipLabel(folder.name)
    folder.name = name
    ops.push({
      id: draft.opId,
      type: "rename_folder",
      folderId: draft.folderId,
      fromName,
      name,
      reason: cleanReason(draft.reason),
    })
  }

  function acceptFolderMoves(moves: MoveFolderDraft[]) {
    const resolved: Array<{ draft: MoveFolderDraft; parentId: string | null }> =
      []
    const edges: Array<[string, string]> = []
    for (const draft of moves) {
      if (!folders.has(draft.folderId)) {
        skip(draft.opId, "文件夹不存在")
        continue
      }
      const parentId = resolveParent(
        draft.opId,
        draft.parentId,
        draft.parentKey
      )
      if (parentId === undefined) continue
      resolved.push({ draft, parentId })
      if (parentId) edges.push([draft.folderId, parentId])
    }
    const cyclic = cyclicEndpoints(edges)
    for (const { draft, parentId } of resolved) {
      if (cyclic.has(draft.folderId) || (parentId && cyclic.has(parentId))) {
        skip(draft.opId, "移动会形成循环")
        continue
      }
      const folder = folders.get(draft.folderId)
      if (!folder) {
        skip(draft.opId, "文件夹不存在")
        continue
      }
      if ((folder.parentId ?? null) === parentId) {
        skip(draft.opId, "已经在这个位置")
        continue
      }
      if (parentId === folder.id) {
        skip(draft.opId, "不能把文件夹移到自己下面")
        continue
      }
      const parent = parentId ? folders.get(parentId) : undefined
      if (parentId && !parent) {
        skip(draft.opId, "父文件夹不存在")
        continue
      }
      if (parent && isAncestorPath(folder.path, parent.path)) {
        skip(draft.opId, "不能移到自己的子文件夹下")
        continue
      }
      const extra =
        maxDescendantDepth(folder.id, [...folders.values()]) - folder.depth
      if (wouldExceedMaxDepth(extra, parent ? parent.depth : -1)) {
        skip(draft.opId, `移动后超过最大 ${FOLDER_MAX_DEPTH + 1} 级深度`)
        continue
      }
      const fromLabel = clipLabel(pathLabel(folder.id))
      const toLabel = clipLabel(parentId ? pathLabel(parentId) : "根目录")
      reparent(folder.id, parentId)
      const moved = folders.get(folder.id)
      if (moved) {
        moved.slug = relocateOrganizeSlug(
          moved.slug,
          parentId,
          [...folders.values()],
          moved.id
        )
      }
      ops.push({
        id: draft.opId,
        type: "move_folder",
        folderId: draft.folderId,
        parentId: draft.parentId,
        parentKey: draft.parentKey,
        fromLabel,
        toLabel,
        reason: cleanReason(draft.reason),
      })
    }
  }

  function acceptBookmarkMove(
    draft: Extract<OrganizeDraft, { type: "move_bookmarks" }>,
    budget: number
  ): number {
    const target = resolveFolderTarget(draft.folderId, draft.folderKey)
    if (target === undefined) {
      skip(
        draft.opId,
        draft.folderKey ? "目标文件夹还没在这份方案里建好" : "目标文件夹不存在"
      )
      return budget
    }
    const ids = [...new Set(draft.bookmarkIds)].filter((id) => {
      const bookmark = bookmarksById.get(id)
      return Boolean(bookmark && !bookmark.deleted)
    })
    if (ids.length === 0) {
      skip(draft.opId, "没有可移动的收藏")
      return budget
    }
    if (ids.length > budget) {
      skip(draft.opId, "超出单次方案的收藏数量上限")
      return budget
    }
    const fromLabels = new Set(
      ids.map((id) => bookmarkPlace(bookmarksById.get(id)?.folderId ?? null))
    )
    const titles = ids
      .slice(0, 8)
      .map((id) => clipLabel(bookmarksById.get(id)?.title || "未命名"))
    for (const id of ids) bookmarksById.get(id)!.folderId = target
    ops.push({
      id: draft.opId,
      type: "move_bookmarks",
      bookmarkIds: ids,
      titles,
      extraCount: Math.max(0, ids.length - titles.length),
      folderId: draft.folderId,
      folderKey: draft.folderKey,
      fromLabel: clipLabel(
        fromLabels.size === 1 ? [...fromLabels][0]! : "多个位置"
      ),
      toLabel: clipLabel(target ? pathLabel(target) : "未归类"),
      reason: cleanReason(draft.reason),
    })
    return budget - ids.length
  }

  function acceptMerges(items: MergeDraft[]) {
    const ready: Array<{
      draft: MergeDraft
      sourceId: string
      targetId: string
    }> = []
    const edges: Array<[string, string]> = []
    for (const draft of items) {
      const source = folders.get(draft.sourceId)
      if (!source) {
        skip(draft.opId, "来源文件夹不存在")
        continue
      }
      const targetId = resolveFolderTarget(draft.targetId, draft.targetKey)
      if (targetId === undefined) {
        skip(
          draft.opId,
          draft.targetKey
            ? "目标文件夹还没在这份方案里建好"
            : "目标文件夹不存在"
        )
        continue
      }
      if (targetId === null) {
        skip(draft.opId, "合并必须指定目标文件夹")
        continue
      }
      if (targetId === source.id) {
        skip(draft.opId, "不能合并到自己")
        continue
      }
      ready.push({ draft, sourceId: source.id, targetId })
      edges.push([source.id, targetId])
    }
    const cyclic = cyclicEndpoints(edges)
    for (const item of ready) {
      if (cyclic.has(item.sourceId) || cyclic.has(item.targetId)) {
        skip(item.draft.opId, "合并会形成循环")
        continue
      }
      const source = folders.get(item.sourceId)
      const target = folders.get(item.targetId)
      if (!source || !target) {
        skip(item.draft.opId, "文件夹不存在")
        continue
      }
      if (target.path.startsWith(source.path)) {
        skip(item.draft.opId, "目标还在来源文件夹里面")
        continue
      }
      if (hasChildren(source.id)) {
        skip(item.draft.opId, "来源文件夹里还有子文件夹")
        continue
      }
      const fromLabel = clipLabel(pathLabel(source.id))
      const toLabel = clipLabel(pathLabel(target.id))
      for (const bookmark of bookmarkRows) {
        if (bookmark.folderId !== source.id) continue
        bookmark.folderId = bookmark.deleted ? null : target.id
      }
      folders.delete(source.id)
      ops.push({
        id: item.draft.opId,
        type: "merge_folders",
        sourceId: item.draft.sourceId,
        targetId: item.draft.targetId,
        targetKey: item.draft.targetKey,
        fromLabel,
        toLabel,
        reason: cleanReason(item.draft.reason),
      })
    }
  }

  function resolveParent(
    opId: string,
    parentId: string | null,
    parentKey: string | null
  ): string | null | undefined {
    if (parentKey) {
      const id = createdKeys.get(parentKey)
      if (!id || !folders.has(id)) {
        skip(opId, "父文件夹还没在这份方案里建好")
        return undefined
      }
      return id
    }
    if (parentId) {
      if (!folders.has(parentId)) {
        skip(opId, "父文件夹不存在")
        return undefined
      }
      return parentId
    }
    return null
  }

  function resolveFolderTarget(
    folderId: string | null,
    folderKey: string | null
  ): string | null | undefined {
    if (folderKey) {
      const id = createdKeys.get(folderKey)
      if (!id || !folders.has(id)) return undefined
      return id
    }
    if (folderId) {
      if (!folders.has(folderId)) return undefined
      return folderId
    }
    return null
  }

  function skip(id: string, reason: string) {
    skipped.push({ id, reason: cleanReason(reason) })
  }

  function hasChildren(id: string): boolean {
    for (const folder of folders.values()) {
      if (folder.parentId === id) return true
    }
    return false
  }

  function pathLabel(id: string): string {
    const names: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = id
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const node = folders.get(cursor)
      if (!node) break
      names.unshift(node.name)
      cursor = node.parentId
    }
    return names.join(" / ") || "未命名"
  }

  function bookmarkPlace(folderId: string | null): string {
    return folderId && folders.has(folderId) ? pathLabel(folderId) : "未归类"
  }

  function reparent(id: string, parentId: string | null) {
    const node = folders.get(id)
    if (!node) return
    const parent = parentId ? folders.get(parentId) : undefined
    const oldPath = node.path
    const newPath = folderPathOf(id, parent?.path)
    const newDepth = parent ? parent.depth + 1 : 0
    const delta = newDepth - node.depth
    const affected = [...folders.values()].filter((folder) =>
      folder.path.startsWith(oldPath)
    )
    for (const folder of affected) {
      if (folder.id === id) {
        folder.parentId = parentId
        folder.path = newPath
        folder.depth = newDepth
      } else {
        folder.path = `${newPath}${folder.path.slice(oldPath.length)}`
        folder.depth += delta
      }
    }
  }
}

export function parseOrganizeDrafts(raw: unknown): {
  drafts: OrganizeDraft[]
  skipped: KbOrganizeSkipped[]
  truncated: boolean
} {
  if (!Array.isArray(raw)) {
    return {
      drafts: [],
      skipped: [{ id: "op-1", reason: "ops 必须是数组" }],
      truncated: false,
    }
  }
  const truncated = raw.length > KB_ORGANIZE_MAX_OPS
  const drafts: OrganizeDraft[] = []
  const skipped: KbOrganizeSkipped[] = []
  let seq = 0
  const nextId = () => {
    seq += 1
    return `op-${seq}`
  }

  for (const item of raw.slice(0, KB_ORGANIZE_MAX_OPS)) {
    const opId = nextId()
    const draft = parseOne(item, opId)
    if ("opId" in draft) drafts.push(draft)
    else skipped.push({ id: opId, reason: draft.reason })
  }
  return { drafts, skipped, truncated }
}

function parseOne(
  item: unknown,
  opId: string
): OrganizeDraft | { reason: string } {
  if (!item || typeof item !== "object") return { reason: "这一项不是对象" }
  const row = item as Record<string, unknown>
  const type = typeof row.type === "string" ? row.type : ""
  const reason = typeof row.reason === "string" ? row.reason : "调整结构"
  switch (type) {
    case "rename_folder": {
      const folderId = readId(row.folderId)
      const name = typeof row.name === "string" ? row.name : ""
      if (!folderId) return { reason: "改名缺少文件夹 id" }
      return { opId, reason, type, folderId, name }
    }
    case "create_folder": {
      const key = readKey(row.key)
      const name = typeof row.name === "string" ? row.name : ""
      const parentId = readOptionalId(row.parentId)
      const parentKey = readOptionalKey(row.parentKey)
      if (!key) return { reason: "新建缺少临时 key" }
      if (!parentId.ok) return { reason: "父文件夹 id 无效" }
      if (!parentKey.ok) return { reason: "父文件夹 key 无效" }
      return {
        opId,
        reason,
        type,
        key,
        name,
        parentId: parentId.id,
        parentKey: parentKey.key,
      }
    }
    case "move_folder": {
      const folderId = readId(row.folderId)
      const parentId = readOptionalId(row.parentId)
      const parentKey = readOptionalKey(row.parentKey)
      if (!folderId) return { reason: "移动文件夹缺少文件夹 id" }
      if (!parentId.ok) return { reason: "父文件夹 id 无效" }
      if (!parentKey.ok) return { reason: "父文件夹 key 无效" }
      return {
        opId,
        reason,
        type,
        folderId,
        parentId: parentId.id,
        parentKey: parentKey.key,
      }
    }
    case "move_bookmarks": {
      const bookmarkIds = Array.isArray(row.bookmarkIds)
        ? row.bookmarkIds
            .filter(
              (id): id is string => typeof id === "string" && isUuid(id.trim())
            )
            .map((id) => id.trim())
        : []
      const folderId = readOptionalId(row.folderId)
      const folderKey = readOptionalKey(row.folderKey)
      if (bookmarkIds.length === 0)
        return { reason: "移动收藏缺少有效的收藏 id" }
      if (!folderId.ok) return { reason: "目标文件夹 id 无效" }
      if (!folderKey.ok) return { reason: "目标文件夹 key 无效" }
      return {
        opId,
        reason,
        type,
        bookmarkIds,
        folderId: folderId.id,
        folderKey: folderKey.key,
      }
    }
    case "merge_folders": {
      const sourceId = readId(row.sourceId)
      const targetId = readOptionalId(row.targetId)
      const targetKey = readOptionalKey(row.targetKey)
      if (!sourceId) return { reason: "合并缺少来源文件夹 id" }
      if (!targetId.ok) return { reason: "目标文件夹 id 无效" }
      if (!targetKey.ok) return { reason: "目标文件夹 key 无效" }
      return {
        opId,
        reason,
        type,
        sourceId,
        targetId: targetId.id,
        targetKey: targetKey.key,
      }
    }
    default:
      return { reason: "不支持的操作类型" }
  }
}

export async function loadOrganizeWorld(db: Db): Promise<OrganizeWorld> {
  const [folderRows, bookmarkRows] = await Promise.all([
    db.select().from(folders),
    db
      .select({
        id: bookmarks.id,
        title: bookmarks.title,
        folderId: bookmarks.folderId,
        deletedAt: bookmarks.deletedAt,
        archivedAt: bookmarks.archivedAt,
      })
      .from(bookmarks),
  ])
  return {
    folders: folderRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      parentId: row.parentId,
      depth: row.depth,
      path: row.path,
    })),
    bookmarks: bookmarkRows.map((row) => ({
      id: row.id,
      title: row.title,
      folderId: row.folderId,
      deleted: Boolean(row.deletedAt),
      archived: Boolean(row.archivedAt),
    })),
  }
}

export function proposalFromSimulation(
  status: KbOrganizeProposal["status"],
  result: Pick<SimulateResult, "ops" | "skipped">
): KbOrganizeProposal | null {
  const parsed = kbOrganizeProposalSchema.safeParse({
    status,
    ops: result.ops,
    ...(result.skipped.length > 0 ? { skipped: result.skipped } : {}),
  })
  return parsed.success ? parsed.data : null
}

export type ApplyOrganizeFailure = {
  ok: false
  status: 400 | 409 | 500
  code: string
  error: string
}

/** 从已存消息读出方案，按勾选的操作再模拟一次，然后放进同一次 batch */
export async function applyKbOrganize(
  db: Db,
  input: { conversationId: string; messageId: string; opIds: readonly string[] }
): Promise<{ ok: true; organize: KbOrganizeProposal } | ApplyOrganizeFailure> {
  const row = await db
    .select({ organize: kbMessages.organize })
    .from(kbMessages)
    .where(
      and(
        eq(kbMessages.conversationId, input.conversationId),
        eq(kbMessages.id, input.messageId)
      )
    )
    .get()
  if (!row?.organize) {
    return {
      ok: false,
      status: 409,
      code: "ORGANIZE_NOT_SAVED",
      error: "方案还没存上，请稍后再试",
    }
  }

  let stored: unknown
  try {
    stored = JSON.parse(row.organize)
  } catch {
    return {
      ok: false,
      status: 409,
      code: "ORGANIZE_NOT_SAVED",
      error: "方案还没存上，请稍后再试",
    }
  }
  const proposal = kbOrganizeProposalSchema.safeParse(stored)
  if (!proposal.success) {
    return {
      ok: false,
      status: 409,
      code: "ORGANIZE_NOT_SAVED",
      error: "方案还没存上，请稍后再试",
    }
  }
  if (proposal.data.status === "applied")
    return { ok: true, organize: proposal.data }
  if (proposal.data.status === "dismissed") {
    return {
      ok: false,
      status: 409,
      code: "ORGANIZE_DISMISSED",
      error: "这份方案已经跳过",
    }
  }

  const selected = proposal.data.ops.filter((op) => input.opIds.includes(op.id))
  if (selected.length === 0) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      error: "没有选中可执行的操作",
    }
  }

  const world = await loadOrganizeWorld(db)
  const createIds = new Map<string, string>()
  for (const op of selected) {
    if (op.type === "create_folder") {
      createIds.set(op.key, await organizeFolderId(input.messageId, op.id))
    }
  }
  const simulated = simulateOrganize(world, selected.map(storedOpToDraft), {
    createIds,
    allocateSlug: allocateOrganizeSlug,
  })
  const next = proposalFromSimulation(
    simulated.ops.length > 0 ? "applied" : "pending",
    simulated
  )
  if (!next) {
    return {
      ok: false,
      status: 500,
      code: "ORGANIZE_FAILED",
      error: "方案无法写入",
    }
  }

  const statements = await buildApplyStatements(db, world, simulated, {
    conversationId: input.conversationId,
    messageId: input.messageId,
    organize: JSON.stringify(next),
  })
  if (statements.length === 1) await statements[0]
  else
    await db.batch(statements as [(typeof statements)[0], ...typeof statements])
  return { ok: true, organize: next }
}

function storedOpToDraft(op: KbOrganizeOp): OrganizeDraft {
  switch (op.type) {
    case "rename_folder":
      return {
        opId: op.id,
        reason: op.reason,
        type: op.type,
        folderId: op.folderId,
        name: op.name,
      }
    case "create_folder":
      return {
        opId: op.id,
        reason: op.reason,
        type: op.type,
        key: op.key,
        name: op.name,
        parentId: op.parentId,
        parentKey: op.parentKey,
      }
    case "move_folder":
      return {
        opId: op.id,
        reason: op.reason,
        type: op.type,
        folderId: op.folderId,
        parentId: op.parentId,
        parentKey: op.parentKey,
      }
    case "move_bookmarks":
      return {
        opId: op.id,
        reason: op.reason,
        type: op.type,
        bookmarkIds: op.bookmarkIds,
        folderId: op.folderId,
        folderKey: op.folderKey,
      }
    case "merge_folders":
      return {
        opId: op.id,
        reason: op.reason,
        type: op.type,
        sourceId: op.sourceId,
        targetId: op.targetId,
        targetKey: op.targetKey,
      }
  }
}

async function buildApplyStatements(
  db: Db,
  before: OrganizeWorld,
  after: SimulateResult,
  saved: { conversationId: string; messageId: string; organize: string }
) {
  const now = nowIso()
  const beforeFolders = new Map(
    before.folders.map((folder) => [folder.id, folder])
  )
  const afterFolders = new Map(
    after.folders.map((folder) => [folder.id, folder])
  )
  const statements = []

  const created = after.folders
    .filter(
      (folder) => !beforeFolders.has(folder.id) && !folder.id.startsWith("new:")
    )
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))

  const existingRows = await db
    .select({ parentId: folders.parentId, sortOrder: folders.sortOrder })
    .from(folders)
  const maxSortByParent = new Map<string, number>()
  for (const r of existingRows) {
    const key = r.parentId ?? ""
    const cur = maxSortByParent.get(key)
    if (cur === undefined || r.sortOrder > cur) {
      maxSortByParent.set(key, r.sortOrder)
    }
  }

  for (const folder of created) {
    const key = folder.parentId ?? ""
    const curMax = maxSortByParent.get(key)
    const nextSort = curMax === undefined ? 10 : curMax + 10
    maxSortByParent.set(key, nextSort)
    statements.push(
      db
        .insert(folders)
        .values({
          id: folder.id,
          name: folder.name,
          slug: folder.slug,
          color: "#64748B",
          sortOrder: nextSort,
          description: null,
          isPreset: false,
          parentId: folder.parentId,
          depth: folder.depth,
          path: folder.path,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: folders.id })
    )
  }

  for (const folder of after.folders) {
    const prev = beforeFolders.get(folder.id)
    if (!prev) continue
    if (
      prev.name === folder.name &&
      prev.slug === folder.slug &&
      prev.parentId === folder.parentId &&
      prev.depth === folder.depth &&
      prev.path === folder.path
    ) {
      continue
    }
    statements.push(
      db
        .update(folders)
        .set({
          name: folder.name,
          slug: folder.slug,
          parentId: folder.parentId,
          depth: folder.depth,
          path: folder.path,
          updatedAt: now,
        })
        .where(eq(folders.id, folder.id))
    )
  }

  const beforeBookmarks = new Map(
    before.bookmarks.map((bookmark) => [bookmark.id, bookmark])
  )
  const groups = new Map<string, string[]>()
  for (const bookmark of after.bookmarks) {
    const prev = beforeBookmarks.get(bookmark.id)
    if (!prev || prev.folderId === bookmark.folderId) continue
    const key = bookmark.folderId ?? ""
    const list = groups.get(key) ?? []
    list.push(bookmark.id)
    groups.set(key, list)
  }
  for (const [key, ids] of groups) {
    for (const chunk of chunks(ids, 40)) {
      statements.push(
        db
          .update(bookmarks)
          .set({ folderId: key || null, updatedAt: now })
          .where(inArray(bookmarks.id, chunk))
      )
    }
  }

  for (const folder of before.folders) {
    if (afterFolders.has(folder.id)) continue
    statements.push(db.delete(folders).where(eq(folders.id, folder.id)))
  }

  statements.push(
    db
      .update(kbMessages)
      .set({ organize: saved.organize })
      .where(
        and(
          eq(kbMessages.conversationId, saved.conversationId),
          eq(kbMessages.id, saved.messageId)
        )
      )
  )
  return statements
}

function orderCreates(creates: CreateDraft[]): CreateDraft[] {
  const byKey = new Map(creates.map((draft) => [draft.key, draft]))
  const result: CreateDraft[] = []
  const seen = new Set<string>()
  const visit = (draft: CreateDraft, stack: Set<string>) => {
    if (seen.has(draft.key)) return
    if (stack.has(draft.key)) return
    stack.add(draft.key)
    if (draft.parentKey && byKey.has(draft.parentKey))
      visit(byKey.get(draft.parentKey)!, stack)
    stack.delete(draft.key)
    seen.add(draft.key)
    result.push(draft)
  }
  for (const draft of creates) visit(draft, new Set())
  return result
}

function cyclicEndpoints(edges: Array<[string, string]>): Set<string> {
  const adjacent = new Map<string, string[]>()
  for (const [from, to] of edges) {
    const list = adjacent.get(from) ?? []
    list.push(to)
    adjacent.set(from, list)
    if (!adjacent.has(to)) adjacent.set(to, [])
  }
  const color = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const cyclic = new Set<string>()
  const visit = (node: string) => {
    color.set(node, 1)
    stack.push(node)
    for (const next of adjacent.get(node) ?? []) {
      const state = color.get(next) ?? 0
      if (state === 1) {
        const at = stack.indexOf(next)
        for (const item of stack.slice(at)) cyclic.add(item)
      } else if (state === 0) visit(next)
    }
    stack.pop()
    color.set(node, 2)
  }
  for (const node of adjacent.keys()) {
    if ((color.get(node) ?? 0) === 0) visit(node)
  }
  return cyclic
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function readId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const id = value.trim()
  return isUuid(id) ? id : null
}

function readOptionalId(
  value: unknown
): { ok: true; id: string | null } | { ok: false } {
  if (value === null || value === undefined || value === "")
    return { ok: true, id: null }
  const id = readId(value)
  return id ? { ok: true, id } : { ok: false }
}

function readKey(value: unknown): string | null {
  if (typeof value !== "string") return null
  const key = value.trim()
  if (!key || key.length > 32) return null
  return key
}

function readOptionalKey(
  value: unknown
): { ok: true; key: string | null } | { ok: false } {
  if (value === null || value === undefined || value === "")
    return { ok: true, key: null }
  const key = readKey(value)
  return key ? { ok: true, key } : { ok: false }
}

function cleanName(value: string): string | null {
  const name = value.replace(/[<>]/g, "").trim()
  if (!name || name.length > 64) return null
  return name
}

function cleanReason(value: string): string {
  const reason =
    value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim() || "调整结构"
  return reason.length <= KB_ORGANIZE_REASON_MAX_CHARS
    ? reason
    : reason.slice(0, KB_ORGANIZE_REASON_MAX_CHARS)
}

function clipLabel(value: string): string {
  const label = value.replace(/[<>]/g, "").trim() || "未命名"
  return label.length <= KB_ORGANIZE_LABEL_MAX_CHARS
    ? label
    : label.slice(0, KB_ORGANIZE_LABEL_MAX_CHARS)
}
