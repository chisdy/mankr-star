import type { DiscoveryChannelId } from "@mankr/shared"
import { DISCOVERY_CONFIG } from "./channels"
import { fetchDiscoveryResponse, readDiscoveryJson } from "./http"
import { discoveryPlainText, normalizeDiscoveryUrl } from "./normalize"
import {
  SourceFetchError,
  type DiscoveryCandidate,
  type DiscoveryConfig,
  type GithubPoolMember,
  type SourceFetchContext,
} from "./types"

function githubHeaders(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Mankr-Star-Discovery",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export function githubSearchUrl(
  config: DiscoveryConfig,
  channel: DiscoveryChannelId,
  queryIndex: number,
  now: Date
): string {
  const rule = config.channels.find((item) => item.id === channel)
  if (!rule || queryIndex < 0 || queryIndex >= rule.topics.length * 2)
    throw new SourceFetchError("INVALID_GITHUB_QUERY")
  const topic = rule.topics[Math.floor(queryIndex / 2)]!
  const activeSince = new Date(
    now.getTime() - config.github.activeDays * 86400000
  )
    .toISOString()
    .slice(0, 10)
  const params = new URLSearchParams({
    q: `topic:${topic} is:public archived:false fork:false stars:>=${config.github.minStars} pushed:>=${activeSince}`,
    sort: queryIndex % 2 === 0 ? "stars" : "updated",
    order: "desc",
    per_page: String(Math.min(25, config.github.pageSize)),
    page: "1",
  })
  return `https://api.github.com/search/repositories?${params}`
}

export function githubCandidate(
  payload: unknown,
  channel: DiscoveryChannelId,
  context: SourceFetchContext,
  position = 0
): DiscoveryCandidate | null {
  if (!payload || typeof payload !== "object") return null
  const repo = payload as Record<string, unknown>
  if (
    !Number.isSafeInteger(repo.id) ||
    (repo.id as number) <= 0 ||
    typeof repo.full_name !== "string" ||
    typeof repo.html_url !== "string" ||
    !Number.isSafeInteger(repo.stargazers_count) ||
    (repo.stargazers_count as number) < 0 ||
    repo.private === true ||
    repo.archived === true ||
    repo.fork === true ||
    repo.disabled === true
  )
    return null
  const normalized = normalizeDiscoveryUrl(repo.html_url)
  if (!normalized || normalized.bookmarkSourceType !== "github") return null
  const name = repo.full_name.split("/")
  if (name.length !== 2 || name[0]!.length > 39 || name[1]!.length > 100)
    return null
  const namedIdentity = normalizeDiscoveryUrl(
    `https://github.com/${repo.full_name}`
  )
  if (namedIdentity?.canonicalUrl !== normalized.canonicalUrl) return null
  const observedAt = context.now.toISOString()
  const publishedAt =
    typeof repo.created_at === "string" &&
    Number.isFinite(Date.parse(repo.created_at))
      ? new Date(repo.created_at).toISOString()
      : null
  return {
    externalId: String(repo.id),
    source: "github",
    sourceId: "github",
    title: repo.full_name,
    summary: discoveryPlainText(
      typeof repo.description === "string" ? repo.description : null
    ),
    url: normalized.canonicalUrl,
    ...normalized,
    githubRepoId: repo.id as number,
    channels: [channel],
    observedAt,
    publishedAt,
    evidence: {
      source: "github",
      sourceId: "github",
      url: normalized.canonicalUrl,
      observedAt,
      publishedAt,
      stars: repo.stargazers_count as number,
      growth: null,
      previousObservedAt: null,
      position,
    },
  }
}

export async function fetchGithubSearch(
  config: DiscoveryConfig,
  channel: DiscoveryChannelId,
  queryIndex: number,
  context: SourceFetchContext,
  token?: string
): Promise<DiscoveryCandidate[]> {
  return fetchDiscoveryResponse(
    githubSearchUrl(config, channel, queryIndex, context.now),
    "github-search",
    ["api.github.com"],
    context,
    async (response) => {
      const payload = await readDiscoveryJson(response)
      if (
        !payload ||
        typeof payload !== "object" ||
        !Array.isArray((payload as Record<string, unknown>).items)
      )
        throw new SourceFetchError("GITHUB_INVALID_SEARCH")
      if ((payload as Record<string, unknown>).incomplete_results === true)
        throw new SourceFetchError("GITHUB_INCOMPLETE_SEARCH", true)
      return (payload as { items: unknown[] }).items
        .slice(0, Math.min(25, config.github.pageSize))
        .map((repo, position) =>
          githubCandidate(repo, channel, context, queryIndex * 25 + position)
        )
        .filter((repo): repo is DiscoveryCandidate => repo !== null)
    },
    githubHeaders(token)
  )
}

