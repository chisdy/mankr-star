import { bookmarks } from "@mankr/db"
import { computeHealthStatus, importGithubSchema } from "@mankr/shared"
import { and, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { resolveGithubToken, runAiForBookmark } from "../lib/ai-service"
import { GithubApiError, fetchStarredPage } from "../lib/github"
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

  const startPage = parsed.data.page ?? 1
  const perPage = parsed.data.perPage ?? 30
  const maxPages = parsed.data.maxPages ?? 3

  let imported = 0
  let skipped = 0
  let page = startPage
  const createdIds: string[] = []

  try {
    for (let i = 0; i < maxPages; i++) {
      const { repos, hasMore } = await fetchStarredPage(token, page, perPage)
      for (const repo of repos) {
        if (!repo.fullName) continue
        const canonicalUrl = `https://github.com/${repo.fullName}`
        const existing = await db
          .select({ id: bookmarks.id })
          .from(bookmarks)
          .where(
            and(
              eq(bookmarks.sourceType, "github"),
              eq(bookmarks.canonicalUrl, canonicalUrl),
              isNull(bookmarks.deletedAt),
            ),
          )
          .get()
        if (existing) {
          skipped += 1
          continue
        }

        const id = crypto.randomUUID()
        const now = nowIso()
        const syncStatus = repo.disabled ? ("forbidden" as const) : ("ok" as const)
        const healthStatus = computeHealthStatus({
          syncStatus,
          githubArchived: repo.archived,
          githubDisabled: repo.disabled,
          repoSize: repo.size,
          pushedAt: repo.pushedAt,
          defaultBranch: repo.defaultBranch,
          hotWithinDays,
          staleAfterDays,
        })
        await db.insert(bookmarks).values({
          id,
          sourceType: "github",
          canonicalUrl,
          externalId: repo.fullName,
          owner: repo.fullName.split("/")[0] || repo.owner,
          title: repo.fullName,
          description: repo.description,
          language: repo.language,
          stars: repo.stars,
          forks: repo.forks,
          license: repo.license,
          homepage: repo.homepage,
          defaultBranch: repo.defaultBranch,
          topicsJson: JSON.stringify(repo.topics),
          aiStatus: "pending",
          trackUpdates: true,
          lastSyncedAt: now,
          pushedAt: repo.pushedAt,
          githubUpdatedAt: repo.updatedAt,
          syncStatus,
          healthStatus,
          githubArchived: repo.archived,
          repoSize: repo.size,
          createdAt: now,
          updatedAt: now,
        })
        createdIds.push(id)
        imported += 1
      }

      if (!hasMore || repos.length === 0) break
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

  c.executionCtx.waitUntil(
    (async () => {
      for (const id of createdIds.slice(0, 10)) {
        await runAiForBookmark(db, c.env, id)
      }
    })(),
  )

  return c.json({
    imported,
    skipped,
    next_page: page + 1,
    pending_ai: createdIds.length,
  })
})
