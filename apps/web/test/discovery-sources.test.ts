import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DISCOVERY_CONFIG,
  beijingDay,
  classifyDiscoveryContent,
  enabledDiscoveryFeeds,
} from "../src/worker/lib/discovery/channels"
import {
  fetchGithubRepository,
  fetchGithubSearch,
  githubCandidate,
  githubGrowth,
  githubSearchUrl,
  selectGithubPool,
} from "../src/worker/lib/discovery/github"
import {
  fetchHnCandidateIds,
  fetchHnItem,
  fetchHnStoryIds,
} from "../src/worker/lib/discovery/hacker-news"
import { fetchDiscoveryResponse } from "../src/worker/lib/discovery/http"
import {
  discoveryPlainText,
  normalizeDiscoveryUrl,
} from "../src/worker/lib/discovery/normalize"
import { rankDiscoveryCandidates } from "../src/worker/lib/discovery/ranking"
import {
  fetchRssFeed,
  parseDiscoveryFeed,
  verifyDiscoveryFeedOrder,
} from "../src/worker/lib/discovery/rss"
import {
  SourceFetchError,
  type DiscoveryCandidate,
  type GithubPoolMember,
  type SourceFetchContext,
} from "../src/worker/lib/discovery/types"
import huggingface from "./fixtures/discovery/huggingface-order.json"
import webdev from "./fixtures/discovery/webdev-order.json"
import cloudflare from "./fixtures/discovery/cloudflare-order.json"

const NOW = new Date("2026-10-08T01:00:00.000Z")
const beforeRequest = () => vi.fn(async () => undefined)
function context(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): SourceFetchContext {
  return {
    now: NOW,
    beforeRequest: beforeRequest(),
    fetch: vi.fn(async (input, init) =>
      handler(String(input), init)
    ) as typeof fetch,
  }
}
function repo(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    full_name: `org/repo-${id}`,
    html_url: `https://github.com/org/repo-${id}`,
    stargazers_count: 100,
    private: false,
    archived: false,
    fork: false,
    created_at: "2026-01-01T00:00:00Z",
    description: "An AI agent CLI",
    ...overrides,
  }
}
function candidate(
  id: number,
  source: "github" | "hn" | "rss" = "github"
): DiscoveryCandidate {
  const item = githubCandidate(
    repo(id),
    "ai",
    { now: NOW, beforeRequest: beforeRequest() },
    id
  )!
  if (source === "github") return item
  return {
    ...item,
    source,
    sourceId: source,
    externalId: String(id),
    githubRepoId: null,
    url: `https://example.org/article-${id}`,
    canonicalUrl: `https://example.org/article-${id}`,
    bookmarkSourceType: "url",
    publishedAt: "2026-10-07T01:00:00Z",
    evidence: {
      source,
      sourceId: source,
      url: `https://example.org/article-${id}`,
      observedAt: NOW.toISOString(),
      publishedAt: "2026-10-07T01:00:00Z",
      ...(source === "hn" ? { score: 90, comments: 10, position: id } : {}),
    },
  }
}
const escapeXml = (value: string) =>
  value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/"/gu, "&quot;")
function rss(
  entries: Array<{
    title?: string
    url?: string
    date?: string
    id?: string
    summary?: string
  }>
) {
  return `<rss version="2.0"><channel><title>Feed</title>${entries.map((item, index) => `<item><title>${escapeXml(item.title ?? "LLM inference update")}</title><link>${escapeXml(item.url ?? `https://huggingface.co/blog/${index}`)}</link><guid>${escapeXml(item.id ?? String(index))}</guid>${item.date ? `<pubDate>${escapeXml(item.date)}</pubDate>` : ""}<description><![CDATA[${item.summary ?? "An AI agent release"}]]></description></item>`).join("")}</channel></rss>`
}

afterEach(() => vi.useRealTimers())

