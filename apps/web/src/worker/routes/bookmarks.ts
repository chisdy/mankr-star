import { bookmarkTags, bookmarks, folders, tags, users } from "@mankr/db"
import {
  DEFAULT_HOT_WITHIN_DAYS,
  DEFAULT_STALE_AFTER_DAYS,
  SOURCE_CAPABILITIES,
  SOURCE_TYPES,
  canonicalizeUrl,
  computeHealthStatus,
  createBookmarkSchema,
  detectSourceType,
  listBookmarksQuerySchema,
  parseTwitterStatusInput,
  updateBookmarkSchema,
  urlExternalId,
  type SourceType,
} from "@mankr/shared"
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import {
  fetchGithubRepo,
  resolveGithubToken,
  runAiForBookmark,
  syncBookmarkTags,
} from "../lib/ai-service"
import { buildPathLabel, collectSubtreeIds } from "../lib/folder-utils"
import { GithubApiError } from "../lib/github"
import { parseGithubRepoInput } from "../lib/github-url"
import { fetchUrlPageMetadata } from "../lib/url-metadata"
import { fetchTwitterMetadata } from "../lib/twitter"
import { UrlFetchError } from "../lib/url-ssrf"
import { nowIso } from "../lib/utils"
import { authByMethod } from "../middleware/auth"

export const bookmarkRoutes = new Hono<AppEnv>()

/** 外链打开计数：公开浏览访客也可 POST（非其它写操作） */
const bookmarkAuth = authByMethod(undefined, undefined, (c) => {
  if (c.req.method !== "POST") return false
  // 兼容挂载前后 path：/api/bookmarks/:id/open 或 /bookmarks/:id/open
  return /\/bookmarks\/[^/]+\/open\/?$/.test(c.req.path)
})
bookmarkRoutes.use("/bookmarks", bookmarkAuth)
bookmarkRoutes.use("/bookmarks/*", bookmarkAuth)

async function loadTagsForBookmarks(
  db: ReturnType<typeof import("@mankr/db").createDb>,
  bookmarkIds: string[],
) {
  if (bookmarkIds.length === 0) return new Map<string, string[]>()
  const rows = await db
    .select({
      bookmarkId: bookmarkTags.bookmarkId,
      name: tags.name,
    })
    .from(bookmarkTags)
    .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
    .where(inArray(bookmarkTags.bookmarkId, bookmarkIds))

  const map = new Map<string, string[]>()
  for (const row of rows) {
    const list = map.get(row.bookmarkId) ?? []
    list.push(row.name)
    map.set(row.bookmarkId, list)
  }
  return map
}

function serializeBookmark(
  b: typeof bookmarks.$inferSelect,
  tagNames: string[],
  folder?: typeof folders.$inferSelect | null,
  allFolders?: Array<typeof folders.$inferSelect>,
  options?: { isPublicRead?: boolean },
) {
  let topics: string[] = []
  let useCases: string[] = []
  let platformMeta: Record<string, unknown> = {}
  try {
    topics = JSON.parse(b.topicsJson || "[]") as string[]
  } catch {
    /* ignore */
  }
  try {
    useCases = JSON.parse(b.useCasesJson || "[]") as string[]
  } catch {
    /* ignore */
  }
  try {
    platformMeta = JSON.parse(b.platformMetaJson || "{}") as Record<
      string,
      unknown
    >
  } catch {
    /* ignore */
  }

  const byId = new Map((allFolders ?? []).map((f) => [f.id, f]))
  const pathLabel = folder ? buildPathLabel(folder, byId) : null

  return {
    id: b.id,
    source_type: b.sourceType,
    canonical_url: b.canonicalUrl,
    external_id: b.externalId,
    owner: b.owner,
    title: b.title,
    description: b.description,
    language: b.language,
    stars: b.stars,
    forks: b.forks,
    license: b.license,
    homepage: b.homepage,
    default_branch: b.defaultBranch,
    topics,
    summary_ai: b.summaryAi,
    use_cases: useCases,
    ai_confidence: b.aiConfidence,
    folder_id: b.folderId,
    folder: folder
      ? {
          id: folder.id,
          name: folder.name,
          slug: folder.slug,
          color: folder.color,
          parent_id: folder.parentId,
          depth: folder.depth,
          path: folder.path,
          path_label: pathLabel,
        }
      : null,
    notes: options?.isPublicRead ? null : b.notes,
    site_name: b.siteName,
    image_url: b.imageUrl,
    favicon_url: b.faviconUrl,
    content_excerpt: b.contentExcerpt,
    platform_meta: platformMeta,
    ai_status: b.aiStatus,
    track_updates: b.trackUpdates,
    last_synced_at: b.lastSyncedAt,
    pushed_at: b.pushedAt,
    latest_release_tag: b.latestReleaseTag,
    sync_status: b.syncStatus,
    last_sync_error: b.lastSyncError,
    health_status: b.healthStatus,
    github_archived: b.githubArchived,
    repo_size: b.repoSize,
    archived_at: b.archivedAt,
    click_count: b.clickCount,
    tags: tagNames,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  }
}

