import {
  canonicalizeUrl,
  type DiscoveryChannelId,
  type DiscoveryItem,
  type DiscoveryResponse,
} from "@mankr/shared"
import type { Bookmark } from "@/lib/types"

/** Mock 收藏和发现共用同一规范化身份；不维护另一份「已收藏」集合。 */
export function discoveryBookmarkIdentity(url: string): string {
  const github = url.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/i
  )
  if (github)
    return `github:${github[1]!.toLowerCase()}/${github[2]!.replace(/\.git$/, "").toLowerCase()}`
  const canonical = canonicalizeUrl(url)
  return canonical.ok ? canonical.canonicalUrl : url
}

const MOCK_CONTENT: Record<
  DiscoveryChannelId,
  {
    repo: string
    summary: string
    article: string
    articleUrl: string
    feedId: string
  }
> = {
  ai: {
    repo: "deepseek-ai/DeepSeek-V3",
    summary: "An open-source Mixture-of-Experts language model.",
    article: "Building practical AI agents",
    articleUrl: "https://huggingface.co/blog/agents",
    feedId: "huggingface",
  },
  frontend: {
    repo: "facebook/react",
    summary: "The library for web and native user interfaces.",
    article: "Modern browser capabilities",
    articleUrl: "https://web.dev/blog/browser-capabilities",
    feedId: "webdev",
  },
  backend: {
    repo: "postgres/postgres",
    summary: "PostgreSQL database server.",
    article: "Building reliable infrastructure",
    articleUrl: "https://blog.cloudflare.com/infrastructure",
    feedId: "cloudflare",
  },
  tools: {
    repo: "cli/cli",
    summary: "GitHub's official command line tool.",
    article: "Developer tools and automation",
    articleUrl: "https://news.ycombinator.com/item?id=42000000",
    feedId: "",
  },
}

export function createMockDiscovery(
  channel: DiscoveryChannelId,
  bookmarks: Bookmark[],
  authenticated: boolean
): DiscoveryResponse {
  const content = MOCK_CONTENT[channel]
  const date = new Date()
  const day = new Date(date.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const observedAt = new Date(`${day}T08:05:00+08:00`).toISOString()
  const previousObservedAt = new Date(
    new Date(observedAt).getTime() - 86_400_000
  ).toISOString()
  const growth = { ai: null, frontend: 0, backend: -2, tools: 34 }[channel]
  const contentItems: DiscoveryItem[] = [
    {
      id: `mock-discovery-${channel}-repo`,
      title: content.repo,
      summary: content.summary,
      url: `https://github.com/${content.repo}`,
      sourceType: "github",
      rank: 1,
      publishedAt: null,
      evidence: [
        {
          source: "github",
          sourceId: channel,
          url: `https://github.com/${content.repo}`,
          observedAt,
          publishedAt: null,
          stars: channel === "frontend" ? 231500 : 64200,
          growth,
          previousObservedAt: growth === null ? null : previousObservedAt,
        },
      ],
    },
    {
      id: `mock-discovery-${channel}-article`,
      title: content.article,
      summary: "A source excerpt for this fixed technical channel.",
      url: content.articleUrl,
      sourceType: "url",
      rank: 2,
      publishedAt: observedAt,
      evidence: [
        {
          source: "hn",
          sourceId: "hn",
          url: "https://news.ycombinator.com/item?id=42000000",
          observedAt,
          publishedAt: observedAt,
          score: 128,
          comments: 42,
        },
        ...(content.feedId
          ? [
              {
                source: "rss" as const,
                sourceId: content.feedId,
                url: content.articleUrl,
                observedAt,
                publishedAt: observedAt,
              },
            ]
          : []),
      ],
    },
  ]
  const items = contentItems.map((item) => {
    if (!authenticated) return item
    const bookmark = bookmarks.find(
      (candidate) =>
        !candidate.deleted_at &&
        discoveryBookmarkIdentity(candidate.canonical_url) ===
          discoveryBookmarkIdentity(item.url)
    )
    return { ...item, savedBookmarkId: bookmark?.id ?? null }
  })
  return {
    enabled: true,
    channel,
    state: "ready",
    items,
    edition: {
      id: `mock-${channel}-${day}`,
      day,
      revision: 1,
      publishedAt: observedAt,
      ruleVersion: "mock-v1",
    },
    sources: [
      {
        source: "github",
        sourceId: channel,
        state: "fresh",
        lastSuccessAt: observedAt,
        errorCode: null,
      },
      {
        source: "hn",
        sourceId: "hn",
        state: "fresh",
        lastSuccessAt: observedAt,
        errorCode: null,
      },
      ...(content.feedId
        ? [
            {
              source: "rss" as const,
              sourceId: content.feedId,
              state: "fresh" as const,
              lastSuccessAt: observedAt,
              errorCode: null,
            },
          ]
        : []),
    ],
    sync: {
      state: "succeeded",
      startedAt: observedAt,
      finishedAt: observedAt,
      errorCode: null,
    },
  }
}