describe("discovery fixed rules and identity", () => {
  it("has exactly four stable channels and only fully verified feeds", () => {
    expect(DISCOVERY_CONFIG.channels.map((item) => item.id)).toEqual([
      "ai",
      "frontend",
      "backend",
      "tools",
    ])
    expect(enabledDiscoveryFeeds()).toHaveLength(3)
    expect(beijingDay(new Date("2026-10-07T16:00:00Z"))).toBe("2026-10-08")
  })
  it("classifies explicit terms and avoids short-substring matches", () => {
    expect(
      classifyDiscoveryContent("LLM inference", null, "https://example.org")
    ).toEqual(["ai"])
    expect(
      classifyDiscoveryContent("Golang database", null, "https://example.org")
    ).toEqual(["backend"])
    expect(
      classifyDiscoveryContent("Cargo goes faster", null, "https://example.org")
    ).toEqual([])
    expect(
      classifyDiscoveryContent(
        "Reactivate the window",
        null,
        "https://example.org"
      )
    ).toEqual([])
    expect(
      classifyDiscoveryContent(
        "React CSS browser UI",
        null,
        "https://example.org"
      )
    ).toEqual(["frontend"])
    expect(
      classifyDiscoveryContent(
        "LLM database CLI frontend",
        null,
        "https://example.org"
      )
    ).toHaveLength(2)
  })
  it("rejects recruiting and marketing while allowing technical platform releases", () => {
    expect(
      classifyDiscoveryContent(
        "Hiring React developers",
        null,
        "https://web.dev/posts/jobs"
      )
    ).toEqual([])
    expect(
      classifyDiscoveryContent(
        "New AI inference application platform",
        null,
        "https://huggingface.co/blog/new"
      )
    ).toEqual(["ai"])
  })

  it("uses the pinned exclusion and technical patterns rather than new deployment rules", () => {
    const pinned = structuredClone(DISCOVERY_CONFIG)
    pinned.classification.excludedTitlePattern = "never-match-this-title"
    expect(
      classifyDiscoveryContent(
        "Hiring LLM engineers",
        null,
        "https://example.org",
        pinned
      )
    ).toEqual(["ai"])
    expect(
      classifyDiscoveryContent(
        "Hiring LLM engineers",
        null,
        "https://example.org"
      )
    ).toEqual([])
  })
  it("uses a discovery-only GitHub identity and preserves meaningful article queries", () => {
    expect(
      normalizeDiscoveryUrl(
        "https://github.com/OWNER/Repo.git/issues/3?utm_source=hn"
      )
    ).toEqual({
      canonicalUrl: "https://github.com/owner/repo",
      bookmarkSourceType: "github",
    })
    expect(
      normalizeDiscoveryUrl("https://example.org/a/?id=7&utm_source=hn#section")
        ?.canonicalUrl
    ).toBe("https://example.org/a?id=7")
    expect(normalizeDiscoveryUrl("javascript:alert(1)")).toBeNull()
    expect(normalizeDiscoveryUrl("https://user:secret@example.org/")).toBeNull()
    expect(
      discoveryPlainText("<script>evil()</script><p>AI &amp; CLI &#x1f600;</p>")
    ).toBe("AI & CLI 😀")
    expect(discoveryPlainText(`a${String.fromCharCode(0, 1, 127)}b`)).toBe("ab")
  })
  it("allows exactly 2048 URL characters and refuses input or canonical expansion beyond the limit", () => {
    const url = "https://example.org/".padEnd(2048, "a")
    expect(normalizeDiscoveryUrl(url)?.canonicalUrl).toBe(url)
    expect(normalizeDiscoveryUrl(`${url}b`)).toBeNull()
    expect(
      normalizeDiscoveryUrl(`https://example.org/${"中".repeat(250)}`)
    ).toBeNull()
    expect(
      normalizeDiscoveryUrl(
        `https://example.org/${String.fromCharCode(0xd800)}`
      )
    ).toBeNull()
  })
  it("removes lone surrogate units and keeps valid non-BMP text intact at excerpt boundaries", () => {
    const lone = String.fromCharCode(0xd800, 0xdc01, 0xdfff, 0xd800)
    // The first two units form a valid pair; the final low/high units are lone.
    expect(discoveryPlainText(`a${lone}b`)).toBe(`a${lone.slice(0, 2)}b`)
    expect(discoveryPlainText(`${"a".repeat(1998)}😀`)).toBe(
      `${"a".repeat(1998)}😀`
    )
    expect(discoveryPlainText(`${"a".repeat(1999)}😀`)).toBe("a".repeat(1999))
    expect(discoveryPlainText(`${"a".repeat(31999)}😀`, 32000)).toBe(
      "a".repeat(31999)
    )
    expect(discoveryPlainText(String.fromCharCode(0xd800))).toBeNull()
  })
})

