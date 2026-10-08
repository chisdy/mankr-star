import { DISCOVERY_CONFIG, classifyDiscoveryContent } from "./channels"
import { fetchDiscoveryResponse, readDiscoveryJson } from "./http"
import { discoveryPlainText, normalizeDiscoveryUrl } from "./normalize"
import {
  SourceFetchError,
  type DiscoveryCandidate,
  type DiscoveryConfig,
  type SourceFetchContext,
} from "./types"

const API = "https://hacker-news.firebaseio.com/v0"

export async function fetchHnStoryIds(
  list: "topstories" | "beststories",
  context: SourceFetchContext
): Promise<number[]> {
  return fetchDiscoveryResponse(
    `${API}/${list}.json`,
    "hn-list",
    ["hacker-news.firebaseio.com"],
    context,
    async (response) => {
      const payload = await readDiscoveryJson(response)
      if (
        !Array.isArray(payload) ||
        !payload.every((id) => Number.isSafeInteger(id) && id > 0)
      )
        throw new SourceFetchError("HN_INVALID_LIST")
      // A saved single-list checkpoint never needs more than the daily 40 IDs.
      return [...new Set(payload as number[])].slice(0, 40)
    }
  )
}

export async function fetchHnCandidateIds(
  context: SourceFetchContext,
  max = 40
): Promise<number[]> {
  const lists = await Promise.all(
    (["topstories", "beststories"] as const).map((list) =>
      fetchHnStoryIds(list, context)
    )
  )
  return [...new Set(lists.flat())].slice(0, Math.max(0, Math.min(40, max)))
}

export async function fetchHnItem(
  id: number,
  position: number,
  context: SourceFetchContext,
  config: DiscoveryConfig = DISCOVERY_CONFIG
): Promise<DiscoveryCandidate | null> {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new SourceFetchError("HN_INVALID_ID")
  return fetchDiscoveryResponse(
    `${API}/item/${id}.json`,
    "hn-item",
    ["hacker-news.firebaseio.com"],
    context,
    async (response) => {
      const payload = await readDiscoveryJson(response)
      if (payload === null) return null
      if (!payload || typeof payload !== "object")
        throw new SourceFetchError("HN_INVALID_ITEM")
      const item = payload as Record<string, unknown>
      if (
        item.type !== "story" ||
        item.deleted === true ||
        item.dead === true ||
        item.id !== id ||
        typeof item.title !== "string" ||
        !Number.isFinite(item.time)
      )
        return null
      const publishedMs = (item.time as number) * 1000
      const age = context.now.getTime() - publishedMs
      if (age < -5 * 60 * 1000 || age > 7 * 86400000) return null
      const discussionUrl = `https://news.ycombinator.com/item?id=${id}`
      const url =
        typeof item.url === "string" && item.url ? item.url : discussionUrl
      const normalized = normalizeDiscoveryUrl(url)
      if (!normalized) return null
      const title = discoveryPlainText(item.title, 500)
      if (!title) return null
      const summary = discoveryPlainText(
        typeof item.text === "string" ? item.text : null
      )
      const channels = classifyDiscoveryContent(
        title,
        summary,
        normalized.canonicalUrl,
        config
      )
      if (channels.length === 0) return null
      const observedAt = context.now.toISOString()
      const publishedAt = new Date(publishedMs).toISOString()
      const metric = (value: unknown) =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0
          ? value
          : 0
      return {
        externalId: String(id),
        source: "hn",
        sourceId: "hn",
        title,
        summary,
        url: normalized.canonicalUrl,
        ...normalized,
        githubRepoId: null,
        channels,
        observedAt,
        publishedAt,
        evidence: {
          source: "hn",
          sourceId: "hn",
          url: discussionUrl,
          observedAt,
          publishedAt,
          score: metric(item.score),
          comments: metric(item.descendants),
          position,
        },
      }
    }
  )
}