bookmarkRoutes.get("/bookmarks", async (c) => {
  const db = c.get("db")
  const isPublicRead = Boolean(c.get("isPublicRead"))
  const query = listBookmarksQuerySchema.safeParse(c.req.query())
  if (!query.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: query.error.flatten(),
      },
      400,
    )
  }

  const {
    page,
    pageSize,
    folderId,
    tag,
    language,
    owner,
    site,
    sourceType,
    healthStatus,
    archived,
    includeArchived,
    q,
    sort,
    order,
  } = query.data

  const conditions = [isNull(bookmarks.deletedAt)]

  if (archived) {
    conditions.push(isNotNull(bookmarks.archivedAt))
  } else if (!includeArchived) {
    conditions.push(isNull(bookmarks.archivedAt))
  }

  if (sourceType) {
    conditions.push(eq(bookmarks.sourceType, sourceType))
  }

  if (healthStatus) {
    conditions.push(eq(bookmarks.sourceType, "github"))
    conditions.push(eq(bookmarks.healthStatus, healthStatus))
  }

  if (folderId) {
    const allFolders = await db.select().from(folders)
    const ids = collectSubtreeIds(folderId, allFolders)
    conditions.push(inArray(bookmarks.folderId, ids))
  }
  if (language) conditions.push(eq(bookmarks.language, language))
  if (owner) {
    // 开发者筛选仅针对 GitHub，避免命中 url 收藏写入的 hostname-owner
    conditions.push(eq(bookmarks.sourceType, "github"))
    conditions.push(eq(bookmarks.owner, owner))
  }
  if (site) {
    conditions.push(eq(bookmarks.sourceType, "url"))
    conditions.push(
      or(
        eq(bookmarks.siteName, site),
        and(isNull(bookmarks.siteName), eq(bookmarks.owner, site)),
      )!,
    )
  }

  if (q) {
    const pattern = `%${q}%`
    const qClauses = [
      like(bookmarks.title, pattern),
      like(bookmarks.description, pattern),
      like(bookmarks.summaryAi, pattern),
      like(bookmarks.externalId, pattern),
      like(bookmarks.siteName, pattern),
      like(bookmarks.contentExcerpt, pattern),
    ]
    if (!isPublicRead) {
      qClauses.push(like(bookmarks.notes, pattern))
    }
    conditions.push(or(...qClauses)!)
  }

  if (tag) {
    const tagRow = await db
      .select()
      .from(tags)
      .where(or(eq(tags.name, tag), eq(tags.slug, tag)))
      .get()
    if (!tagRow) {
      return c.json({ items: [], page, pageSize, total: 0 })
    }
    const links = await db
      .select({ bookmarkId: bookmarkTags.bookmarkId })
      .from(bookmarkTags)
      .where(eq(bookmarkTags.tagId, tagRow.id))
    const tagBookmarkIds = links.map((l) => l.bookmarkId)
    if (tagBookmarkIds.length === 0) {
      return c.json({ items: [], page, pageSize, total: 0 })
    }
    conditions.push(inArray(bookmarks.id, tagBookmarkIds))
  }

  const where = and(...conditions)

  const sortCol =
    sort === "stars"
      ? bookmarks.stars
      : sort === "title"
        ? bookmarks.title
        : sort === "updated_at"
          ? bookmarks.updatedAt
          : sort === "pushed_at"
            ? bookmarks.pushedAt
            : bookmarks.createdAt

  const orderFn = order === "asc" ? asc : desc

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(bookmarks)
    .where(where)

  const orderByClauses =
    sort === "pushed_at"
      ? [
          // NULL 沉底：有 pushed_at 的在前
          sql`(${bookmarks.pushedAt} IS NULL)`,
          orderFn(sortCol),
        ]
      : [orderFn(sortCol)]

  const rows = await db
    .select()
    .from(bookmarks)
    .where(where)
    .orderBy(...orderByClauses)
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const tagMap = await loadTagsForBookmarks(
    db,
    rows.map((r) => r.id),
  )

  const allFolders = await db.select().from(folders)
  const folderMap = new Map(allFolders.map((f) => [f.id, f]))
  const serializeOpts = { isPublicRead }

  return c.json({
    items: rows.map((r) => {
      const folder = r.folderId ? folderMap.get(r.folderId) : null
      return serializeBookmark(
        r,
        tagMap.get(r.id) ?? [],
        folder,
        allFolders,
        serializeOpts,
      )
    }),
    page,
    pageSize,
    total,
  })
})

