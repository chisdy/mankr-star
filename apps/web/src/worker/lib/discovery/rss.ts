import { parser as createSaxParser } from "sax"
import {
  DISCOVERY_CONFIG,
  classifyDiscoveryContent,
  isTechnicalDiscoveryRss,
} from "./channels"
import { DISCOVERY_HTTP_MAX_BYTES, fetchDiscoveryResponse } from "./http"
import { discoveryPlainText, normalizeDiscoveryUrl } from "./normalize"
import {
  SourceFetchError,
  type DiscoveryCandidate,
  type DiscoveryConfig,
  type DiscoveryFeedConfig,
  type SourceFetchContext,
} from "./types"

export interface ParsedFeedEntry {
  id: string | null
  title: string
  url: string
  summary: string | null
  publishedAt: string | null
}

export interface RssFetchResult {
  candidates: DiscoveryCandidate[]
  etag: string | null
  lastModified: string | null
  notModified: boolean
}

class FeedLimitReached extends Error {}

function conditionHeader(
  value: string | null,
  maxLength: number
): string | null {
  return value && value.length <= maxLength && !/\p{Cc}/u.test(value)
    ? value
    : null
}

async function feedExternalId(feedId: string, id: string): Promise<string> {
  // Raw IDs and digests have disjoint representations, even if an upstream ID
  // itself looks exactly like a digest. Old cached candidate IDs remain readable.
  if (id.length <= 500) return `${feedId}:raw:${id}`
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(id)
  )
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `${feedId}:hash:sha256:${hash}`
}