describe("bounded safe source HTTP", () => {
  it("counts manual redirects and checks the destination whitelist before fetching", async () => {
    const ctx = context((url) =>
      url.endsWith("/first")
        ? new Response(null, { status: 302, headers: { location: "/second" } })
        : new Response("ok")
    )
    await expect(
      fetchDiscoveryResponse(
        "https://example.org/first",
        "rss",
        ["example.org"],
        ctx,
        (response) => response.text()
      )
    ).resolves.toBe("ok")
    expect(ctx.beforeRequest).toHaveBeenCalledTimes(2)
    expect(ctx.fetch).toHaveBeenCalledWith(
      "https://example.org/first",
      expect.objectContaining({ redirect: "manual" })
    )
    const blocked = context(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/private" },
        })
    )
    await expect(
      fetchDiscoveryResponse(
        "https://example.org/first",
        "rss",
        ["example.org"],
        blocked,
        (response) => response.text()
      )
    ).rejects.toMatchObject({ errorCode: "SOURCE_URL_BLOCKED" })
    expect(blocked.beforeRequest).toHaveBeenCalledTimes(1)
  })
  it("limits redirects to two and counts every attempt", async () => {
    const ctx = context(
      () => new Response(null, { status: 302, headers: { location: "/again" } })
    )
    await expect(
      fetchDiscoveryResponse(
        "https://example.org/",
        "rss",
        ["example.org"],
        ctx,
        (response) => response.text()
      )
    ).rejects.toMatchObject({ errorCode: "SOURCE_REDIRECT_LIMIT" })
    expect(ctx.beforeRequest).toHaveBeenCalledTimes(3)
  })
  it("preserves scheduler accounting failures before making an outbound request", async () => {
    const budgetError = Object.assign(new Error("daily request budget"), {
      code: "DAILY_REQUEST_LIMIT",
    })
    const ctx = context(() => Response.json([]))
    ctx.beforeRequest = vi.fn(async () => {
      throw budgetError
    })
    await expect(fetchHnStoryIds("topstories", ctx)).rejects.toBe(budgetError)
    expect(ctx.fetch).not.toHaveBeenCalled()
    expect(ctx.beforeRequest).toHaveBeenCalledTimes(1)
  })
  it("fetches a single HN list so the scheduler can checkpoint a one request slice", async () => {
    const ctx = context(() => Response.json([1, 2, 3]))
    await expect(fetchHnStoryIds("beststories", ctx)).resolves.toEqual([
      1, 2, 3,
    ])
    expect(ctx.beforeRequest).toHaveBeenCalledTimes(1)
    expect(ctx.fetch).toHaveBeenCalledWith(
      "https://hacker-news.firebaseio.com/v0/beststories.json",
      expect.anything()
    )
  })
  it("bounds a valid oversized HN list checkpoint to its first 40 distinct IDs", async () => {
    const ctx = context(() =>
      Response.json([
        1,
        1,
        ...Array.from({ length: 50_000 }, (_, index) => index + 2),
      ])
    )
    await expect(fetchHnStoryIds("topstories", ctx)).resolves.toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1)
    )
    expect(ctx.beforeRequest).toHaveBeenCalledTimes(1)
  })
  it("preserves retry headers without retrying inside the adapter", async () => {
    const ctx = context(
      () =>
        new Response(null, { status: 429, headers: { "Retry-After": "120" } })
    )
    await expect(fetchHnCandidateIds(ctx)).rejects.toMatchObject({
      errorCode: "SOURCE_RATE_LIMITED",
      retryable: true,
      retryAt: "2026-10-08T01:02:00.000Z",
    })
    expect(ctx.beforeRequest).toHaveBeenCalledTimes(2)
  })
  it("stops an unresponsive source at the eight second deadline", async () => {
    vi.useFakeTimers()
    const ctx = context(() => new Promise<Response>(() => undefined))
    const request = fetchGithubSearch(DISCOVERY_CONFIG, "ai", 0, ctx)
    const assertion = expect(request).rejects.toMatchObject({
      errorCode: "SOURCE_TIMEOUT",
      retryable: true,
    })
    await vi.advanceTimersByTimeAsync(8000)
    await assertion
  })
  it("rejects overflow and invalid upstream JSON", async () => {
    const overflow = context(
      () =>
        new Response("{}", {
          headers: { "content-length": String(1024 * 1024 + 1) },
        })
    )
    await expect(
      fetchGithubSearch(DISCOVERY_CONFIG, "ai", 0, overflow)
    ).rejects.toMatchObject({ errorCode: "SOURCE_BODY_TOO_LARGE" })
    await expect(
      fetchGithubSearch(
        DISCOVERY_CONFIG,
        "ai",
        0,
        context(() => new Response("bad"))
      )
    ).rejects.toMatchObject({ errorCode: "SOURCE_INVALID_JSON" })
  })
})