bookmarkRoutes.get("/bookmarks/owners", async (c) => {
  const db = c.get("db")
  const q = c.req.query("q")?.trim()
  const sourceTypeRaw = c.req.query("sourceType")?.trim()
  const sourceType =
    sourceTypeRaw &&
    (SOURCE_TYPES as readonly string[]).includes(sourceTypeRaw)
      ? (sourceTypeRaw as SourceType)
      : "github"

  const conditions = [
    isNull(bookmarks.deletedAt),
    isNotNull(bookmarks.owner),
    eq(bookmarks.sourceType, sourceType),
  ]
  if (q) {
    conditions.push(like(bookmarks.owner, `%${q}%`))
  }

  const usageCount = count(bookmarks.id).as("usage_count")

  const rows = await db
    .select({
      name: bookmarks.owner,
      usage_count: usageCount,
    })
    .from(bookmarks)
    .where(and(...conditions))
    .groupBy(bookmarks.owner)
    .orderBy(asc(bookmarks.owner))

  return c.json({
    items: rows
      .filter((r): r is { name: string; usage_count: number } => Boolean(r.name))
      .map((r) => ({
        name: r.name,
        usage_count: Number(r.usage_count),
      })),
  })
})

bookmarkRoutes.get("/bookmarks/sites", async (c) => {
  const db = c.get("db")
  const q = c.req.query("q")?.trim()

  const siteLabel = sql<string>`COALESCE(${bookmarks.siteName}, ${bookmarks.owner})`

  const conditions = [
    isNull(bookmarks.deletedAt),
    eq(bookmarks.sourceType, "url"),
    sql`COALESCE(${bookmarks.siteName}, ${bookmarks.owner}) IS NOT NULL`,
  ]
  if (q) {
    conditions.push(
      sql`COALESCE(${bookmarks.siteName}, ${bookmarks.owner}) LIKE ${`%${q}%`}`,
    )
  }

  const usageCount = count(bookmarks.id).as("usage_count")

  const rows = await db
    .select({
      name: siteLabel.as("name"),
      usage_count: usageCount,
    })
    .from(bookmarks)
    .where(and(...conditions))
    .groupBy(siteLabel)
    .orderBy(asc(siteLabel))

  return c.json({
    items: rows
      .filter((r): r is { name: string; usage_count: number } => Boolean(r.name))
      .map((r) => ({
        name: r.name,
        usage_count: Number(r.usage_count),
      })),
  })
})