function trustedDate(value: string | undefined): string | null {
  if (
    !value ||
    !(
      /\d{4}-\d{2}-\d{2}/u.test(value) ||
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/iu.test(value)
    )
  )
    return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

/** SAX events consume bounded stream chunks; no DOM and no external entity resolver. */
export async function parseDiscoveryFeed(
  response: Response,
  options: {
    entryLimit?: number
    requireNewestFirst?: boolean
    maxBytes?: number
  } = {}
): Promise<{
  entries: ParsedFeedEntry[]
  bytesRead: number
  complete: boolean
}> {
  const maxBytes = Math.min(
    DISCOVERY_HTTP_MAX_BYTES,
    options.maxBytes ?? DISCOVERY_HTTP_MAX_BYTES
  )
  const entryLimit = Math.max(1, options.entryLimit ?? 30)
  if (!response.body) throw new SourceFetchError("RSS_EMPTY_BODY")
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel()
    throw new SourceFetchError("SOURCE_BODY_TOO_LARGE")
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
  // @types/sax omits this documented option; the runtime supports it.
  const saxOptions = { strictEntities: true, position: false, trim: false }
  const parser = createSaxParser(true, saxOptions)
  const stack: string[] = []
  const entries: ParsedFeedEntry[] = []
  let fields: Record<string, string> | null = null
  let entryDepth = 0
  let bytesRead = 0
  let lastDate: number | null = null
  let sawFeed = false
  const localName = (name: string) => name.toLowerCase().split(":").at(-1)!
  const fail = () => {
    throw new SourceFetchError("RSS_INVALID_XML")
  }
  parser.onerror = fail
  parser.ondoctype = () => {
    throw new SourceFetchError("RSS_DTD_FORBIDDEN")
  }
  parser.onsgmldeclaration = () => {
    throw new SourceFetchError("RSS_DTD_FORBIDDEN")
  }
  parser.onopentag = (tag) => {
    const name = localName(tag.name)
    stack.push(name)
    if (stack.length === 1) {
      if (name !== "rss" && name !== "feed") fail()
      sawFeed = true
    }
    if (
      (name === "item" && stack.join("/") === "rss/channel/item") ||
      (name === "entry" && stack.join("/") === "feed/entry")
    ) {
      fields = {}
      entryDepth = stack.length
    } else if (fields && stack.length === entryDepth + 1 && name === "link") {
      const attributes = tag.attributes as Record<string, string>
      if (
        attributes.href &&
        (!attributes.rel || attributes.rel === "alternate")
      )
        fields.link = attributes.href
    }
  }
  const collect = (text: string) => {
    if (!fields || stack.length <= entryDepth) return
    const field = stack[entryDepth]!
    if (
      [
        "title",
        "link",
        "guid",
        "id",
        "description",
        "summary",
        "content",
        "encoded",
        "pubdate",
        "published",
        "updated",
        "date",
      ].includes(field)
    ) {
      const value = (fields[field] ?? "") + text
      if ((field === "guid" || field === "id") && value.length > 32_000)
        throw new SourceFetchError("RSS_ID_TOO_LONG")
      fields[field] = value.slice(0, 32_000)
    }
  }
  parser.ontext = collect
  parser.oncdata = collect
  parser.onclosetag = () => {
    if (fields && stack.length === entryDepth) {
      const publishedAt = trustedDate(
        fields.pubdate ?? fields.published ?? fields.date ?? fields.updated
      )
      const timestamp = publishedAt ? Date.parse(publishedAt) : null
      if (
        options.requireNewestFirst !== false &&
        timestamp !== null &&
        lastDate !== null &&
        timestamp > lastDate
      ) {
        throw new SourceFetchError("RSS_ORDER_CHANGED")
      }
      if (timestamp !== null) lastDate = timestamp
      const link =
        fields.link?.trim() ||
        (/^https?:\/\//iu.test(fields.guid ?? "") ? fields.guid!.trim() : "")
      const id = (fields.guid ?? fields.id)?.trim() || null
      if (id && /[\uD800-\uDFFF]/u.test(id))
        throw new SourceFetchError("RSS_INVALID_ID")
      entries.push({
        id,
        title: discoveryPlainText(fields.title, 500) ?? "",
        url: link,
        summary: discoveryPlainText(
          fields.description ??
            fields.summary ??
            fields.encoded ??
            fields.content
        ),
        publishedAt,
      })
      fields = null
      if (entries.length >= entryLimit) throw new FeedLimitReached()
    }
    stack.pop()
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > maxBytes)
        throw new SourceFetchError("SOURCE_BODY_TOO_LARGE")
      const text = decoder.decode(value, { stream: true })
      // Small writes bound parser buffers and stop promptly at the 30th entry.
      for (let offset = 0; offset < text.length; offset += 4096)
        parser.write(text.slice(offset, offset + 4096))
    }
    parser.write(decoder.decode()).close()
    if (!sawFeed) fail()
    return { entries, bytesRead, complete: true }
  } catch (error) {
    if (error instanceof FeedLimitReached)
      return { entries, bytesRead, complete: false }
    if (error instanceof SourceFetchError) throw error
    throw new SourceFetchError("RSS_INVALID_XML")
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Full-sample verification must complete; a first-30 prefix cannot enable a feed. */
export async function verifyDiscoveryFeedOrder(response: Response) {
  const result = await parseDiscoveryFeed(response, {
    entryLimit: 10_000,
    requireNewestFirst: true,
  })
  if (
    !result.complete ||
    result.entries.length === 0 ||
    result.entries.some(
      (entry) => !entry.publishedAt || !normalizeDiscoveryUrl(entry.url)
    )
  ) {
    throw new SourceFetchError("RSS_VERIFICATION_FAILED")
  }
  return result
}

export async function fetchRssFeed(
  feed: DiscoveryFeedConfig,
  context: SourceFetchContext,
  previous?: RssFetchResult,
  config: DiscoveryConfig = DISCOVERY_CONFIG
): Promise<RssFetchResult> {
  if (!feed.newestFirstVerified || feed.verifiedAt === null)
    throw new SourceFetchError("RSS_ORDER_UNVERIFIED")
  const headers: Record<string, string> = {
    Accept:
      "application/rss+xml, application/atom+xml, application/xml, text/xml",
    "User-Agent": "Mankr-Star-Discovery/1.0",
  }
  const previousEtag = conditionHeader(previous?.etag ?? null, 1024)
  const previousModified = conditionHeader(previous?.lastModified ?? null, 128)
  if (previousEtag) headers["If-None-Match"] = previousEtag
  if (previousModified) headers["If-Modified-Since"] = previousModified
  return fetchDiscoveryResponse(
    feed.url,
    "rss",
    feed.allowedHosts,
    context,
    async (response) => {
      if (response.status === 304) {
        if (!previous) throw new SourceFetchError("RSS_304_WITHOUT_BASELINE")
        // An unchanged feed does not make old posts newly published. Apply today's
        // pinned classification rules and age window without rebasing observation time.
        const candidates = previous.candidates.flatMap((candidate) => {
          if (
            !candidate.publishedAt ||
            !isTechnicalDiscoveryRss(candidate.title, candidate.summary, config)
          )
            return []
          const age = context.now.getTime() - Date.parse(candidate.publishedAt)
          if (
            !Number.isFinite(age) ||
            age < -5 * 60 * 1000 ||
            age > 7 * 86400000
          )
            return []
          const channels = classifyDiscoveryContent(
            candidate.title,
            candidate.summary,
            candidate.canonicalUrl,
            config,
            feed.channels
          )
          return channels.length > 0 ? [{ ...candidate, channels }] : []
        })
        return {
          ...previous,
          candidates,
          notModified: true,
          etag:
            conditionHeader(response.headers.get("etag"), 1024) ?? previousEtag,
          lastModified:
            conditionHeader(response.headers.get("last-modified"), 128) ??
            previousModified,
        }
      }
      const result = await parseDiscoveryFeed(response, {
        entryLimit: Math.min(30, config.budgets.rssEntries),
      })
      const candidates: DiscoveryCandidate[] = []
      for (const entry of result.entries) {
        if (
          !entry.title ||
          !entry.publishedAt ||
          !isTechnicalDiscoveryRss(entry.title, entry.summary, config)
        )
          continue
        const age = context.now.getTime() - Date.parse(entry.publishedAt)
        if (age < -5 * 60 * 1000 || age > 7 * 86400000) continue
        const normalized = normalizeDiscoveryUrl(entry.url)
        if (!normalized) continue
        const channels = classifyDiscoveryContent(
          entry.title,
          entry.summary,
          normalized.canonicalUrl,
          config,
          feed.channels
        )
        if (channels.length === 0) continue
        const observedAt = context.now.toISOString()
        candidates.push({
          externalId: await feedExternalId(
            feed.id,
            entry.id ?? normalized.canonicalUrl
          ),
          source: "rss",
          sourceId: feed.id,
          title: entry.title,
          summary: entry.summary,
          url: normalized.canonicalUrl,
          ...normalized,
          githubRepoId: null,
          channels,
          observedAt,
          publishedAt: entry.publishedAt,
          evidence: {
            source: "rss",
            sourceId: feed.id,
            url: normalized.canonicalUrl,
            observedAt,
            publishedAt: entry.publishedAt,
          },
        })
      }
      return {
        candidates,
        etag: conditionHeader(response.headers.get("etag"), 1024),
        lastModified: conditionHeader(
          response.headers.get("last-modified"),
          128
        ),
        notModified: false,
      }
    },
    headers
  )
}
