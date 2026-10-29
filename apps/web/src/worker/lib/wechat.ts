import { CONTENT_EXCERPT_MAX_CHARS, isLikelySiteIconUrl } from "@mankr/shared"
import { assertPublicHttpUrl, UrlFetchError } from "./url-ssrf"
import { truncateKeepingBreaks } from "./url-metadata"

export type WechatPlatformMeta = {
  kind: "wechat_article"
  biz: string | null
  mid: string | null
  idx: string | null
  sn: string | null
}

export type WechatArticle = {
  title: string
  description: string | null
  accountName: string | null
  imageUrl: string | null
  faviconUrl: string | null
  contentExcerpt: string | null
  finalUrl: string
  platformMeta: WechatPlatformMeta
  syncOk: boolean
  syncError: string | null
}

const FETCH_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 5
const MAX_BYTES = 1_500_000
/** 短于这个长度的 #js_content 不当作文章正文，避免把验证页提示存进去。 */
const EXCERPT_MIN_CHARS = 40
const BROWSER_UA =
  "Mozilla/5.0 (compatible; MankrBot/1.0; +https://github.com/mankr-star) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const VERIFY_MARKERS = ["环境异常", "请在微信客户端打开"]
const DELETED_MARKERS = [
  "已被发布者删除",
  "因违规无法查看",
  "发送失败无法查看",
  "公众号已注销",
  "账号已被屏蔽",
]

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + "…"
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function wechatPlatformMeta(pageUrl: string): WechatPlatformMeta {
  let biz: string | null = null
  let mid: string | null = null
  let idx: string | null = null
  let sn: string | null = null
  try {
    const url = new URL(pageUrl)
    biz = url.searchParams.get("__biz")
    mid = url.searchParams.get("mid")
    idx = url.searchParams.get("idx")
    sn = url.searchParams.get("sn")
  } catch {
    /* 调用方已规范化；解析失败就留空 */
  }
  return { kind: "wechat_article", biz, mid, idx, sn }
}

function fallbackTitle(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === "/" ? "" : u.pathname
    return path ? `${u.hostname}${path}` : u.hostname
  } catch {
    return url
  }
}

function markerError(text: string): string | null {
  if (VERIFY_MARKERS.some((marker) => text.includes(marker))) {
    return "微信返回验证页"
  }
  if (DELETED_MARKERS.some((marker) => text.includes(marker))) {
    return "文章已删除或不可查看"
  }
  return null
}

function absolutize(
  base: string,
  href: string | null | undefined
): string | null {
  if (!href?.trim()) return null
  try {
    return new URL(href.trim(), base).toString()
  } catch {
    return null
  }
}

type ParsedArticle = {
  ogTitle: string | null
  title: string | null
  description: string | null
  accountName: string | null
  imageHref: string | null
  faviconHref: string | null
  excerpt: string
  pageText: string
}

async function parseArticleHtml(html: string): Promise<ParsedArticle> {
  const meta = new Map<string, string>()
  let titleText = ""
  let faviconHref: string | null = null
  let jsName = ""
  let profileName = ""
  let excerpt = ""
  let pageText = ""
  let skipContent = 0

  const appendPiece = (current: string, piece: string, max: number) => {
    if (current.length >= max) return current
    const next = current
      ? current.endsWith(" ") || current.endsWith("\n")
        ? current + piece
        : `${current} ${piece}`
      : piece
    return next.length > max ? next.slice(0, max) : next
  }

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript", {
      element(el) {
        el.remove()
      },
    })
    .on("title", {
      text(t) {
        titleText += t.text
      },
    })
    .on("meta", {
      element(el) {
        const property = (
          el.getAttribute("property") ||
          el.getAttribute("name") ||
          ""
        ).toLowerCase()
        const content = el.getAttribute("content")
        if (property && content && !meta.has(property)) {
          meta.set(property, content)
        }
      },
    })
    .on("link[rel]", {
      element(el) {
        const rel = (el.getAttribute("rel") || "").toLowerCase()
        if (!rel.includes("icon") || faviconHref) return
        faviconHref = el.getAttribute("href")
      },
    })
    .on("#js_name, #js_author_name", {
      text(t) {
        jsName += t.text
      },
    })
    .on(".profile_nickname", {
      text(t) {
        profileName += t.text
      },
    })
    .on(
      "#js_content p, #js_content section, #js_content h1, #js_content h2, #js_content h3, #js_content h4, #js_content li, #js_content br, #js_content blockquote",
      {
        element(el) {
          const tag = el.tagName.toUpperCase()
          const breakLine = () => {
            if (excerpt && !excerpt.endsWith("\n")) excerpt += "\n"
          }
          if (tag === "BR") breakLine()
          el.onEndTag(breakLine)
        },
      }
    )
    .on("#js_content script, #js_content style", {
      element(el) {
        skipContent++
        el.onEndTag(() => {
          skipContent = Math.max(0, skipContent - 1)
        })
      },
    })
    .on("#js_content", {
      text(t) {
        if (skipContent > 0) return
        const piece = t.text.replace(/[ \t\f\v]+/g, " ").trim()
        if (!piece) return
        excerpt = appendPiece(excerpt, piece, CONTENT_EXCERPT_MAX_CHARS)
      },
    })
    .on("body", {
      text(t) {
        if (pageText.length >= 500) return
        const piece = t.text.replace(/\s+/g, " ").trim()
        if (!piece) return
        pageText = appendPiece(pageText, piece, 500)
      },
    })

  const res = new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
  await rewriter.transform(res).arrayBuffer()

  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = meta.get(key)?.trim()
      if (value) return value
    }
    return null
  }

  const account =
    collapse(jsName) ||
    collapse(profileName) ||
    pick("og:article:author", "author")

  return {
    ogTitle: pick("og:title", "twitter:title"),
    title: collapse(titleText) || null,
    description: pick("og:description", "description"),
    accountName: account || null,
    imageHref: pick("og:image", "twitter:image"),
    faviconHref,
    excerpt: excerpt.trim(),
    pageText: pageText.trim(),
  }
}

