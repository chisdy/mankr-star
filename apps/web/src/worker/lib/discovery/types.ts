import type {
  DiscoveryChannelId,
  DiscoveryEvidence,
  DiscoverySource,
} from "@mankr/shared"

export interface DiscoveryCandidate {
  externalId: string
  source: DiscoverySource
  sourceId: string
  title: string
  summary: string | null
  url: string
  canonicalUrl: string
  bookmarkSourceType: "github" | "url"
  githubRepoId: number | null
  channels: DiscoveryChannelId[]
  observedAt: string
  publishedAt: string | null
  evidence: DiscoveryEvidence
}

export type DiscoveryRequestKind =
  | "github-search"
  | "github-detail"
  | "hn-list"
  | "hn-item"
  | "rss"

export interface SourceFetchContext {
  now: Date
  fetch?: typeof fetch
  /** Called before every network attempt, including redirects. Reject to stop. */
  beforeRequest: (kind: DiscoveryRequestKind, url: string) => Promise<void>
}

export interface DiscoveryChannelConfig {
  id: DiscoveryChannelId
  topics: string[]
  keywords: string[]
  domains: string[]
}

export interface DiscoveryFeedConfig {
  id: string
  url: string
  allowedHosts: string[]
  channels: DiscoveryChannelId[]
  newestFirstVerified: boolean
  verifiedAt: string | null
}

export interface DiscoveryConfig {
  ruleVersion: string
  schemaVersion: number
  channels: DiscoveryChannelConfig[]
  feeds: DiscoveryFeedConfig[]
  classification: { excludedTitlePattern: string; rssTechnicalPattern: string }
  ranking: { cycle: DiscoverySource[]; growthSlots: number; newSlots: number }
  github: {
    minStars: number
    activeDays: number
    pageSize: number
    poolPerChannel: number
  }
  budgets: {
    requestsPerRound: number
    requestsPerDay: number
    d1StatementsPerRound: number
    concurrentRequests: number
    githubSearchesPerRound: number
    githubSearchesPerDay: number
    githubDetailsPerDay: number
    hnCandidates: number
    rssEntries: number
    pieceSize: number
    maxItems: number
  }
}

export interface GithubPoolMember {
  githubRepoId: number
  joinedDay: string
  lastSearchHitDay: string
  kind: "new" | "retained"
}

/** Retry scheduling is persisted by the caller, never slept inside the adapter. */
export class SourceFetchError extends Error {
  constructor(
    readonly errorCode: string,
    readonly retryable = false,
    readonly retryAt: string | null = null
  ) {
    super(errorCode)
    this.name = "SourceFetchError"
  }
}
