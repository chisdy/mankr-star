import {
  bookmarkTags,
  bookmarks,
  folders,
  tags,
  users,
  type Db,
} from "@mankr/db"
import {
  AI_FOLDER_AUTO_CREATE_MAX_DEPTH,
  GITHUB_README_MAX_CHARS,
  PRESET_FOLDERS,
  type AiOutput,
} from "@mankr/shared"
import { and, eq, isNull } from "drizzle-orm"
import type { Env } from "../env"
import { decryptSecret } from "./crypto"
import { DeepSeekCallError, recordAiUsage } from "./ai-usage"
import {
  classifyWithDeepSeek,
  fallbackAsciiSlugFromName,
  normalizeFolderName,
  ruleBasedClassify,
  translateNameToEnglishSlug,
  truncateFolderPath,
  type FolderCatalogEntry,
} from "./deepseek"
import { buildPathLabel, folderPathOf } from "./folder-utils"
import {
  fetchGithubRepo,
  fetchReadmeSnippet,
  type GithubRepoMeta,
} from "./github"
import { folderSlugBase, nowIso, slugify } from "./utils"

const AI_RUN_TIMEOUT_MS = 25_000
const SLUG_TRANSLATE_TIMEOUT_MS = 8_000

export async function seedPresetFolders(db: Db): Promise<void> {
  const existing = await db.select({ id: folders.id }).from(folders).limit(1)
  if (existing.length > 0) return

  const now = nowIso()
  const rows = PRESET_FOLDERS.map((c) => {
    const id = crypto.randomUUID()
    return {
      id,
      name: c.name,
      slug: c.slug,
      color: c.color,
      sortOrder: c.sortOrder,
      description: c.description,
      isPreset: true as const,
      parentId: null as string | null,
      depth: 0,
      path: `/${id}/`,
      createdAt: now,
      updatedAt: now,
    }
  })
  const batchSize = 5
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.insert(folders).values(rows.slice(i, i + batchSize))
  }
}

/** @deprecated 使用 seedPresetFolders */
export const seedPresetCategories = seedPresetFolders

export async function resolveGithubToken(
  db: Db,
  env: Env,
): Promise<string | null> {
  const user = await db.select().from(users).get()
  if (user?.githubPatEncrypted) {
    try {
      return await decryptSecret(
        user.githubPatEncrypted,
        env.PAT_ENCRYPTION_KEY,
      )
    } catch {
      /* fallthrough */
    }
  }
  return env.GITHUB_TOKEN ?? null
}

export async function getDeepSeekKey(
  db: Db,
  env: Env,
): Promise<{ key: string; model: string } | null> {
  const user = await db.select().from(users).get()
  if (!user?.deepseekApiKeyEncrypted) return null
  const encKey = env.AI_KEY_ENCRYPTION_KEY || env.PAT_ENCRYPTION_KEY
  try {
    const key = await decryptSecret(user.deepseekApiKeyEncrypted, encKey)
    return {
      key,
      model: user.deepseekModel || "deepseek-v4-flash",
    }
  } catch {
    return null
  }
}

export async function loadFolderCatalog(
  db: Db,
): Promise<FolderCatalogEntry[]> {
  const rows = await db.select().from(folders)
  const byId = new Map(rows.map((r) => [r.id, r]))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parent_id: r.parentId ?? null,
    path_label: buildPathLabel(r, byId),
    description: r.description,
  }))
}

/** 同级唯一英文 slug；base 已为 kebab */
export async function allocateFolderSlug(
  db: Db,
  base: string,
  parentId: string | null,
  excludeId?: string | null,
): Promise<string> {
  const slugBase = folderSlugBase(base)
  const candidates = await db.select().from(folders)
  const taken = (slug: string) =>
    candidates.some(
      (c) =>
        (c.parentId ?? null) === parentId &&
        c.slug === slug &&
        (!excludeId || c.id !== excludeId),
    )
  if (!taken(slugBase)) return slugBase
  let n = 2
  while (taken(`${slugBase}-${n}`)) n += 1
  return `${slugBase}-${n}`
}