/**
 * 从已抓到的 HTML 抽出公众号正文。验证页、删除页和过短正文都不算成功。
 * 正文够长时不再用关键词否决，避免文章引用「环境异常」时被丢掉。
 */
export async function parseWechatArticleHtml(
  html: string,
  pageUrl: string
): Promise<WechatArticle> {
  const parsed = await parseArticleHtml(html)
  const resolvedTitle = truncate(
    parsed.ogTitle || parsed.title || fallbackTitle(pageUrl),
    500
  )
  const excerpt = truncateKeepingBreaks(
    parsed.excerpt,
    CONTENT_EXCERPT_MAX_CHARS
  )
  const longEnough = excerpt.length >= EXCERPT_MIN_CHARS
  const blocked = longEnough
    ? null
    : markerError(`${resolvedTitle}\n${parsed.pageText}`)
  const faviconUrl = absolutize(pageUrl, parsed.faviconHref)
  const imageUrl = absolutize(pageUrl, parsed.imageHref)
  const cover =
    imageUrl && imageUrl !== faviconUrl && !isLikelySiteIconUrl(imageUrl)
      ? imageUrl
      : null

  return {
    title: resolvedTitle,
    description: parsed.description ? truncate(parsed.description, 2000) : null,
    accountName: parsed.accountName ? truncate(parsed.accountName, 200) : null,
    imageUrl: cover,
    faviconUrl,
    contentExcerpt: longEnough ? excerpt : null,
    finalUrl: pageUrl,
    platformMeta: wechatPlatformMeta(pageUrl),
    syncOk: longEnough,
    syncError: longEnough
      ? null
      : blocked || (excerpt ? "正文过短" : "未取得正文"),
  }
}

async function fetchFollowingRedirects(
  startUrl: string
): Promise<{ response: Response; finalUrl: string }> {
  let current = startUrl
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    assertPublicHttpUrl(current)
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const loc = response.headers.get("Location")
      if (!loc) throw new UrlFetchError("重定向缺少 Location", "FETCH_FAILED")
      current = new URL(loc, current).toString()
      continue
    }

    return { response, finalUrl: current }
  }
  throw new UrlFetchError("重定向次数过多", "FETCH_FAILED")
}

async function readLimitedBody(response: Response): Promise<ArrayBuffer> {
  const reader = response.body?.getReader()
  if (!reader) return new ArrayBuffer(0)

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_BYTES) {
      chunks.push(
        value.slice(0, Math.max(0, MAX_BYTES - (total - value.byteLength)))
      )
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
      break
    }
    chunks.push(value)
  }

  const out = new Uint8Array(Math.min(total, MAX_BYTES))
  let offset = 0
  for (const chunk of chunks) {
    const n = Math.min(chunk.byteLength, out.byteLength - offset)
    out.set(chunk.subarray(0, n), offset)
    offset += n
    if (offset >= out.byteLength) break
  }
  return out.buffer
}

function failedArticle(
  finalUrl: string,
  title: string,
  syncError: string
): WechatArticle {
  return {
    title,
    description: null,
    accountName: null,
    imageUrl: null,
    faviconUrl: null,
    contentExcerpt: null,
    finalUrl,
    platformMeta: wechatPlatformMeta(finalUrl),
    syncOk: false,
    syncError,
  }
}

/**
 * 按用户提交的公开链接抓一次。失败时仍返回可入库的元数据，不抛网络错误。
 * SSRF 与非法协议继续向上抛。
 */
export async function fetchWechatArticle(
  inputUrl: string
): Promise<WechatArticle> {
  try {
    assertPublicHttpUrl(inputUrl)
    const { response, finalUrl } = await fetchFollowingRedirects(inputUrl)
    assertPublicHttpUrl(finalUrl)

    if (!response.ok) {
      return failedArticle(
        finalUrl,
        fallbackTitle(finalUrl),
        `HTTP ${response.status}`
      )
    }

    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase()
    const isHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml") ||
      !contentType
    if (!isHtml) {
      return failedArticle(finalUrl, fallbackTitle(finalUrl), "响应不是网页")
    }

    const html = new TextDecoder("utf-8").decode(
      await readLimitedBody(response)
    )
    const parsed = await parseWechatArticleHtml(html, finalUrl)
    return { ...parsed, finalUrl, platformMeta: wechatPlatformMeta(finalUrl) }
  } catch (error) {
    if (error instanceof UrlFetchError && error.code === "SSRF_BLOCKED")
      throw error
    if (
      error instanceof UrlFetchError &&
      error.code === "UNSUPPORTED_PROTOCOL"
    ) {
      throw error
    }
    if (error instanceof UrlFetchError && error.code === "INVALID_URL")
      throw error

    const message =
      error instanceof UrlFetchError
        ? error.message
        : error instanceof Error
          ? error.message
          : "抓取失败"
    return failedArticle(inputUrl, fallbackTitle(inputUrl), message)
  }
}
