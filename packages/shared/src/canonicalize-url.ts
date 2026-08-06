import { TRACKING_QUERY_PARAMS } from "./constants"

export type CanonicalizeUrlResult =
  | { ok: true; canonicalUrl: string; hostname: string; pathname: string }
  | { ok: false; error: string; code: "INVALID_URL" | "UNSUPPORTED_PROTOCOL" }

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase()
  if (lower.startsWith("utm_")) return true
  return (TRACKING_QUERY_PARAMS as readonly string[]).includes(lower)
}

function stripHash(url: string): string {
  const i = url.indexOf("#")
  return i >= 0 ? url.slice(0, i) : url
}

/**
 * 规范化用户输入的网页 URL：补协议、去 hash、剥追踪参数。
 * 不依赖 DOM URL（shared 包仅 ES2022 lib）。
 */
export function canonicalizeUrl(input: string): CanonicalizeUrlResult {
  const raw = input.trim()
  if (!raw) {
    return { ok: false, code: "INVALID_URL", error: "请输入有效链接" }
  }

  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const noHash = stripHash(withProto)

  const m = noHash.match(/^(https?):\/\/([^/?#]+)([^?#]*)?(?:\?([^#]*))?$/i)
  if (!m) {
    return { ok: false, code: "INVALID_URL", error: "无效的链接" }
  }

  const protocol = m[1]!.toLowerCase()
  if (protocol !== "http" && protocol !== "https") {
    return {
      ok: false,
      code: "UNSUPPORTED_PROTOCOL",
      error: "仅支持 http/https 链接",
    }
  }

  let hostname = m[2]!.toLowerCase()
  // 去掉默认端口
  if (hostname.endsWith(":80") && protocol === "http") {
    hostname = hostname.slice(0, -3)
  }
  if (hostname.endsWith(":443") && protocol === "https") {
    hostname = hostname.slice(0, -4)
  }

  let pathname = m[3] && m[3].length > 0 ? m[3] : "/"
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1)
  }

  const queryRaw = m[4] ?? ""
  const kept: string[] = []
  if (queryRaw) {
    for (const part of queryRaw.split("&")) {
      if (!part) continue
      const eq = part.indexOf("=")
      const key = eq >= 0 ? part.slice(0, eq) : part
      try {
        const decodedKey = decodeURIComponent(key.replace(/\+/g, " "))
        if (isTrackingParam(decodedKey)) continue
      } catch {
        if (isTrackingParam(key)) continue
      }
      kept.push(part)
    }
  }

  const search = kept.length > 0 ? `?${kept.join("&")}` : ""
  const canonicalUrl = `${protocol}://${hostname}${pathname}${search}`

  return {
    ok: true,
    canonicalUrl,
    hostname,
    pathname,
  }
}

/** 用于 bookmarks.external_id：hostname + pathname，截断到合理长度 */
export function urlExternalId(
  hostname: string,
  pathname: string,
  maxLen = 240,
): string {
  const path = pathname === "/" ? "" : pathname
  const id = `${hostname}${path}`
  if (id.length <= maxLen) return id
  return id.slice(0, maxLen)
}
