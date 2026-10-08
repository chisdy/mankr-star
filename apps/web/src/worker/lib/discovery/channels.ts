import type { DiscoveryChannelId } from "@mankr/shared"
import type { DiscoveryConfig } from "./types"

const excludedTitlePattern =
  /\b(?:hiring|job openings?|job listings?|sponsored|sponsorship|webinar|conference tickets?|register now|discount|black friday)\b|招聘|限时优惠|报名参会/iu
    .source
const rssTechnicalPattern =
  /\b(?:ai|llm|models?|agents?|inference|rag|api|developer|developers|software|applications?|platform|browser|web|css|html|javascript|typescript|react|vue|database|databases|postgres|sqlite|serverless|server|servers|network|networks|networking|security|workers|cloud|infrastructure|performance|compiler|cli|terminal|tools|git|editor|automation)\b|大模型|人工智能|前端|数据库|后端|开发工具/iu
    .source

/** This complete JSON-safe object is stored on jobs; resumes never read new rules. */
export const DISCOVERY_CONFIG: DiscoveryConfig = {
  ruleVersion: "2026-10-08.1",
  schemaVersion: 1,
  channels: [
    {
      id: "ai",
      topics: ["llm", "ai-agents"],
      keywords: [
        "llm",
        "large language model",
        "language models",
        "machine learning",
        "deep learning",
        "artificial intelligence",
        "ai agent",
        "ai agents",
        "rag",
        "inference",
        "transformer",
        "chatgpt",
        "hugging face",
        "huggingface",
        "openai",
        "anthropic",
        "diffusion",
        "大模型",
        "人工智能",
      ],
      domains: ["huggingface.co", "openai.com", "anthropic.com"],
    },
    {
      id: "frontend",
      topics: ["react", "vue"],
      keywords: [
        "react",
        "vue",
        "javascript",
        "typescript",
        "css",
        "html",
        "web browser",
        "browser engine",
        "web ui",
        "frontend",
        "front-end",
        "svelte",
        "next.js",
        "nuxt",
        "web components",
        "accessibility",
        "前端",
      ],
      domains: [
        "web.dev",
        "developer.chrome.com",
        "react.dev",
        "vuejs.org",
        "developer.mozilla.org",
      ],
    },
    {
      id: "backend",
      topics: ["database", "cloud-native"],
      keywords: [
        "database",
        "databases",
        "postgres",
        "postgresql",
        "mysql",
        "sqlite",
        "redis",
        "kubernetes",
        "docker",
        "cloud native",
        "cloud-native",
        "observability",
        "backend",
        "back-end",
        "api",
        "distributed",
        "serverless",
        "microservices",
        "golang",
        "go language",
        "go programming",
        "rust",
        "linux",
        "infrastructure",
        "数据库",
        "后端",
      ],
      domains: ["blog.cloudflare.com", "postgresql.org", "kubernetes.io"],
    },
    {
      id: "tools",
      topics: ["developer-tools", "cli"],
      keywords: [
        "cli",
        "command line",
        "command-line",
        "developer tools",
        "developer tool",
        "devtools",
        "editor",
        "ide",
        "vscode",
        "visual studio code",
        "neovim",
        "vim",
        "terminal",
        "debugger",
        "debugging",
        "automation",
        "git",
        "github",
        "package manager",
        "开发工具",
      ],
      domains: ["code.visualstudio.com", "neovim.io"],
    },
  ],
  feeds: [
    // Complete ordered date/link fixtures live in test/fixtures/discovery, not in D1.
    {
      id: "huggingface",
      url: "https://huggingface.co/blog/feed.xml",
      allowedHosts: ["huggingface.co"],
      channels: ["ai"],
      newestFirstVerified: true,
      verifiedAt: "2026-10-08T05:48:23Z",
    },
    {
      id: "webdev",
      url: "https://web.dev/static/blog/feed.xml",
      allowedHosts: ["web.dev"],
      channels: ["frontend"],
      newestFirstVerified: true,
      verifiedAt: "2026-10-08T05:48:24Z",
    },
    {
      id: "cloudflare",
      url: "https://blog.cloudflare.com/rss/",
      allowedHosts: ["blog.cloudflare.com"],
      channels: ["backend"],
      newestFirstVerified: true,
      verifiedAt: "2026-10-08T05:49:17Z",
    },
  ],
  github: { minStars: 20, activeDays: 90, pageSize: 25, poolPerChannel: 20 },
  classification: { excludedTitlePattern, rssTechnicalPattern },
  ranking: {
    cycle: [
      "github",
      "hn",
      "github",
      "github",
      "hn",
      "github",
      "rss",
      "github",
      "hn",
      "github",
    ],
    growthSlots: 4,
    newSlots: 2,
  },
  budgets: {
    requestsPerRound: 25,
    requestsPerDay: 320,
    d1StatementsPerRound: 40,
    concurrentRequests: 3,
    githubSearchesPerRound: 4,
    githubSearchesPerDay: 16,
    githubDetailsPerDay: 80,
    hnCandidates: 40,
    rssEntries: 30,
    pieceSize: 10,
    maxItems: 20,
  },
}

const keywordPatterns = new Map<string, RegExp>()
const filterPatterns = new Map<string, RegExp>()

function filterPattern(pattern: string): RegExp {
  let compiled = filterPatterns.get(pattern)
  if (!compiled) {
    compiled = new RegExp(pattern, "iu")
    filterPatterns.set(pattern, compiled)
  }
  return compiled
}

// Curated feeds establish a channel, while this still rejects company/social news.
export function isTechnicalDiscoveryRss(
  title: string,
  summary: string | null,
  config: DiscoveryConfig = DISCOVERY_CONFIG
): boolean {
  return (
    !filterPattern(config.classification.excludedTitlePattern).test(title) &&
    filterPattern(config.classification.rssTechnicalPattern).test(
      `${title} ${summary ?? ""}`
    )
  )
}

function matchesKeyword(text: string, keyword: string): boolean {
  const term = keyword.toLowerCase()
  if (/[^\p{ASCII}]/u.test(term)) return text.includes(term)
  let pattern = keywordPatterns.get(term)
  if (!pattern) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    pattern = new RegExp(`(?:^|[^a-z0-9_])${escaped}(?=$|[^a-z0-9_])`, "u")
    keywordPatterns.set(term, pattern)
  }
  return pattern.test(text)
}

export function classifyDiscoveryContent(
  title: string,
  summary: string | null,
  url: string,
  config: DiscoveryConfig = DISCOVERY_CONFIG,
  allowedChannels?: readonly DiscoveryChannelId[]
): DiscoveryChannelId[] {
  if (filterPattern(config.classification.excludedTitlePattern).test(title))
    return []
  let hostname = ""
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return []
  }
  const text = `${title} ${summary ?? ""}`.toLowerCase()
  return config.channels
    .filter(
      (channel) => !allowedChannels || allowedChannels.includes(channel.id)
    )
    .map((channel) => ({
      id: channel.id,
      score:
        channel.keywords.reduce(
          (score, keyword) => score + Number(matchesKeyword(text, keyword)),
          0
        ) +
        (channel.domains.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
        )
          ? 2
          : 0),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((match) => match.id)
}

export function beijingDay(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function enabledDiscoveryFeeds(
  config: DiscoveryConfig = DISCOVERY_CONFIG
) {
  return config.feeds
    .filter((feed) => feed.newestFirstVerified && feed.verifiedAt !== null)
    .slice(0, 4)
}