export async function suggestFolderSlug(
  db: Db,
  env: Env,
  opts: {
    name: string
    parentId?: string | null
    excludeId?: string | null
  },
): Promise<{ slug: string; source: "ai" | "fallback" }> {
  const parentId = opts.parentId ?? null
  const deepseek = await getDeepSeekKey(db, env)
  let base: string | null = null
  let source: "ai" | "fallback" = "fallback"

  if (deepseek) {
    try {
      const signal = AbortSignal.timeout(SLUG_TRANSLATE_TIMEOUT_MS)
      const translated = await translateNameToEnglishSlug(
        deepseek.key,
        opts.name,
        deepseek.model,
        signal,
      )
      if (translated.status !== "skipped") {
        await recordAiUsage(db, {
          kind: "slug_translate",
          model: translated.model,
          status: translated.status === "ok" ? "ok" : "error",
          usage: translated.usage,
          errorCode: translated.errorCode ?? null,
          latencyMs: translated.latencyMs,
        })
      }
      if (translated.slug) {
        base = translated.slug
        source = "ai"
      }
    } catch {
      base = null
    }
  }

  if (!base) {
    base = fallbackAsciiSlugFromName(opts.name)
    source = "fallback"
  }

  const slug = await allocateFolderSlug(db, base, parentId, opts.excludeId)
  return { slug, source }
}

export async function ensureFolderByPath(
  db: Db,
  names: string[],
): Promise<string> {
  const segments = truncateFolderPath(names)
  let parentId: string | null = null
  let parentPath: string | null = null
  let leafId = ""

  for (let i = 0; i < segments.length; i++) {
    const name = segments[i]!.trim()
    const normalized = normalizeFolderName(name)
    const candidates = await db.select().from(folders)
    const existing = candidates.find(
      (c) =>
        (c.parentId ?? null) === parentId &&
        normalizeFolderName(c.name) === normalized,
    )
    if (existing) {
      leafId = existing.id
      parentId = existing.id
      parentPath = existing.path
      continue
    }

    const id = crypto.randomUUID()
    const slug = await allocateFolderSlug(db, name, parentId)
    const path = folderPathOf(id, parentPath)
    const depth = i
    await db.insert(folders).values({
      id,
      name,
      slug,
      color: "#64748B",
      sortOrder: 200,
      isPreset: false,
      parentId,
      depth,
      path,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    leafId = id
    parentId = id
    parentPath = path
  }

  return leafId
}

async function createFolderUnderParent(
  db: Db,
  name: string,
  parentId: string | null,
): Promise<string> {
  const normalized = normalizeFolderName(name)
  const candidates = await db.select().from(folders)
  const existing = candidates.find(
    (c) =>
      (c.parentId ?? null) === parentId &&
      normalizeFolderName(c.name) === normalized,
  )
  if (existing) return existing.id

  const parent = parentId
    ? candidates.find((c) => c.id === parentId)
    : null
  if (parentId && !parent) {
    throw new Error("new_folder.parent_id 不存在")
  }

  const depth = parent ? parent.depth + 1 : 0
  if (depth > AI_FOLDER_AUTO_CREATE_MAX_DEPTH) {
    // 超出自动创建深度：退回父级或「其他」
    if (parent) return parent.id
    return ensureFolderByPath(db, ["其他"])
  }

  const id = crypto.randomUUID()
  const slug = await allocateFolderSlug(db, name, parentId)
  const path = folderPathOf(id, parent?.path ?? null)
  await db.insert(folders).values({
    id,
    name: name.trim(),
    slug,
    color: "#64748B",
    sortOrder: 200,
    isPreset: false,
    parentId,
    depth,
    path,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  })
  return id
}

export async function resolveAiFolderId(
  db: Db,
  result: AiOutput,
): Promise<string> {
  if (result.folder_id) {
    const row = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.id, result.folder_id))
      .get()
    if (row) return row.id
  }

  if (result.new_folder?.name) {
    return createFolderUnderParent(
      db,
      result.new_folder.name,
      result.new_folder.parent_id ?? null,
    )
  }

  if (result.folder_path?.length) {
    return ensureFolderByPath(db, result.folder_path)
  }

  return ensureFolderByPath(db, ["其他"])
}

export async function syncBookmarkTags(
  db: Db,
  bookmarkId: string,
  tagNames: string[],
): Promise<void> {
  await db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, bookmarkId))

  const unique = Array.from(
    new Set(tagNames.map((t) => t.trim()).filter(Boolean)),
  )
  for (const name of unique) {
    const slug = slugify(name)
    let tag = await db.select().from(tags).where(eq(tags.slug, slug)).get()
    if (!tag) {
      const id = crypto.randomUUID()
      await db.insert(tags).values({
        id,
        name,
        slug,
        createdAt: nowIso(),
      })
      tag = { id, name, slug, createdAt: nowIso() }
    }
    await db.insert(bookmarkTags).values({
      bookmarkId,
      tagId: tag.id,
    })
  }
}

