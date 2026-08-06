import {
  CONTENT_EXCERPT_MAX_CHARS,
  twitterCanonicalUrl,
} from "@mankr/shared"
import { assertPublicHttpUrl, UrlFetchError } from "./url-ssrf"

export type TwitterMediaItem = {
  url: string
  type: "photo" | "video" | "gif" | "unknown"
  preview_url?: string | null
}

export type TwitterPlatformMeta = {
  kind: "tweet" | "note" | "article"
  author_name: string | null
  avatar_url: string | null
  media: TwitterMediaItem[]
  metrics: {
    likes: number
    retweets: number
    replies: number
    views: number
    bookmarks: number
  }
  refs: {
    reply_to: string | null
    quote_id: string | null
  }
  article: {
    title: string | null
    cover_url: string | null
    published_at: string | null
  } | null
}

export type TwitterPageMeta = {
  tweetId: string
  owner: string
  canonicalUrl: string
  title: string
  description: string | null
  language: string | null
  stars: number
  imageUrl: string | null
  faviconUrl: string | null
  siteName: "X"
  homepage: string
  pushedAt: string | null
  contentExcerpt: string | null
  topics: string[]
  platformMeta: TwitterPlatformMeta
  syncOk: boolean
  syncError: string | null
}

const FETCH_TIMEOUT_MS = 8000
const BROWSER_UA =
  "Mozilla/5.0 (compatible; MankrBot/1.0; +https://github.com/mankr-star) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + "…"
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v))
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
    return Math.max(0, Math.floor(Number(v)))
  }
  return 0
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function articlePlainText(article: Record<string, unknown>): string {
  const direct =
    asString(article.plain_text) ||
    asString(article.full_text) ||
    asString(article.text)
  if (direct) return direct

  const content = asRecord(article.content)
  const blocks = content?.blocks
  if (!Array.isArray(blocks)) return ""
  const lines: string[] = []
  for (const block of blocks) {
    const b = asRecord(block)
    const text = asString(b?.text)
    if (text) lines.push(text)
  }
  return lines.join("\n")
}

function extractHashtags(text: string): string[] {
  const tags = new Set<string>()
  for (const m of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    if (m[1]) tags.add(m[1])
  }
  return [...tags].slice(0, 20)
}

function mapMedia(tweet: Record<string, unknown>): TwitterMediaItem[] {
  const mediaObj = asRecord(tweet.media)
  const list: unknown[] = []
  if (Array.isArray(tweet.media)) list.push(...tweet.media)
  if (mediaObj) {
    for (const key of ["photos", "videos", "all", "mosaic"] as const) {
      const arr = mediaObj[key]
      if (Array.isArray(arr)) list.push(...arr)
    }
  }
  const out: TwitterMediaItem[] = []
  for (const item of list) {
    const m = asRecord(item)
    if (!m) continue
    const url =
      asString(m.url) ||
      asString(m.media_url_https) ||
      asString(m.preview_image_url) ||
      asString(m.thumbnail_url)
    if (!url) continue
    const typeRaw = (asString(m.type) || asString(m.media_type) || "unknown").toLowerCase()
    const type: TwitterMediaItem["type"] =
      typeRaw.includes("video")
        ? "video"
        : typeRaw.includes("gif") || typeRaw === "animated_gif"
          ? "gif"
          : typeRaw.includes("photo") || typeRaw.includes("image")
            ? "photo"
            : "unknown"
    out.push({
      url,
      type,
      preview_url:
        asString(m.preview_image_url) ||
        asString(m.thumbnail_url) ||
        (type === "photo" ? url : null),
    })
    if (out.length >= 4) break
  }
  return out
}

function emptyMeta(
  tweetId: string,
  handleHint: string | null,
  syncError: string | null,
): TwitterPageMeta {
  const owner = handleHint?.replace(/^@/, "") || "unknown"
  const canonicalUrl = twitterCanonicalUrl(owner, tweetId)
  return {
    tweetId,
    owner,
    canonicalUrl,
    title: `@${owner} · ${tweetId}`,
    description: null,
    language: null,
    stars: 0,
    imageUrl: null,
    faviconUrl: null,
    siteName: "X",
    homepage: `https://x.com/${owner}`,
    pushedAt: null,
    contentExcerpt: null,
    topics: [],
    platformMeta: {
      kind: "tweet",
      author_name: null,
      avatar_url: null,
      media: [],
      metrics: { likes: 0, retweets: 0, replies: 0, views: 0, bookmarks: 0 },
      refs: { reply_to: null, quote_id: null },
      article: null,
    },
    syncOk: false,
    syncError,
  }
}

