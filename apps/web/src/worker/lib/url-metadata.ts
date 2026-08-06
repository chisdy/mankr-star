import { CONTENT_EXCERPT_MAX_CHARS } from "@mankr/shared"
import { assertPublicHttpUrl, UrlFetchError } from "./url-ssrf"

export type UrlPageMetadata = {
  title: string
  description: string | null
  siteName: string | null
  imageUrl: string | null
  faviconUrl: string | null
  contentExcerpt: string | null
  finalUrl: string
  syncOk: boolean
  syncError: string | null
}

const FETCH_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 5
const MAX_BYTES = 1_500_000
const BROWSER_UA =
  "Mozilla/5.0 (compatible; MankrBot/1.0; +https://github.com/mankr-star) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const SKIP_TEXT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "PATH",
  "TEMPLATE",
  "TITLE",
  "NAV",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "FORM",
  "BUTTON",
  "SELECT",
  "OPTION",
  "IFRAME",
])

/** 优先从这些区域抽正文；有主内容时忽略外围噪声 */
const PREFERRED_CONTENT_TAGS = new Set(["MAIN", "ARTICLE"])

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + "…"
}

function absolutize(base: string, href: string | null | undefined): string | null {
  if (!href?.trim()) return null
  try {
    return new URL(href.trim(), base).toString()
  } catch {
    return null
  }
}

function pickMeta(
  map: Map<string, string>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const v = map.get(key.toLowerCase())
    if (v?.trim()) return v.trim()
  }
  return null
}

async function fetchFollowingRedirects(
  startUrl: string,
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
      if (!loc) {
        throw new UrlFetchError("重定向缺少 Location", "FETCH_FAILED")
      }
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
      chunks.push(value.slice(0, Math.max(0, MAX_BYTES - (total - value.byteLength))))
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
  for (const c of chunks) {
    const n = Math.min(c.byteLength, out.byteLength - offset)
    out.set(c.subarray(0, n), offset)
    offset += n
    if (offset >= out.byteLength) break
  }
  return out.buffer
}

type ParsedHtml = {
  title: string | null
  meta: Map<string, string>
  faviconHref: string | null
  excerpt: string
}

async function parseHtml(html: string, _baseUrl: string): Promise<ParsedHtml> {
  const meta = new Map<string, string>()
  let titleText = ""
  let faviconHref: string | null = null
  let bodyExcerpt = ""
  let mainExcerpt = ""
  let skipDepth = 0
  let preferredDepth = 0

  const appendText = (target: "body" | "main", raw: string) => {
    const piece = raw.replace(/\s+/g, " ").trim()
    if (!piece) return
    if (target === "main") {
      if (mainExcerpt.length >= CONTENT_EXCERPT_MAX_CHARS) return
      mainExcerpt +=
        (mainExcerpt && !mainExcerpt.endsWith(" ") ? " " : "") + piece
      if (mainExcerpt.length > CONTENT_EXCERPT_MAX_CHARS) {
        mainExcerpt = mainExcerpt.slice(0, CONTENT_EXCERPT_MAX_CHARS)
      }
      return
    }
    if (preferredDepth > 0) return // 已有主内容区时，外围文本不再写入 body 兜底
    if (bodyExcerpt.length >= CONTENT_EXCERPT_MAX_CHARS) return
    bodyExcerpt += (bodyExcerpt && !bodyExcerpt.endsWith(" ") ? " " : "") + piece
    if (bodyExcerpt.length > CONTENT_EXCERPT_MAX_CHARS) {
      bodyExcerpt = bodyExcerpt.slice(0, CONTENT_EXCERPT_MAX_CHARS)
    }
  }

  const rewriter = new HTMLRewriter()
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
        if (!rel.includes("icon")) return
        if (faviconHref) return
        faviconHref = el.getAttribute("href")
      },
    })
    .on("*", {
      element(el) {
        const tag = el.tagName.toUpperCase()
        if (SKIP_TEXT_TAGS.has(tag)) {
          skipDepth++
          el.onEndTag(() => {
            skipDepth = Math.max(0, skipDepth - 1)
          })
          return
        }
        if (PREFERRED_CONTENT_TAGS.has(tag)) {
          preferredDepth++
          el.onEndTag(() => {
            preferredDepth = Math.max(0, preferredDepth - 1)
          })
        }
      },
      text(t) {
        if (skipDepth > 0) return
        if (preferredDepth > 0) {
          appendText("main", t.text)
        } else {
          appendText("body", t.text)
        }
      },
    })

  const res = new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
  const transformed = rewriter.transform(res)
  await transformed.arrayBuffer()

  const trimmedTitle = titleText.trim()
  // 有 main/article 正文时优先用它（即使较短），避免被 title/外围噪声污染
  const excerptSource = mainExcerpt.trim()
    ? mainExcerpt
    : bodyExcerpt
  return {
    title: trimmedTitle || null,
    meta,
    faviconHref,
    excerpt: truncate(excerptSource, CONTENT_EXCERPT_MAX_CHARS) || "",
  }
}

function fallbackTitleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === "/" ? "" : u.pathname
    return path ? `${u.hostname}${path}` : u.hostname
  } catch {
    return url
  }
}

/**
 * 抓取网页 OG/标题/正文摘录。失败时返回 syncOk=false 的降级元数据（仍可入库）。
 */
export async function fetchUrlPageMetadata(
  inputUrl: string,
): Promise<UrlPageMetadata> {
  const hostnameFallback = (() => {
    try {
      return new URL(inputUrl).hostname
    } catch {
      return "unknown"
    }
  })()

  try {
    assertPublicHttpUrl(inputUrl)
    const { response, finalUrl } = await fetchFollowingRedirects(inputUrl)
    assertPublicHttpUrl(finalUrl)

    if (!response.ok) {
      return {
        title: fallbackTitleFromUrl(finalUrl),
        description: null,
        siteName: new URL(finalUrl).hostname,
        imageUrl: null,
        faviconUrl: absolutize(finalUrl, "/favicon.ico"),
        contentExcerpt: null,
        finalUrl,
        syncOk: false,
        syncError: `HTTP ${response.status}`,
      }
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase()
    const isHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml") ||
      !contentType

    if (!isHtml) {
      const name =
        decodeURIComponent(
          new URL(finalUrl).pathname.split("/").filter(Boolean).pop() || "",
        ) || new URL(finalUrl).hostname
      return {
        title: name,
        description: contentType || null,
        siteName: new URL(finalUrl).hostname,
        imageUrl: null,
        faviconUrl: null,
        contentExcerpt: null,
        finalUrl,
        syncOk: true,
        syncError: null,
      }
    }

    const buf = await readLimitedBody(response)
    const html = new TextDecoder("utf-8").decode(buf)
    const parsed = await parseHtml(html, finalUrl)

    const title =
      pickMeta(parsed.meta, "og:title", "twitter:title") ||
      parsed.title ||
      fallbackTitleFromUrl(finalUrl)

    const description = pickMeta(
      parsed.meta,
      "og:description",
      "twitter:description",
      "description",
    )

    const siteName =
      pickMeta(parsed.meta, "og:site_name") || new URL(finalUrl).hostname

    const imageUrl = absolutize(
      finalUrl,
      pickMeta(parsed.meta, "og:image", "twitter:image", "twitter:image:src"),
    )

    const faviconUrl =
      absolutize(finalUrl, parsed.faviconHref) ||
      absolutize(finalUrl, "/favicon.ico")

    const contentExcerpt = parsed.excerpt
      ? truncate(parsed.excerpt, CONTENT_EXCERPT_MAX_CHARS)
      : null

    return {
      title: truncate(title, 500),
      description: description ? truncate(description, 2000) : null,
      siteName,
      imageUrl,
      faviconUrl,
      contentExcerpt,
      finalUrl,
      syncOk: true,
      syncError: null,
    }
  } catch (e) {
    const message =
      e instanceof UrlFetchError
        ? e.message
        : e instanceof Error
          ? e.message
          : "抓取失败"
    // SSRF 等硬错误向上抛，由路由决定是否 400
    if (e instanceof UrlFetchError && e.code === "SSRF_BLOCKED") throw e
    if (e instanceof UrlFetchError && e.code === "UNSUPPORTED_PROTOCOL") throw e
    if (e instanceof UrlFetchError && e.code === "INVALID_URL") throw e

    return {
      title: hostnameFallback,
      description: null,
      siteName: hostnameFallback === "unknown" ? null : hostnameFallback,
      imageUrl: null,
      faviconUrl: null,
      contentExcerpt: null,
      finalUrl: inputUrl,
      syncOk: false,
      syncError: message.slice(0, 500),
    }
  }
}