/** Numeric ID survives repository rename/transfer and never fetches arbitrary URLs. */
export async function fetchGithubRepository(
  id: number,
  context: SourceFetchContext,
  token?: string,
  channel: DiscoveryChannelId = "ai"
): Promise<DiscoveryCandidate | null> {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new SourceFetchError("INVALID_GITHUB_ID")
  try {
    return await fetchDiscoveryResponse(
      `https://api.github.com/repositories/${id}`,
      "github-detail",
      ["api.github.com"],
      context,
      async (response) => {
        const candidate = githubCandidate(
          await readDiscoveryJson(response),
          channel,
          context
        )
        if (candidate && candidate.githubRepoId !== id)
          throw new SourceFetchError("GITHUB_ID_MISMATCH")
        return candidate
      },
      githubHeaders(token)
    )
  } catch (error) {
    if (
      error instanceof SourceFetchError &&
      error.errorCode === "SOURCE_HTTP_404"
    )
      return null
    throw error
  }
}

export function selectGithubPool(
  previous: readonly GithubPoolMember[],
  search: readonly DiscoveryCandidate[],
  day: string,
  maxSize = DISCOVERY_CONFIG.github.poolPerChannel
): GithubPoolMember[] {
  const hits = new Map<number, DiscoveryCandidate>()
  for (const candidate of [...search].sort(
    (a, b) =>
      (a.evidence.position ?? 0) - (b.evidence.position ?? 0) ||
      (a.githubRepoId ?? 0) - (b.githubRepoId ?? 0)
  )) {
    if (candidate.githubRepoId !== null && !hits.has(candidate.githubRepoId))
      hits.set(candidate.githubRepoId, candidate)
  }
  const oldIds = new Set(previous.map((item) => item.githubRepoId))
  const fresh: GithubPoolMember[] = [...hits.keys()]
    .filter((id) => !oldIds.has(id))
    .map((id) => ({
      githubRepoId: id,
      joinedDay: day,
      lastSearchHitDay: day,
      kind: "new",
    }))
  const retained = previous
    .map(
      (member): GithubPoolMember => ({
        ...member,
        lastSearchHitDay: hits.has(member.githubRepoId)
          ? day
          : member.lastSearchHitDay,
        kind: "retained",
      })
    )
    .filter((member) => {
      const age =
        (Date.parse(day) - Date.parse(member.lastSearchHitDay)) / 86400000
      return age >= 0 && age <= 7
    })
    .sort(
      (a, b) =>
        b.lastSearchHitDay.localeCompare(a.lastSearchHitDay) ||
        a.githubRepoId - b.githubRepoId
    )
  const limit = Math.min(20, Math.max(0, maxSize))
  const quota = Math.floor(limit / 2)
  const selected = [...fresh.slice(0, quota), ...retained.slice(0, quota)]
  return [...selected, ...fresh.slice(quota), ...retained.slice(quota)].slice(
    0,
    limit
  )
}

export function githubGrowth(
  current: { stars: number; observedAt: string },
  previous: { stars: number; observedAt: string } | null,
  day: string
): { growth: number | null; previousObservedAt: string | null } {
  if (!previous) return { growth: null, previousObservedAt: null }
  const yesterday = new Date(Date.parse(day) - 86400000)
    .toISOString()
    .slice(0, 10)
  const previousDay = new Date(Date.parse(previous.observedAt) + 8 * 3600000)
    .toISOString()
    .slice(0, 10)
  const hours =
    (Date.parse(current.observedAt) - Date.parse(previous.observedAt)) / 3600000
  if (
    previousDay !== yesterday ||
    hours < 20 ||
    hours > 36 ||
    !Number.isFinite(hours)
  )
    return { growth: null, previousObservedAt: null }
  return {
    growth: current.stars - previous.stars,
    previousObservedAt: previous.observedAt,
  }
}
