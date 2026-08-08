import { bookmarks } from "@mankr/db"
import {
  IMPORT_README_FETCH_LIMIT,
  computeHealthStatus,
  importGithubSchema,
} from "@mankr/shared"
import { and, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { resolveGithubToken, runAiForBookmark } from "../lib/ai-service"
import {
  GithubApiError,
  fetchReadmeExcerpt,
  fetchStarredPage,
  type StarredRepo,
} from "../lib/github"
import { rateLimit } from "../lib/rate-limit"
import { readSetting } from "../lib/settings-store"
import { getClientIp, nowIso } from "../lib/utils"
import { requireAuth } from "../middleware/auth"

export const importRoutes = new Hono<AppEnv>()

importRoutes.use("/bookmarks/import/*", requireAuth)

/**
 * 分页基础版：从 GitHub Stars 导入（需配置 GitHub PAT）
 */
importRoutes.post("/bookmarks/import/github", async (c) => {
  const ip = getClientIp(c.req.raw)
  const rl = rateLimit(`import-github:${ip}`, 5, 300_000)
  if (!rl.ok) {
    return c.json({ error: "请求过于频繁", code: "RATE_LIMITED" }, 429)
  }

  let body: unknown = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }

  const parsed = importGithubSchema.safeParse(body)
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
  const token = await resolveGithubToken(db, c.env)
  if (!token) {
    return c.json(
      {
        error: "请先在设置中配置 GitHub PAT",
        code: "PAT_REQUIRED",
      },
      400,
    )
  }

  const { hotWithinDays, staleAfterDays } = await readSetting(db, "tracking")

  const startPage = parsed.data.page
  const perPage = parsed.data.perPage
  const maxPages = parsed.data.maxPages

  let imported = 0
  let skipped = 0
  let page = startPage
  /** 下一页续导起点；无更多页时为 null（勿再对 page 二次 +1） */
  let nextPage: number | null = null
  const created: Array<{ id: string; owner: string; repo: string }> = []

  try {
    for (let i = 0; i < maxPages; i++) {
      const { repos, hasMore } = await fetchStarredPage(token, page, perPage)
      const result = await importStarredPage(db, repos, {
        hotWithinDays,
        staleAfterDays,
      })
      imported += result.imported
      skipped += result.skipped
      created.push(...result.created)

      if (!hasMore || repos.length === 0) {
        nextPage = null
        break
      }
      nextPage = page + 1
      page += 1
    }
  } catch (e) {
    if (e instanceof GithubApiError) {
      return c.json(
        { error: e.message, code: "GITHUB_ERROR" },
        e.status === 401 ? 401 : 502,
      )
    }
    throw e
  }

  // README 与 AI 都放到响应之后：批量导入本就慢，不该再让用户等这些补充信息
  c.executionCtx.waitUntil(
    (async () => {
      const readmeTargets = created.slice(0, IMPORT_README_FETCH_LIMIT)
      const concurrency = 5
      for (let i = 0; i < readmeTargets.length; i += concurrency) {
        const chunk = readmeTargets.slice(i, i + concurrency)
        await Promise.all(
          chunk.map(async (item) => {
            const readmeExcerpt = await fetchReadmeExcerpt(
              item.owner,
              item.repo,
              token,
            )
            // null → 空串：标记「已尝试」，避免 Cron 对必然失败的仓库反复打点
            await db
              .update(bookmarks)
              .set({ readmeExcerpt: readmeExcerpt ?? "" })
              .where(eq(bookmarks.id, item.id))
          }),
        )
      }
      for (const item of created.slice(0, 10)) {
        await runAiForBookmark(db, c.env, item.id)
      }
    })(),
  )

  return c.json({
    imported,
    skipped,
    next_page: nextPage,
    has_more: nextPage != null,
    pending_ai: created.length,
  })
})

type ImportDb = AppEnv["Variables"]["db"]

/** 单页 Stars：批量判重；软删同 URL 则复活，避免撞唯一索引 */
async function importStarredPage(
  db: ImportDb,
  repos: StarredRepo[],
  thresholds: { hotWithinDays: number; staleAfterDays: number },
): Promise<{
  imported: number
  skipped: number
  created: Array<{ id: string; owner: string; repo: string }>
}> {
  let imported = 0
  let skipped = 0
  const created: Array<{ id: string; owner: string; repo: string }> = []

  const withUrl = repos
    .filter((repo) => Boolean(repo.fullName))
    .map((repo) => ({
      repo,
      canonicalUrl: `https://github.com/${repo.fullName}`,
    }))
  if (withUrl.length === 0) {
    return { imported, skipped, created }
  }

  const urls = withUrl.map((r) => r.canonicalUrl)
  const existingRows = await db
    .select({
      id: bookmarks.id,
      canonicalUrl: bookmarks.canonicalUrl,
      deletedAt: bookmarks.deletedAt,
    })
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.sourceType, "github"),
        inArray(bookmarks.canonicalUrl, urls),
      ),
    )
  const byUrl = new Map(existingRows.map((r) => [r.canonicalUrl, r]))

  for (const { repo, canonicalUrl } of withUrl) {
    const existing = byUrl.get(canonicalUrl)
    if (existing && !existing.deletedAt) {
      skipped += 1
      continue
    }

    const now = nowIso()
    const syncStatus = repo.disabled ? ("forbidden" as const) : ("ok" as const)
    const healthStatus = computeHealthStatus({
      syncStatus,
      githubArchived: repo.archived,
      githubDisabled: repo.disabled,
      repoSize: repo.size,
      pushedAt: repo.pushedAt,
      defaultBranch: repo.defaultBranch,
      hotWithinDays: thresholds.hotWithinDays,
      staleAfterDays: thresholds.staleAfterDays,
    })
    const owner = repo.fullName.split("/")[0] || repo.owner
    const values = {
      sourceType: "github" as const,
      canonicalUrl,
      externalId: repo.fullName,
      owner,
      title: repo.fullName,
      description: repo.description,
      language: repo.language,
      stars: repo.stars,
      forks: repo.forks,
      license: repo.license,
      homepage: repo.homepage,
      defaultBranch: repo.defaultBranch,
      topicsJson: JSON.stringify(repo.topics),
      aiStatus: "pending" as const,
      trackUpdates: true,
      lastSyncedAt: now,
      pushedAt: repo.pushedAt,
      githubUpdatedAt: repo.updatedAt,
      syncStatus,
      healthStatus,
      githubArchived: repo.archived,
      repoSize: repo.size,
      updatedAt: now,
      // 复活时清掉旧 AI / 归档态，与 POST /bookmarks 对齐
      summaryAi: null,
      useCasesJson: null,
      aiConfidence: null,
      latestReleaseTag: null,
      archivedAt: null,
      deletedAt: null,
      readmeExcerpt: null,
    }

    const id = existing?.id ?? crypto.randomUUID()
    if (existing) {
      await db
        .update(bookmarks)
        .set({ ...values, createdAt: now })
        .where(eq(bookmarks.id, id))
    } else {
      await db.insert(bookmarks).values({ ...values, id, createdAt: now })
      byUrl.set(canonicalUrl, { id, canonicalUrl, deletedAt: null })
    }

    created.push({ id, owner: repo.owner, repo: repo.repo })
    imported += 1
  }

  return { imported, skipped, created }
}