export async function applyAiResult(
  db: Db,
  bookmarkId: string,
  result: AiOutput,
  status: "done" | "fallback" | "failed",
  opts?: { overwriteFolder?: boolean; existingFolderId?: string | null },
): Promise<void> {
  const shouldWriteFolder =
    opts?.overwriteFolder === true || !opts?.existingFolderId

  const patch: {
    summaryAi: string
    useCasesJson: string
    aiConfidence: number | null
    aiStatus: "done" | "fallback" | "failed"
    updatedAt: string
    folderId?: string
  } = {
    summaryAi: result.summary,
    useCasesJson: JSON.stringify(result.use_cases ?? []),
    aiConfidence: result.confidence ?? null,
    aiStatus: status,
    updatedAt: nowIso(),
  }

  if (shouldWriteFolder) {
    patch.folderId = await resolveAiFolderId(db, result)
  }

  await db.update(bookmarks).set(patch).where(eq(bookmarks.id, bookmarkId))
  await syncBookmarkTags(db, bookmarkId, result.tags)
}

export async function runAiForBookmark(
  db: Db,
  env: Env,
  bookmarkId: string,
  opts?: { overwriteFolder?: boolean; overwriteCategory?: boolean },
): Promise<void> {
  const bookmark = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.id, bookmarkId), isNull(bookmarks.deletedAt)))
    .get()
  if (!bookmark) return

  let topics: string[] = []
  try {
    topics = JSON.parse(bookmark.topicsJson || "[]") as string[]
  } catch {
    topics = []
  }

  const [owner = "", repo = ""] = bookmark.externalId.split("/")
  const meta: GithubRepoMeta = {
    owner,
    repo,
    fullName: bookmark.externalId,
    description: bookmark.description,
    language: bookmark.language,
    stars: bookmark.stars,
    forks: bookmark.forks,
    license: bookmark.license,
    homepage: bookmark.homepage,
    defaultBranch: bookmark.defaultBranch,
    topics,
    pushedAt: bookmark.pushedAt,
    updatedAt: bookmark.githubUpdatedAt,
    htmlUrl: bookmark.canonicalUrl,
    archived: bookmark.githubArchived ?? false,
    disabled: false,
    size: bookmark.repoSize ?? 0,
  }

  const applyOpts = {
    overwriteFolder:
      opts?.overwriteFolder === true || opts?.overwriteCategory === true,
    existingFolderId: bookmark.folderId,
  }

  const deepseek = await getDeepSeekKey(db, env)
  if (!deepseek) {
    const fallback = ruleBasedClassify({
      language: meta.language,
      topics: meta.topics,
      description: meta.description,
      title: bookmark.title,
    })
    await applyAiResult(db, bookmarkId, fallback, "fallback", applyOpts)
    return
  }

  try {
    const signal = AbortSignal.timeout(AI_RUN_TIMEOUT_MS)
    const token = await resolveGithubToken(db, env)
    const readme = await fetchReadmeSnippet(
      meta.owner,
      meta.repo,
      GITHUB_README_MAX_CHARS,
      token,
      signal,
    )
    const catalog = await loadFolderCatalog(db)
    const classified = await classifyWithDeepSeek({
      apiKey: deepseek.key,
      model: deepseek.model,
      meta,
      readme,
      catalog,
      signal,
    })
    await recordAiUsage(db, {
      kind: "classify",
      model: classified.model,
      status: "ok",
      usage: classified.usage,
      bookmarkId,
      latencyMs: classified.latencyMs,
    })
    await applyAiResult(db, bookmarkId, classified.output, "done", applyOpts)
  } catch (err) {
    if (err instanceof DeepSeekCallError) {
      await recordAiUsage(db, {
        kind: "classify",
        model: err.model,
        status: "error",
        usage: err.usage,
        bookmarkId,
        errorCode: err.errorCode,
        latencyMs: err.latencyMs,
      })
    }
    const fallback = ruleBasedClassify({
      language: meta.language,
      topics: meta.topics,
      description: meta.description,
      title: bookmark.title,
    })
    await applyAiResult(db, bookmarkId, fallback, "failed", applyOpts)
  }
}

export { fetchGithubRepo }