describe("GitHub pool and honest growth", () => {
  it("rejects illegal or mismatched full names without truncating a legal repository title", () => {
    const ctx = { now: NOW, beforeRequest: beforeRequest() }
    const fullName = `${"O".repeat(39)}/${"Repo".padEnd(100, "R")}`
    const valid = githubCandidate(
      repo(7, {
        full_name: fullName,
        html_url: `https://github.com/${fullName.toLowerCase()}`,
      }),
      "ai",
      ctx
    )
    expect(valid?.title).toBe(fullName)
    for (const full_name of [
      `${"o".repeat(40)}/repo`,
      `owner/${"r".repeat(101)}`,
      "org/other",
      "org/repo/extra",
      "org/repo<script>",
    ]) {
      expect(githubCandidate(repo(7, { full_name }), "ai", ctx)).toBeNull()
    }
    expect(
      normalizeDiscoveryUrl(`https://github.com/${"o".repeat(40)}/repo`)
    ).toBeNull()
    expect(
      normalizeDiscoveryUrl(`https://github.com/org/${"r".repeat(101)}`)
    ).toBeNull()
  })
  it("makes one bounded public topic query and rejects incomplete search", async () => {
    const query = new URL(githubSearchUrl(DISCOVERY_CONFIG, "ai", 1, NOW))
    expect(query.searchParams.get("q")).toContain(
      "topic:llm is:public archived:false fork:false"
    )
    expect(query.searchParams.get("sort")).toBe("updated")
    expect(query.searchParams.get("per_page")).toBe("25")
    const ctx = context(() =>
      Response.json({
        items: Array.from({ length: 30 }, (_, i) => repo(i + 1)),
      })
    )
    expect(
      await fetchGithubSearch(DISCOVERY_CONFIG, "ai", 0, ctx)
    ).toHaveLength(25)
    expect(ctx.beforeRequest).toHaveBeenCalledTimes(1)
    await expect(
      fetchGithubSearch(
        DISCOVERY_CONFIG,
        "ai",
        0,
        context(() => Response.json({ incomplete_results: true, items: [] }))
      )
    ).rejects.toMatchObject({ errorCode: "GITHUB_INCOMPLETE_SEARCH" })
  })
  it("skips private/archived/fork repositories and retains numeric identity after rename", async () => {
    for (const flag of ["private", "archived", "fork"])
      expect(
        githubCandidate(repo(7, { [flag]: true }), "ai", {
          now: NOW,
          beforeRequest: beforeRequest(),
        })
      ).toBeNull()
    const ctx = context(() =>
      Response.json(
        repo(7, {
          full_name: "new-owner/new-name",
          html_url: "https://github.com/new-owner/new-name",
        })
      )
    )
    const item = await fetchGithubRepository(7, ctx, "token", "tools")
    expect(item?.githubRepoId).toBe(7)
    expect(item?.channels).toEqual(["tools"])
    expect(ctx.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repositories/7",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      })
    )
    await expect(
      fetchGithubRepository(
        7,
        context(() => Response.json(repo(8)))
      )
    ).rejects.toMatchObject({ errorCode: "GITHUB_ID_MISMATCH" })
    await expect(
      fetchGithubRepository(
        7,
        context(() => new Response(null, { status: 404 }))
      )
    ).resolves.toBeNull()
  })
  it("keeps ten new and ten retained, fills missing quota and expires channel search hits", () => {
    const previous: GithubPoolMember[] = Array.from({ length: 20 }, (_, i) => ({
      githubRepoId: i + 1,
      joinedDay: "2026-10-01",
      lastSearchHitDay: "2026-10-01",
      kind: "retained",
    }))
    const found = Array.from({ length: 15 }, (_, i) => candidate(i + 21))
    const selected = selectGithubPool(previous, found, "2026-10-08")
    expect(selected.filter((member) => member.kind === "new")).toHaveLength(10)
    expect(
      selected.filter((member) => member.kind === "retained")
    ).toHaveLength(10)
    expect(
      selectGithubPool(previous, found, "2026-10-09").every(
        (member) => member.githubRepoId > 20
      )
    ).toBe(true)
    expect(selectGithubPool([], found, "2026-10-08")).toHaveLength(15)
    const onlyOneHit = selectGithubPool(previous, [candidate(1)], "2026-10-09")
    expect(onlyOneHit).toEqual([
      { ...previous[0], lastSearchHitDay: "2026-10-09", kind: "retained" },
    ])
    expect(previous[0]?.lastSearchHitDay).toBe("2026-10-01")
  })
  it("distinguishes missing, zero and negative growth and checks yesterday plus sample gap", () => {
    const current = { stars: 100, observedAt: NOW.toISOString() }
    const prev = { stars: 100, observedAt: "2026-10-07T01:00:00Z" }
    expect(githubGrowth(current, null, "2026-10-08").growth).toBeNull()
    expect(githubGrowth(current, prev, "2026-10-08").growth).toBe(0)
    expect(
      githubGrowth(current, { ...prev, stars: 120 }, "2026-10-08").growth
    ).toBe(-20)
    expect(
      githubGrowth(
        current,
        { ...prev, observedAt: "2026-10-07T08:00:00Z" },
        "2026-10-08"
      ).growth
    ).toBeNull()
    expect(
      githubGrowth(
        current,
        { ...prev, observedAt: "2026-10-06T12:00:00Z" },
        "2026-10-08"
      ).growth
    ).toBeNull()
  })
})