async function fetchJson(url: string): Promise<unknown> {
  assertPublicHttpUrl(url)
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new UrlFetchError(`HTTP ${response.status}`, "FETCH_FAILED")
  }
  return response.json()
}

function mapFxTweet(
  tweetId: string,
  handleHint: string | null,
  root: Record<string, unknown>,
): TwitterPageMeta | null {
  const tweet =
    asRecord(root.tweet) ||
    asRecord(root.status) ||
    (asString(root.id) || asString(root.id_str) ? root : null)
  if (!tweet) return null

  const author =
    asRecord(tweet.author) ||
    asRecord(tweet.user) ||
    null
  const screenName =
    asString(author?.screen_name) ||
    asString(author?.username) ||
    handleHint?.replace(/^@/, "") ||
    "unknown"
  const authorName =
    asString(author?.name) ||
    asString(author?.display_name) ||
    null
  const avatar =
    asString(author?.avatar_url) ||
    asString(author?.profile_image_url_https) ||
    asString(author?.profile_image_url) ||
    null

  const article = asRecord(tweet.article)
  const noteText =
    asString(asRecord(tweet.note_tweet)?.text) ||
    asString(tweet.note_tweet)
  const articleBody = article ? articlePlainText(article) : ""
  const articleTitle = article
    ? asString(article.title) || asString(article.preview_text)
    : null
  const baseText =
    asString(tweet.text) ||
    asString(tweet.full_text) ||
    ""

  let kind: TwitterPlatformMeta["kind"] = "tweet"
  let body = baseText
  if (article && (articleTitle || articleBody)) {
    kind = "article"
    body = [articleTitle, articleBody || baseText].filter(Boolean).join("\n\n")
  } else if (noteText && noteText.length > baseText.length) {
    kind = "note"
    body = noteText
  }

  const likes =
    asNumber(tweet.likes) ||
    asNumber(tweet.favorite_count) ||
    asNumber(asRecord(tweet.public_metrics)?.like_count)
  const retweets =
    asNumber(tweet.retweets) ||
    asNumber(tweet.retweet_count) ||
    asNumber(asRecord(tweet.public_metrics)?.retweet_count)
  const replies =
    asNumber(tweet.replies) ||
    asNumber(tweet.reply_count) ||
    asNumber(asRecord(tweet.public_metrics)?.reply_count)
  const views =
    asNumber(tweet.views) ||
    asNumber(tweet.view_count) ||
    asNumber(asRecord(tweet.public_metrics)?.impression_count)
  const bookmarks =
    asNumber(tweet.bookmarks) ||
    asNumber(tweet.bookmark_count) ||
    asNumber(asRecord(tweet.public_metrics)?.bookmark_count)

  const media = mapMedia(tweet)
  const cover =
    article
      ? asString(asRecord(article.cover_media)?.url) ||
        asString(asRecord(asRecord(article.cover_media)?.media_info)?.url) ||
        asString(article.cover_image_url)
      : null
  const imageUrl =
    cover ||
    media[0]?.preview_url ||
    media[0]?.url ||
    null

  const createdAt =
    asString(tweet.created_at) ||
    asString(article?.created_at) ||
    asString(article?.published_at) ||
    null

  const description = truncate(body, 280) || null
  const title =
    kind === "article" && articleTitle
      ? articleTitle
      : truncate(`@${screenName} · ${body || tweetId}`, 200)

  const platformMeta: TwitterPlatformMeta = {
    kind,
    author_name: authorName,
    avatar_url: avatar,
    media,
    metrics: { likes, retweets, replies, views, bookmarks },
    refs: {
      reply_to:
        asString(tweet.replying_to) ||
        asString(tweet.in_reply_to_status_id_str) ||
        null,
      quote_id:
        asString(asRecord(tweet.quote)?.id) ||
        asString(tweet.quoted_status_id_str) ||
        null,
    },
    article:
      kind === "article"
        ? {
            title: articleTitle,
            cover_url: cover,
            published_at:
              asString(article?.published_at) ||
              asString(article?.created_at) ||
              null,
          }
        : null,
  }

  return {
    tweetId,
    owner: screenName,
    canonicalUrl: twitterCanonicalUrl(screenName, tweetId),
    title,
    description,
    language: asString(tweet.lang),
    stars: likes,
    imageUrl,
    faviconUrl: avatar,
    siteName: "X",
    homepage: `https://x.com/${screenName}`,
    pushedAt: createdAt,
    contentExcerpt: body ? truncate(body, CONTENT_EXCERPT_MAX_CHARS) : null,
    topics: extractHashtags(body),
    platformMeta,
    syncOk: true,
    syncError: null,
  }
}