bookmarkRoutes.get("/bookmarks/:id", async (c) => {
  const db = c.get("db")
  const isPublicRead = Boolean(c.get("isPublicRead"))
  const id = c.req.param("id")
  const row = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt)))
    .get()
  if (!row) return c.json({ error: "收藏不存在", code: "NOT_FOUND" }, 404)

  const tagMap = await loadTagsForBookmarks(db, [id])
  const allFolders = await db.select().from(folders)
  const folder = row.folderId
    ? allFolders.find((f) => f.id === row.folderId) ?? null
    : null

  return c.json(
    serializeBookmark(row, tagMap.get(id) ?? [], folder, allFolders, {
      isPublicRead,
    }),
  )
})

bookmarkRoutes.post("/bookmarks", async (c) => {
  const db = c.get("db")
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = createBookmarkSchema.safeParse(body)
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

  const detected = detectSourceType(parsed.data.url)
  if (!detected.ok) {
    return c.json(
      {
        error: detected.error,
        code: detected.code,
        details: detected.detectedType
          ? { detected_type: detected.detectedType }
          : undefined,
      },
      400,
    )
  }

  if (detected.sourceType === "url") {
    const canonical = canonicalizeUrl(parsed.data.url)
    if (!canonical.ok) {
      return c.json(
        { error: canonical.error, code: canonical.code },
        400,
      )
    }

    const existing = await db
      .select({ id: bookmarks.id, deletedAt: bookmarks.deletedAt })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.sourceType, "url"),
          eq(bookmarks.canonicalUrl, canonical.canonicalUrl),
        ),
      )
      .get()

    if (existing && !existing.deletedAt) {
      return c.json(
        {
          error: "该网页已收藏",
          code: "DUPLICATE",
          details: { id: existing.id },
        },
        409,
      )
    }

    let pageMeta
    try {
      pageMeta = await fetchUrlPageMetadata(canonical.canonicalUrl)
    } catch (e) {
      if (e instanceof UrlFetchError) {
        return c.json({ error: e.message, code: e.code }, 400)
      }
      return c.json({ error: "抓取网页失败", code: "FETCH_FAILED" }, 502)
    }

    // 抓取可能跟随重定向得到最终 URL；再与库内去重
    const finalCanonical = canonicalizeUrl(pageMeta.finalUrl)
    const storeUrl = finalCanonical.ok
      ? finalCanonical.canonicalUrl
      : pageMeta.finalUrl
    const storeHost = finalCanonical.ok
      ? finalCanonical.hostname
      : canonical.hostname
    const storePath = finalCanonical.ok
      ? finalCanonical.pathname
      : canonical.pathname

    if (storeUrl !== canonical.canonicalUrl) {
      const existingFinal = await db
        .select({ id: bookmarks.id, deletedAt: bookmarks.deletedAt })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.sourceType, "url"),
            eq(bookmarks.canonicalUrl, storeUrl),
          ),
        )
        .get()
      if (existingFinal && !existingFinal.deletedAt) {
        return c.json(
          {
            error: "该网页已收藏",
            code: "DUPLICATE",
            details: { id: existingFinal.id },
          },
          409,
        )
      }
    }

    const id = existing?.id ?? crypto.randomUUID()
    const now = nowIso()
    const values = {
      sourceType: "url" as const,
      canonicalUrl: storeUrl,
      externalId: urlExternalId(storeHost, storePath),
      owner: storeHost,
      title: pageMeta.title,
      description: pageMeta.description,
      language: null as string | null,
      stars: 0,
      forks: 0,
      license: null as string | null,
      homepage: null as string | null,
      defaultBranch: null as string | null,
      topicsJson: "[]",
      folderId: parsed.data.folderId ?? null,
      notes: parsed.data.notes ?? null,
      siteName: pageMeta.siteName,
      imageUrl: pageMeta.imageUrl,
      faviconUrl: pageMeta.faviconUrl,
      contentExcerpt: pageMeta.contentExcerpt,
      aiStatus: "pending" as const,
      trackUpdates: false,
      lastSyncedAt: now,
      pushedAt: null as string | null,
      githubUpdatedAt: null as string | null,
      syncStatus: pageMeta.syncOk ? ("ok" as const) : ("error" as const),
      lastSyncError: pageMeta.syncError,
      healthStatus: "unknown" as const,
      githubArchived: false,
      repoSize: null as number | null,
      updatedAt: now,
    }

    if (existing) {
      await db
        .update(bookmarks)
        .set({
          ...values,
          summaryAi: null,
          useCasesJson: null,
          aiConfidence: null,
          latestReleaseTag: null,
          archivedAt: null,
          deletedAt: null,
          createdAt: now,
        })
        .where(eq(bookmarks.id, id))
      await db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, id))
    } else {
      await db.insert(bookmarks).values({ ...values, id, createdAt: now })
    }

    c.executionCtx.waitUntil(runAiForBookmark(db, c.env, id))
    const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
    return c.json(serializeBookmark(row!, [], null), 201)
  }

  if (detected.sourceType === "twitter") {
    const parsedTw = parseTwitterStatusInput(parsed.data.url)
    if (!parsedTw.ok) {
      return c.json(
        { error: parsedTw.error, code: parsedTw.code },
        400,
      )
    }

    const { tweetId, handle } = parsedTw.data

    const existingById = await db
      .select({ id: bookmarks.id, deletedAt: bookmarks.deletedAt })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.sourceType, "twitter"),
          eq(bookmarks.externalId, tweetId),
        ),
      )
      .get()

    if (existingById && !existingById.deletedAt) {
      return c.json(
        {
          error: "该帖子已收藏",
          code: "DUPLICATE",
          details: { id: existingById.id },
        },
        409,
      )
    }

    const meta = await fetchTwitterMetadata(tweetId, handle)

    const existingByUrl = await db
      .select({ id: bookmarks.id, deletedAt: bookmarks.deletedAt })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.sourceType, "twitter"),
          eq(bookmarks.canonicalUrl, meta.canonicalUrl),
        ),
      )
      .get()

    if (
      existingByUrl &&
      !existingByUrl.deletedAt &&
      existingByUrl.id !== existingById?.id
    ) {
      return c.json(
        {
          error: "该帖子已收藏",
          code: "DUPLICATE",
          details: { id: existingByUrl.id },
        },
        409,
      )
    }

    const id = existingById?.id ?? existingByUrl?.id ?? crypto.randomUUID()
    const now = nowIso()
    const values = {
      sourceType: "twitter" as const,
      canonicalUrl: meta.canonicalUrl,
      externalId: meta.tweetId,
      owner: meta.owner,
      title: meta.title,
      description: meta.description,
      language: meta.language,
      stars: meta.stars,
      forks: 0,
      license: null as string | null,
      homepage: meta.homepage,
      defaultBranch: null as string | null,
      topicsJson: JSON.stringify(meta.topics),
      folderId: parsed.data.folderId ?? null,
      notes: parsed.data.notes ?? null,
      siteName: meta.siteName,
      imageUrl: meta.imageUrl,
      faviconUrl: meta.faviconUrl,
      contentExcerpt: meta.contentExcerpt,
      platformMetaJson: JSON.stringify(meta.platformMeta),
      aiStatus: "pending" as const,
      trackUpdates: false,
      lastSyncedAt: now,
      pushedAt: meta.pushedAt,
      githubUpdatedAt: null as string | null,
      syncStatus: meta.syncOk ? ("ok" as const) : ("error" as const),
      lastSyncError: meta.syncError,
      healthStatus: "unknown" as const,
      githubArchived: false,
      repoSize: null as number | null,
      updatedAt: now,
    }

    if (existingById || existingByUrl) {
      await db
        .update(bookmarks)
        .set({
          ...values,
          summaryAi: null,
          useCasesJson: null,
          aiConfidence: null,
          latestReleaseTag: null,
          archivedAt: null,
          deletedAt: null,
          createdAt: now,
        })
        .where(eq(bookmarks.id, id))
      await db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, id))
    } else {
      await db.insert(bookmarks).values({ ...values, id, createdAt: now })
    }

    c.executionCtx.waitUntil(runAiForBookmark(db, c.env, id))
    const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
    return c.json(serializeBookmark(row!, [], null), 201)
  }

  if (detected.sourceType !== "github") {
    return c.json(
      {
        error: `识别为${detected.label}，专项能力尚未接入`,
        code: "UNSUPPORTED_SOURCE",
        details: { detected_type: detected.sourceType },
      },
      400,
    )
  }

  const parsedRepo = parseGithubRepoInput(parsed.data.url)
  if (!parsedRepo) {
    return c.json(
      { error: "无效的 GitHub URL 或 owner/repo", code: "INVALID_URL" },
      400,
    )
  }

  const existing = await db
    .select({ id: bookmarks.id, deletedAt: bookmarks.deletedAt })
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.sourceType, "github"),
        eq(bookmarks.canonicalUrl, parsedRepo.canonicalUrl),
      ),
    )
    .get()

  if (existing && !existing.deletedAt) {
    return c.json(
      {
        error: "该仓库已收藏",
        code: "DUPLICATE",
        details: { id: existing.id },
      },
      409,
    )
  }

  const token = await resolveGithubToken(db, c.env)
  let meta
  try {
    meta = await fetchGithubRepo(parsedRepo.owner, parsedRepo.repo, token)
  } catch (e) {
    if (e instanceof GithubApiError) {
      return c.json(
        { error: e.message, code: "GITHUB_ERROR" },
        e.status === 404 ? 404 : e.status === 403 ? 403 : 502,
      )
    }
    return c.json({ error: "拉取 GitHub 元数据失败", code: "GITHUB_ERROR" }, 502)
  }

  const user = await db.select().from(users).get()
  const hotWithinDays = user?.hotWithinDays ?? DEFAULT_HOT_WITHIN_DAYS
  const staleAfterDays = user?.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS
  const syncStatus = meta.disabled ? ("forbidden" as const) : ("ok" as const)
  const healthStatus = computeHealthStatus({
    syncStatus,
    githubArchived: meta.archived,
    githubDisabled: meta.disabled,
    repoSize: meta.size,
    pushedAt: meta.pushedAt,
    defaultBranch: meta.defaultBranch,
    hotWithinDays,
    staleAfterDays,
  })

  const id = existing?.id ?? crypto.randomUUID()
  const now = nowIso()

  const values = {
    sourceType: "github" as const,
    canonicalUrl: parsedRepo.canonicalUrl,
    externalId: parsedRepo.externalId,
    owner: meta.fullName.split("/")[0] || parsedRepo.owner,
    title: meta.fullName,
    description: meta.description,
    language: meta.language,
    stars: meta.stars,
    forks: meta.forks,
    license: meta.license,
    homepage: meta.homepage,
    defaultBranch: meta.defaultBranch,
    topicsJson: JSON.stringify(meta.topics),
    folderId: parsed.data.folderId ?? null,
    notes: parsed.data.notes ?? null,
    aiStatus: "pending" as const,
    trackUpdates: parsed.data.trackUpdates ?? true,
    lastSyncedAt: now,
    pushedAt: meta.pushedAt,
    githubUpdatedAt: meta.updatedAt,
    syncStatus,
    lastSyncError: null as string | null,
    healthStatus,
    githubArchived: meta.archived,
    repoSize: meta.size,
    updatedAt: now,
  }

  if (existing) {
    await db
      .update(bookmarks)
      .set({
        ...values,
        summaryAi: null,
        useCasesJson: null,
        aiConfidence: null,
        latestReleaseTag: null,
        archivedAt: null,
        deletedAt: null,
        createdAt: now,
      })
      .where(eq(bookmarks.id, id))
    await db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, id))
  } else {
    await db.insert(bookmarks).values({ ...values, id, createdAt: now })
  }

  c.executionCtx.waitUntil(runAiForBookmark(db, c.env, id))

  const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
  return c.json(serializeBookmark(row!, [], null), 201)
})

