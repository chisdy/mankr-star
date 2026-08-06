/**
 * SSRF 防护：拒绝明显内网 / 本机 / 云 metadata 主机名。
 * 不做 DNS 解析（Workers 边缘残余 DNS 重绑定风险可接受并文档化）。
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")

  if (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host === "metadata.google.internal" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true
  }

  // IPv4 literal
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number)
    if (parts.some((n) => n > 255)) return true
    const [a, b] = parts
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true // CGNAT
  }

  // IPv6 / IPv4-mapped 粗过滤
  if (host.includes(":")) {
    if (
      host === "::1" ||
      host === "[::1]" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80") ||
      host.includes("::ffff:127.") ||
      host.includes("::ffff:10.") ||
      host.includes("::ffff:192.168.")
    ) {
      return true
    }
  }

  return false
}

export function assertPublicHttpUrl(urlString: string): URL {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new UrlFetchError("无效的链接", "INVALID_URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlFetchError("仅支持 http/https 链接", "UNSUPPORTED_PROTOCOL")
  }
  if (isBlockedHostname(url.hostname)) {
    throw new UrlFetchError("不允许访问该主机", "SSRF_BLOCKED")
  }
  return url
}

export class UrlFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_URL"
      | "UNSUPPORTED_PROTOCOL"
      | "SSRF_BLOCKED"
      | "FETCH_FAILED",
  ) {
    super(message)
    this.name = "UrlFetchError"
  }
}