describe("HN shared candidates", () => {
  it("retains a 2048-character URL without truncation and skips an oversized URL", async () => {
    const url = "https://example.org/".padEnd(2048, "a")
    const base = {
      id: 7,
      type: "story",
      title: "LLM inference",
      time: NOW.getTime() / 1000,
    }
    const item = await fetchHnItem(
      7,
      0,
      context(() => Response.json({ ...base, url }))
    )
    expect(item?.url).toBe(url)
    expect(item?.evidence.url.length).toBeLessThanOrEqual(2048)
    await expect(
      fetchHnItem(
        7,
        0,
        context(() => Response.json({ ...base, url: `${url}b` }))
      )
    ).resolves.toBeNull()
  })
  it("merges native lists once and caps candidate details at forty", async () => {
    const ctx = context((url) =>
      Response.json(
        url.includes("topstories")
          ? Array.from({ length: 35 }, (_, i) => i + 1)
          : [35, 36, 37, 38, 39, 40, 41]
      )
    )
    const ids = await fetchHnCandidateIds(ctx)
    expect(ids).toHaveLength(40)
    expect(new Set(ids).size).toBe(40)
    expect(ctx.beforeRequest).toHaveBeenCalledTimes(2)
  })
  it("handles Ask/Show without an external link and preserves only native HN metrics", async () => {
    const ctx = context(() =>
      Response.json({
        id: 7,
        type: "story",
        title: "Ask HN: LLM inference",
        time: NOW.getTime() / 1000 - 3600,
        score: 80,
        descendants: 12,
      })
    )
    const item = await fetchHnItem(7, 0, ctx)
    expect(item?.url).toBe("https://news.ycombinator.com/item?id=7")
    expect(item?.evidence).toMatchObject({
      source: "hn",
      score: 80,
      comments: 12,
      position: 0,
    })
    expect(item?.evidence.stars).toBeUndefined()
  })
  it("skips dead, deleted, old, future, non-story and irrelevant entries", async () => {
    const base = {
      id: 7,
      type: "story",
      title: "LLM inference",
      time: NOW.getTime() / 1000 - 3600,
      score: 1,
    }
    for (const change of [
      { dead: true },
      { deleted: true },
      { type: "comment" },
      { time: NOW.getTime() / 1000 - 8 * 86400 },
      { time: NOW.getTime() / 1000 + 600 },
      { title: "Cargo goes home" },
    ]) {
      expect(
        await fetchHnItem(
          7,
          0,
          context(() => Response.json({ ...base, ...change }))
        )
      ).toBeNull()
    }
    expect(
      await fetchHnItem(
        7,
        0,
        context(() => Response.json(null))
      )
    ).toBeNull()
  })
})