bookmarkRoutes.patch("/bookmarks/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = updateBookmarkSchema.safeParse(body)
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

  const existing = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt)))
    .get()
  if (!existing) return c.json({ error: "收藏不存在", code: "NOT_FOUND" }, 404)

  const data = parsed.data
  const patch: Partial<typeof bookmarks.$inferInsert> = {
    updatedAt: nowIso(),
  }
  if (data.notes !== undefined) patch.notes = data.notes
  if (data.folderId !== undefined) patch.folderId = data.folderId
  if (data.title !== undefined) patch.title = data.title
  if (data.summaryAi !== undefined) patch.summaryAi = data.summaryAi
  if (data.trackUpdates !== undefined) {
    const caps =
      SOURCE_CAPABILITIES[(existing.sourceType as SourceType) ?? "github"] ??
      SOURCE_CAPABILITIES.github
    if (caps.trackUpdates) {
      patch.trackUpdates = data.trackUpdates
    }
  }
  if (data.archived !== undefined) {
    patch.archivedAt = data.archived ? nowIso() : null
  }

  await db.update(bookmarks).set(patch).where(eq(bookmarks.id, id))

  if (data.tagNames) {
    await syncBookmarkTags(db, id, data.tagNames)
  }

  const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
  const tagMap = await loadTagsForBookmarks(db, [id])
  const allFolders = await db.select().from(folders)
  const folder = row?.folderId
    ? allFolders.find((f) => f.id === row.folderId) ?? null
    : null

  return c.json(
    serializeBookmark(row!, tagMap.get(id) ?? [], folder, allFolders),
  )
})

