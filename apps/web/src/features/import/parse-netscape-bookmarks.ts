import { canonicalizeUrl } from "@mankr/shared"

export type ParsedNetscapeBookmark = {
  title: string
  url: string
  folderPath: string[]
}

function decodeHtml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, value: string) => {
      const code = Number(value)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ""
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => {
      const code = Number.parseInt(value, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ""
    })
    .replace(/\s+/g, " ")
    .trim()
}

function readHref(attrs: string): string {
  const match = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "")
}

function dedupeKey(url: string): string {
  const canonical = canonicalizeUrl(url)
  return canonical.ok ? canonical.canonicalUrl : url
}

/**
 * 在浏览器里解析 Netscape 书签 HTML。
 * 不保留 ICON 里的 data URI，同一文件里规范化后重复的地址只留第一条。
 */
export function parseNetscapeBookmarks(html: string): ParsedNetscapeBookmark[] {
  const items: ParsedNetscapeBookmark[] = []
  const path: string[] = []
  const seen = new Set<string>()
  const pattern =
    /<DL\b[^>]*>|<\/DL\s*>|<H3\b[^>]*>([\s\S]*?)<\/H3>|<A\b([^>]*)>([\s\S]*?)<\/A>|<HR\b[^>]*>/gi

  let pendingFolder: string | null = null
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    const token = match[0]
    if (/^<H3\b/i.test(token)) {
      pendingFolder = decodeHtml(match[1] ?? "")
      continue
    }
    if (/^<DL\b/i.test(token)) {
      if (pendingFolder) path.push(pendingFolder)
      pendingFolder = null
      continue
    }
    if (/^<\/DL/i.test(token)) {
      path.pop()
      pendingFolder = null
      continue
    }
    if (/^<HR\b/i.test(token)) {
      pendingFolder = null
      continue
    }
    if (!/^<A\b/i.test(token)) continue

    pendingFolder = null
    const href = readHref(match[2] ?? "")
    if (!/^https?:\/\//i.test(href)) continue
    const key = dedupeKey(href)
    if (seen.has(key)) continue
    seen.add(key)
    const title = decodeHtml(match[3] ?? "") || href
    items.push({
      title: title.slice(0, 500),
      url: href,
      folderPath: [...path],
    })
  }

  return items
}