describe("RSS streaming, order verification and cache semantics", () => {
  it("keeps the full 2048-character URL identity and skips an oversized article URL", async () => {
    const url = "https://huggingface.co/blog/".padEnd(2048, "a")
    const result = await fetchRssFeed(
      DISCOVERY_CONFIG.feeds[0]!,
      context(
        () =>
          new Response(
            rss([
              { url, date: NOW.toISOString() },
              { url: `${url}b`, date: NOW.toISOString() },
            ])
          )
      )
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.url).toBe(url)
    expect(result.candidates[0]?.evidence.url).toBe(url)
  })
  it("hashes full long GUIDs with a common 500-character prefix into distinct stable source identities", async () => {
    const prefix = "g".repeat(500)
    const xml = rss([
      { id: `${prefix}a`, date: NOW.toISOString() },
      { id: `${prefix}b`, date: NOW.toISOString() },
    ])
    const fetchSample = () =>
      fetchRssFeed(
        DISCOVERY_CONFIG.feeds[0]!,
        context(() => new Response(xml))
      )
    const first = await fetchSample()
    const second = await fetchSample()
    const ids = first.candidates.map((candidate) => candidate.externalId)
    expect(new Set(ids).size).toBe(2)
    expect(
      ids.every((id) => /^huggingface:hash:sha256:[0-9a-f]{64}$/u.test(id))
    ).toBe(true)
    expect(second.candidates.map((candidate) => candidate.externalId)).toEqual(
      ids
    )
    const fullBoundary = await fetchRssFeed(
      DISCOVERY_CONFIG.feeds[0]!,
      context(
        () =>
          new Response(
            rss([{ id: "g".repeat(32000), date: NOW.toISOString() }])
          )
      )
    )
    expect(fullBoundary.candidates[0]?.externalId).toMatch(
      /^huggingface:hash:sha256:[0-9a-f]{64}$/u
    )
    await expect(
      parseDiscoveryFeed(
        new Response(rss([{ id: "g".repeat(32001), date: NOW.toISOString() }]))
      )
    ).rejects.toMatchObject({ errorCode: "RSS_ID_TOO_LONG" })
  })
  it("keeps short digest-looking IDs disjoint from long-ID hashes and accepts legacy cached IDs on304", async () => {
    const feed = DISCOVERY_CONFIG.feeds[0]!
    const longId = "g".repeat(501)
    const long = await fetchRssFeed(
      feed,
      context(
        () => new Response(rss([{ id: longId, date: NOW.toISOString() }]))
      )
    )
    const digestId = long.candidates[0]!.externalId.slice(
      "huggingface:hash:".length
    )
    const both = await fetchRssFeed(
      feed,
      context(
        () =>
          new Response(
            rss([
              { id: longId, date: NOW.toISOString() },
              { id: digestId, date: NOW.toISOString() },
            ])
          )
      )
    )
    expect(both.candidates.map((entry) => entry.externalId)).toEqual([
      `huggingface:hash:${digestId}`,
      `huggingface:raw:${digestId}`,
    ])
    const old = {
      ...long,
      candidates: [
        { ...long.candidates[0]!, externalId: `huggingface:${digestId}` },
      ],
    }
    const unchanged = await fetchRssFeed(
      feed,
      context(() => new Response(null, { status: 304 })),
      old
    )
    expect(unchanged.candidates[0]?.externalId).toBe(`huggingface:${digestId}`)
    expect(old.candidates[0]?.externalId).toBe(`huggingface:${digestId}`)
  })
  it("discards oversized conditional headers instead of growing the stored feed cursor", async () => {
    const feed = DISCOVERY_CONFIG.feeds[0]!
    const xml = rss([{ date: NOW.toISOString() }])
    const result = await fetchRssFeed(
      feed,
      context(
        () =>
          new Response(xml, {
            headers: {
              etag: "e".repeat(1025),
              "last-modified": "m".repeat(129),
            },
          })
      )
    )
    expect(result.etag).toBeNull()
    expect(result.lastModified).toBeNull()
    expect(result.candidates).toHaveLength(1)
  })
  it("rejects control characters in upstream and cached feed condition headers", async () => {
    const feed = DISCOVERY_CONFIG.feeds[0]!
    const result = await fetchRssFeed(
      feed,
      context(
        () =>
          new Response(rss([{ date: NOW.toISOString() }]), {
            headers: {
              etag: '"upstream\tvalue"',
              "last-modified": "Thu,\t08 Oct 2026 00:00:00 GMT",
            },
          })
      )
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.etag).toBeNull()
    expect(result.lastModified).toBeNull()

    const unchanged = await fetchRssFeed(
      feed,
      context((_url, init) => {
        const headers = new Headers(init?.headers)
        expect(headers.has("if-none-match")).toBe(false)
        expect(headers.has("if-modified-since")).toBe(false)
        return new Response(null, { status: 304 })
      }),
      { ...result, etag: '"cached\u0001value"', lastModified: "cached\rvalue" }
    )
    expect(unchanged.candidates).toEqual(result.candidates)
    expect(unchanged.etag).toBeNull()
    expect(unchanged.lastModified).toBeNull()
  })
  it("validates complete source snapshots, not only a first-thirty prefix", async () => {
    for (const fixture of [huggingface, webdev, cloudflare]) {
      expect(fixture.newestFirst).toBe(true)
      expect(fixture.entries).toHaveLength(fixture.entryCount)
      const xml = rss(
        fixture.entries.map((entry) => ({
          id: entry.id ?? undefined,
          url: entry.url,
          date: entry.date,
        }))
      )
      const result = await verifyDiscoveryFeedOrder(new Response(xml))
      expect(result.complete).toBe(true)
      expect(result.entries).toHaveLength(fixture.entryCount)
      const feed = DISCOVERY_CONFIG.feeds.find(
        (item) => item.id === fixture.sourceId
      )!
      expect(feed.newestFirstVerified).toBe(true)
      expect(feed.verifiedAt).not.toBeNull()
    }
    const oldPrefix = Array.from({ length: 30 }, () => ({
      date: "Mon, 01 Jun 2026 00:00:00 GMT",
    }))
    await expect(
      verifyDiscoveryFeedOrder(
        new Response(
          rss([...oldPrefix, { date: "Wed, 07 Oct 2026 00:00:00 GMT" }])
        )
      )
    ).rejects.toMatchObject({ errorCode: "RSS_ORDER_CHANGED" })
  })
  it("stops after thirty parsed entries and cancels the reader before malformed later history", async () => {
    const entries = Array.from({ length: 31 }, (_, i) => ({
      date: new Date(NOW.getTime() - i * 60000).toUTCString(),
    }))
    const xml = rss(entries).replace(/<\/channel><\/rss>$/u, "<broken")
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(xml))
      },
      cancel: cancelled,
    })
    const parsed = await parseDiscoveryFeed(new Response(stream))
    expect(parsed.entries).toHaveLength(30)
    expect(parsed.complete).toBe(false)
    expect(cancelled).toHaveBeenCalledOnce()
  })
  it("supports namespaced Atom alternate links, dates and plain-text nested summaries", async () => {
    const atom =
      '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>unique</id><title>CSS browser update</title><link rel="self" href="https://web.dev/feed-entry"/><link rel="alternate" href="https://web.dev/posts/css"/><published>2026-10-07T00:00:00Z</published><summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">New <b>CSS</b> API</div></summary></entry></feed>'
    const result = await parseDiscoveryFeed(new Response(atom))
    expect(result.entries[0]).toMatchObject({
      id: "unique",
      url: "https://web.dev/posts/css",
      summary: "New CSS API",
      publishedAt: "2026-10-07T00:00:00.000Z",
    })
  })
  it("rejects DTD, malformed XML, oversize bodies and runtime order reversals", async () => {
    for (const xml of [
      '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel/></rss>',
      "<rss><channel><item></channel></rss>",
    ]) {
      await expect(
        parseDiscoveryFeed(new Response(xml))
      ).rejects.toBeInstanceOf(SourceFetchError)
    }
    await expect(
      parseDiscoveryFeed(
        new Response("<rss/>", {
          headers: { "content-length": String(1024 * 1024 + 1) },
        })
      )
    ).rejects.toMatchObject({ errorCode: "SOURCE_BODY_TOO_LARGE" })
    await expect(
      parseDiscoveryFeed(
        new Response(
          rss([
            { date: "Tue, 06 Oct 2026 00:00:00 GMT" },
            { date: "Wed, 07 Oct 2026 00:00:00 GMT" },
          ])
        )
      )
    ).rejects.toMatchObject({ errorCode: "RSS_ORDER_CHANGED" })
  })
  it("keeps original observation times on 304 and passes conditional request headers", async () => {
    const feed = DISCOVERY_CONFIG.feeds[0]!
    const old = {
      candidates: [candidate(3, "rss")],
      etag: '"v1"',
      lastModified: "Wed, 07 Oct 2026 00:00:00 GMT",
      notModified: false,
    }
    old.candidates[0]!.observedAt = "2026-10-07T01:00:00Z"
    const ctx = context(() => new Response(null, { status: 304 }))
    const result = await fetchRssFeed(feed, ctx, old)
    expect(result.candidates[0]?.observedAt).toBe("2026-10-07T01:00:00Z")
    expect(result.notModified).toBe(true)
    expect(ctx.fetch).toHaveBeenCalledWith(
      feed.url,
      expect.objectContaining({
        headers: expect.objectContaining({
          "If-None-Match": '"v1"',
          "If-Modified-Since": old.lastModified,
        }),
      })
    )
    await expect(
      fetchRssFeed(
        feed,
        context(() => new Response(null, { status: 304 }))
      )
    ).rejects.toMatchObject({ errorCode: "RSS_304_WITHOUT_BASELINE" })
  })

  it("does not renew an expired article by receiving a 304", async () => {
    const feed = DISCOVERY_CONFIG.feeds[0]!
    const expired = candidate(3, "rss")
    expired.publishedAt = "2026-09-30T00:00:00Z"
    const previous = {
      candidates: [expired],
      etag: '"v1"',
      lastModified: null,
      notModified: false,
    }
    const result = await fetchRssFeed(
      feed,
      context(() => new Response(null, { status: 304 })),
      previous
    )
    expect(result.candidates).toEqual([])
    expect(previous.candidates).toHaveLength(1)
    expect(previous.candidates[0]?.publishedAt).toBe("2026-09-30T00:00:00Z")
  })
  it("returns a successful empty result for old/missing/future dates and refuses unverified feeds", async () => {
    const feed = DISCOVERY_CONFIG.feeds[0]!
    const result = await fetchRssFeed(
      feed,
      context(
        () =>
          new Response(
            rss([
              { date: "Thu, 08 Oct 2026 02:00:00 GMT" },
              { date: "Thu, 01 Jan 2026 00:00:00 GMT" },
              {},
            ])
          )
      )
    )
    expect(result.candidates).toEqual([])
    expect(result.notModified).toBe(false)
    await expect(
      fetchRssFeed(
        { ...feed, newestFirstVerified: false },
        context(() => new Response(""))
      )
    ).rejects.toMatchObject({ errorCode: "RSS_ORDER_UNVERIFIED" })
  })
  it("scopes RSS IDs by feed and exposes updates without invented scores", async () => {
    const feed = DISCOVERY_CONFIG.feeds[0]!
    const result = await fetchRssFeed(
      feed,
      context(
        () =>
          new Response(
            rss([
              {
                date: "Wed, 07 Oct 2026 00:00:00 GMT",
                summary: "<p>LLM &amp; RAG</p>",
              },
            ])
          )
      )
    )
    expect(result.candidates[0]?.externalId).toBe("huggingface:raw:0")
    expect(result.candidates[0]?.summary).toBe("LLM & RAG")
    expect(result.candidates[0]?.evidence.score).toBeUndefined()
    expect(result.candidates[0]?.evidence.stars).toBeUndefined()
  })

  it("uses technical evidence as well as the feed domain", async () => {
    const feed = DISCOVERY_CONFIG.feeds[0]!
    const result = await fetchRssFeed(
      feed,
      context(
        () =>
          new Response(
            rss([
              {
                title: "Our summer team retreat",
                summary: "Photos from the beach",
                date: "Wed, 07 Oct 2026 00:00:00 GMT",
              },
              {
                title: "The application platform launch",
                summary: "New integrations for developers",
                date: "Wed, 07 Oct 2026 00:00:00 GMT",
              },
            ])
          )
      )
    )
    expect(result.candidates.map((item) => item.title)).toEqual([
      "The application platform launch",
    ])
  })
})