bookmarkRoutes.delete("/bookmarks/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")
  const existing = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt)))
    .get()
  if (!existing) return c.json({ error: "收藏不存在", code: "NOT_FOUND" }, 404)

  await db
    .update(bookmarks)
    .set({ deletedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(bookmarks.id, id))

  return c.json({ ok: true })
})

bookmarkRoutes.post("/bookmarks/:id/open", async (c) => {
  const db = c.get("db")
  const isPublicRead = Boolean(c.get("isPublicRead"))
  const id = c.req.param("id")
  const existing = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt)))
    .get()
  if (!existing) return c.json({ error: "收藏不存在", code: "NOT_FOUND" }, 404)

  await db
    .update(bookmarks)
    .set({
      clickCount: sql`${bookmarks.clickCount} + 1`,
      updatedAt: nowIso(),
    })
    .where(eq(bookmarks.id, id))

  const row = await db.select().from(bookmarks).where(eq(bookmarks.id, id)).get()
  const tagMap = await loadTagsForBookmarks(db, [id])
  const allFolders = await db.select().from(folders)
  const folder = row?.folderId
    ? allFolders.find((f) => f.id === row.folderId) ?? null
    : null

  return c.json(
    serializeBookmark(row!, tagMap.get(id) ?? [], folder, allFolders, {
      isPublicRead,
    }),
  )
})

bookmarkRoutes.post("/bookmarks/:id/ai/regenerate", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")
  const existing = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt)))
    .get()
  if (!existing) return c.json({ error: "收藏不存在", code: "NOT_FOUND" }, 404)

  await db
    .update(bookmarks)
    .set({ aiStatus: "pending", updatedAt: nowIso() })
    .where(eq(bookmarks.id, id))

  c.executionCtx.waitUntil(
    runAiForBookmark(db, c.env, id, { overwriteFolder: true }),
  )
  return c.json({ ok: true, ai_status: "pending" })
})