async function fetchViaFx(
  tweetId: string,
  handleHint: string | null,
): Promise<TwitterPageMeta | null> {
  const handle = handleHint?.replace(/^@/, "") || "i"
  const urls = [
    `https://api.fxtwitter.com/${encodeURIComponent(handle)}/status/${tweetId}`,
    `https://api.fxtwitter.com/status/${tweetId}`,
  ]
  let lastError: string | null = null
  for (const url of urls) {
    try {
      const json = await fetchJson(url)
      const root = asRecord(json)
      if (!root) {
        lastError = "Fx 响应无效"
        continue
      }
      const code = asNumber(root.code)
      if (code && code >= 400) {
        lastError = asString(root.message) || `Fx HTTP ${code}`
        continue
      }
      const mapped = mapFxTweet(tweetId, handleHint, root)
      if (mapped) return mapped
      lastError = "Fx 无帖子数据"
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Fx 拉取失败"
    }
  }
  if (lastError) {
    /* fall through */
  }
  return null
}

async function fetchViaOembed(
  tweetId: string,
  handleHint: string | null,
): Promise<TwitterPageMeta | null> {
  const sampleUrl = handleHint
    ? `https://x.com/${handleHint.replace(/^@/, "")}/status/${tweetId}`
    : `https://x.com/i/web/status/${tweetId}`
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(sampleUrl)}&omit_script=true`
  try {
    const json = await fetchJson(oembedUrl)
    const root = asRecord(json)
    if (!root) return null
    const html = asString(root.html) || ""
    const text = stripHtml(html)
    const authorName = asString(root.author_name)
    const authorUrl = asString(root.author_url)
    let owner = handleHint?.replace(/^@/, "") || "unknown"
    if (authorUrl) {
      try {
        const parts = new URL(authorUrl).pathname.split("/").filter(Boolean)
        if (parts[0]) owner = parts[0]
      } catch {
        /* ignore */
      }
    }
    const title = truncate(
      authorName
        ? `${authorName} · ${text || tweetId}`
        : `@${owner} · ${text || tweetId}`,
      200,
    )
    return {
      tweetId,
      owner,
      canonicalUrl: twitterCanonicalUrl(owner, tweetId),
      title,
      description: text ? truncate(text, 280) : null,
      language: null,
      stars: 0,
      imageUrl: null,
      faviconUrl: null,
      siteName: "X",
      homepage: `https://x.com/${owner}`,
      pushedAt: null,
      contentExcerpt: text
        ? truncate(text, CONTENT_EXCERPT_MAX_CHARS)
        : null,
      topics: text ? extractHashtags(text) : [],
      platformMeta: {
        kind: "tweet",
        author_name: authorName,
        avatar_url: null,
        media: [],
        metrics: {
          likes: 0,
          retweets: 0,
          replies: 0,
          views: 0,
          bookmarks: 0,
        },
        refs: { reply_to: null, quote_id: null },
        article: null,
      },
      syncOk: true,
      syncError: null,
    }
  } catch {
    return null
  }
}

/**
 * Fx → oEmbed → stub。永不抛错（除 SSRF 在内部捕获）；stub 仍可入库。
 */
export async function fetchTwitterMetadata(
  tweetId: string,
  handleHint: string | null,
): Promise<TwitterPageMeta> {
  try {
    const fx = await fetchViaFx(tweetId, handleHint)
    if (fx) return fx
  } catch (e) {
    if (e instanceof UrlFetchError && e.code === "SSRF_BLOCKED") {
      return emptyMeta(tweetId, handleHint, e.message)
    }
  }

  try {
    const oem = await fetchViaOembed(tweetId, handleHint)
    if (oem) return oem
  } catch (e) {
    if (e instanceof UrlFetchError && e.code === "SSRF_BLOCKED") {
      return emptyMeta(tweetId, handleHint, e.message)
    }
  }

  return emptyMeta(tweetId, handleHint, "无法获取 X 帖子元数据")
}