describe("source-local ranking and weighted mixed list", () => {
  it("interleaves twenty entries at 12 GitHub / 6 HN / 2 RSS without mixing metric units", () => {
    const items = [
      ...Array.from({ length: 20 }, (_, i) => candidate(i + 1)),
      ...Array.from({ length: 10 }, (_, i) => candidate(i + 30, "hn")),
      ...Array.from({ length: 10 }, (_, i) => candidate(i + 50, "rss")),
    ]
    const result = rankDiscoveryCandidates(items, "ai")
    expect(result).toHaveLength(20)
    expect(result.filter((item) => item.source === "github")).toHaveLength(12)
    expect(result.filter((item) => item.source === "hn")).toHaveLength(6)
    expect(result.filter((item) => item.source === "rss")).toHaveLength(2)
    expect(result.map((item) => item.rank)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    )
  })
  it("deduplicates cross-source articles and keeps both kinds of evidence", () => {
    const gh = candidate(1)
    const hn = {
      ...candidate(2, "hn"),
      canonicalUrl: gh.canonicalUrl,
      url: gh.url,
    }
    const result = rankDiscoveryCandidates([hn, gh], "ai")
    expect(result).toHaveLength(1)
    expect(result[0]?.githubRepoId).toBe(1)
    expect(result[0]?.evidence.map((entry) => entry.source)).toEqual([
      "hn",
      "github",
    ])
  })
  it("does not merge two known different GitHub IDs and fills source shortages", () => {
    const first = candidate(1)
    const second = {
      ...candidate(2),
      canonicalUrl: first.canonicalUrl,
      url: first.url,
    }
    expect(rankDiscoveryCandidates([first, second], "ai")).toHaveLength(2)
    expect(
      rankDiscoveryCandidates(
        Array.from({ length: 25 }, (_, i) => candidate(i + 1, "hn")),
        "ai"
      )
    ).toHaveLength(20)
    expect(rankDiscoveryCandidates([first], "frontend")).toEqual([])
  })
  it("uses measured growth and reserves new-discovery visibility", () => {
    const mature = Array.from({ length: 10 }, (_, i) => {
      const item = candidate(i + 1)
      item.evidence.growth = 100 - i
      return item
    })
    const fresh = candidate(20)
    const ranked = rankDiscoveryCandidates([...mature, fresh], "ai", 8)
    expect(ranked[0]?.githubRepoId).toBe(1)
    expect(ranked.some((item) => item.githubRepoId === 20)).toBe(true)
    mature[0]!.evidence.growth = -5
    expect(rankDiscoveryCandidates(mature, "ai")[0]?.githubRepoId).toBe(2)
    expect(
      rankDiscoveryCandidates(mature, "ai").at(-1)?.evidence[0]?.growth
    ).toBe(-5)
  })

  it("publishes using the pinned source interleave policy", () => {
    const pinned = structuredClone(DISCOVERY_CONFIG)
    pinned.ranking.cycle = ["hn", "rss", "github"]
    const result = rankDiscoveryCandidates(
      [candidate(1), candidate(2, "hn"), candidate(3, "rss")],
      "ai",
      20,
      pinned
    )
    expect(result.map((item) => item.source)).toEqual(["hn", "rss", "github"])
  })
})
