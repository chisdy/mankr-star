import type {
  DiscoveryChannelId,
  DiscoveryEvidence,
  DiscoverySource,
} from "@mankr/shared"
import { DISCOVERY_CONFIG } from "./channels"
import type { DiscoveryCandidate, DiscoveryConfig } from "./types"

export interface RankableDiscoveryCandidate extends Omit<
  DiscoveryCandidate,
  "evidence"
> {
  itemId?: string
  evidence: DiscoveryEvidence | DiscoveryEvidence[]
}

export interface RankedDiscoveryCandidate extends Omit<
  RankableDiscoveryCandidate,
  "evidence"
> {
  rank: number
  evidence: DiscoveryEvidence[]
}

function evidenceOf(
  candidate: RankableDiscoveryCandidate
): DiscoveryEvidence[] {
  return Array.isArray(candidate.evidence)
    ? candidate.evidence
    : [candidate.evidence]
}

function identity(candidate: RankableDiscoveryCandidate): string {
  return (
    candidate.itemId ??
    (candidate.githubRepoId !== null
      ? `github:${candidate.githubRepoId}`
      : candidate.canonicalUrl)
  )
}

function compareSource(
  source: DiscoverySource,
  a: RankableDiscoveryCandidate,
  b: RankableDiscoveryCandidate
): number {
  const left = evidenceOf(a).find((item) => item.source === source)!
  const right = evidenceOf(b).find((item) => item.source === source)!
  if (source === "github") {
    const growthA =
      left.growth === null || left.growth === undefined
        ? null
        : Math.max(0, left.growth)
    const growthB =
      right.growth === null || right.growth === undefined
        ? null
        : Math.max(0, right.growth)
    if (growthA !== null && growthB !== null && growthA !== growthB)
      return growthB - growthA
    if ((growthA !== null) !== (growthB !== null))
      return growthA !== null ? -1 : 1
    return (
      (left.position ?? 9999) - (right.position ?? 9999) ||
      (right.stars ?? 0) - (left.stars ?? 0) ||
      identity(a).localeCompare(identity(b))
    )
  }
  if (source === "hn")
    return (
      (left.position ?? 9999) - (right.position ?? 9999) ||
      (right.score ?? 0) - (left.score ?? 0) ||
      identity(a).localeCompare(identity(b))
    )
  return (
    (Date.parse(right.publishedAt ?? "") || 0) -
      (Date.parse(left.publishedAt ?? "") || 0) ||
    identity(a).localeCompare(identity(b))
  )
}

/** Separate new discoveries remain visible rather than being buried under mature repos. */
function githubQueue(
  items: RankableDiscoveryCandidate[],
  config: DiscoveryConfig
) {
  const sorted = items.sort((a, b) => compareSource("github", a, b))
  const growth = sorted.filter((item) =>
    evidenceOf(item).some(
      (entry) =>
        entry.source === "github" &&
        entry.growth !== null &&
        entry.growth !== undefined
    )
  )
  const fresh = sorted.filter((item) => !growth.includes(item))
  const result: RankableDiscoveryCandidate[] = []
  while (growth.length || fresh.length) {
    result.push(
      ...growth.splice(0, Math.max(1, config.ranking.growthSlots)),
      ...fresh.splice(0, Math.max(1, config.ranking.newSlots))
    )
  }
  return result
}

/** 6:3:1 weighted interleave, source-local metrics only, no invented unified score. */
export function rankDiscoveryCandidates(
  candidates: readonly RankableDiscoveryCandidate[],
  channel: DiscoveryChannelId,
  limit = 20,
  config: DiscoveryConfig = DISCOVERY_CONFIG
): RankedDiscoveryCandidate[] {
  const grouped = new Map<string, RankableDiscoveryCandidate>()
  const canonicalIds = new Map<string, string>()
  for (const candidate of candidates.filter((item) =>
    item.channels.includes(channel)
  )) {
    const canonicalKey = canonicalIds.get(candidate.canonicalUrl)
    const canonicalOld = canonicalKey ? grouped.get(canonicalKey) : undefined
    const conflictingGithubIds =
      candidate.githubRepoId !== null &&
      canonicalOld?.githubRepoId !== null &&
      canonicalOld?.githubRepoId !== undefined &&
      candidate.githubRepoId !== canonicalOld.githubRepoId
    const key = conflictingGithubIds
      ? identity(candidate)
      : (canonicalKey ?? identity(candidate))
    canonicalIds.set(candidate.canonicalUrl, key)
    const old = grouped.get(key)
    if (!old) {
      grouped.set(key, { ...candidate, evidence: [...evidenceOf(candidate)] })
      continue
    }
    // Prefer stable GitHub metadata when an HN/RSS link identifies the same repository.
    const selected =
      candidate.githubRepoId !== null && old.githubRepoId === null
        ? candidate
        : old
    const evidence = [...evidenceOf(old), ...evidenceOf(candidate)]
      .filter(
        (entry, index, all) =>
          all.findIndex(
            (other) =>
              other.source === entry.source &&
              other.sourceId === entry.sourceId &&
              other.url === entry.url
          ) === index
      )
      .slice(0, 8)
    grouped.set(key, {
      ...selected,
      evidence,
      summary: selected.summary ?? old.summary ?? candidate.summary,
    })
  }
  const values = [...grouped.values()]
  const queues: Record<DiscoverySource, RankableDiscoveryCandidate[]> = {
    github: githubQueue(
      values.filter((item) =>
        evidenceOf(item).some((entry) => entry.source === "github")
      ),
      config
    ),
    hn: values
      .filter((item) => evidenceOf(item).some((entry) => entry.source === "hn"))
      .sort((a, b) => compareSource("hn", a, b)),
    rss: values
      .filter((item) =>
        evidenceOf(item).some((entry) => entry.source === "rss")
      )
      .sort((a, b) => compareSource("rss", a, b)),
  }
  const cycle =
    config.ranking.cycle.length > 0
      ? config.ranking.cycle
      : DISCOVERY_CONFIG.ranking.cycle
  const result: RankedDiscoveryCandidate[] = []
  const emitted = new Set<string>()
  const next = (source: DiscoverySource) => {
    while (queues[source].length) {
      const item = queues[source].shift()!
      if (!emitted.has(identity(item))) return item
    }
    return null
  }
  for (
    let index = 0;
    result.length < Math.min(20, Math.max(0, limit));
    index++
  ) {
    const source = cycle[index % cycle.length]!
    const item = next(source) ?? next("github") ?? next("hn") ?? next("rss")
    if (!item) break
    emitted.add(identity(item))
    result.push({
      ...item,
      rank: result.length + 1,
      evidence: evidenceOf(item),
    })
  }
  return result
}
