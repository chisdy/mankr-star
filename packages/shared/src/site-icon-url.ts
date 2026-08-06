/**
 * 判断 URL 是否更像站点图标（favicon / logo）而非文章封面。
 * 许多站点会把 logo SVG 写进 og:image，入库后会被误当成封面展示。
 * 不依赖 DOM URL（shared 包仅 ES2022 lib）。
 */
export function isLikelySiteIconUrl(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false

  const noHash = (() => {
    const i = raw.indexOf("#")
    return i >= 0 ? raw.slice(0, i) : raw
  })()
  const noQuery = (() => {
    const i = noHash.indexOf("?")
    return i >= 0 ? noHash.slice(0, i) : noHash
  })()

  // https://host/path → /path；相对路径或无协议时取整段
  const abs = noQuery.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i)
  let pathname = (abs ? abs[1] || "/" : noQuery).toLowerCase()
  if (!pathname.startsWith("/")) {
    // 形如 host/path 或纯文件名
    const slash = pathname.indexOf("/")
    pathname = slash >= 0 ? pathname.slice(slash) : `/${pathname}`
  }

  const filename = pathname.split("/").pop() || ""

  if (!pathname && !filename) return false

  if (filename.endsWith(".ico")) return true

  if (
    pathname.includes("favicon") ||
    pathname.includes("apple-touch-icon") ||
    pathname.includes("apple-icon")
  ) {
    return true
  }

  if (
    /\/(icons?|favicons?|static\/icons?)\//.test(pathname) ||
    /\/(logo[-_]?icon|site[-_]?icon|app[-_]?icon)(\.|$)/.test(pathname)
  ) {
    return true
  }

  if (filename.endsWith(".svg")) {
    if (
      /^(logo|icon|favicon|mark|brand)([-_.]|$)/.test(filename) ||
      /[-_](icon|logo|favicon)\.svg$/.test(filename)
    ) {
      return true
    }
  }

  return false
}
