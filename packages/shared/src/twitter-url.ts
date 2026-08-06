export type ParsedTwitterStatus = {
  tweetId: string
  /** URL 中的 handle；`/i/web/status/:id` 时为 null */
  handle: string | null
  /** 归一化后的临时 canonical（抓取后应用真实 handle 覆盖） */
  canonicalUrl: string
}

export type ParseTwitterStatusResult =
  | { ok: true; data: ParsedTwitterStatus }
  | {
      ok: false
      code: "INVALID_URL"
      error: string
    }

const X_HOST = /(?:^|\.)(?:x|twitter)\.com$/i
const STATUS_PATH =
  /^(?:\/([A-Za-z0-9_]+))?\/status\/(\d+)\/?(?:\/.*)?$/i
const WEB_STATUS_PATH = /^\/i\/web\/status\/(\d+)\/?(?:\/.*)?$/i
const ARTICLE_PATH = /^\/i\/article\//i

const INVALID_STATUS_MSG =
  "请粘贴 X 帖子链接（需包含 /status/…）"

/**
 * 解析 X status URL。仅支持含 tweet id 的 status 路径；拒绝主页与纯 article。
 * 不依赖 DOM URL（shared 包仅 ES2022 lib）。
 */
export function parseTwitterStatusInput(
  input: string,
): ParseTwitterStatusResult {
  const raw = input.trim()
  if (!raw) {
    return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG }
  }

  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const hashIdx = withProto.indexOf("#")
  const noHash = hashIdx >= 0 ? withProto.slice(0, hashIdx) : withProto

  const m = noHash.match(/^(https?):\/\/([^/?#]+)([^?#]*)/i)
  if (!m) {
    return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG }
  }

  const host = m[2]!.toLowerCase()
  if (!X_HOST.test(host)) {
    return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG }
  }

  let pathname = m[3] || "/"
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1)
  }

  if (ARTICLE_PATH.test(pathname)) {
    return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG }
  }

  const webStatus = pathname.match(WEB_STATUS_PATH)
  if (webStatus?.[1]) {
    const tweetId = webStatus[1]
    return {
      ok: true,
      data: {
        tweetId,
        handle: null,
        canonicalUrl: `https://x.com/i/web/status/${tweetId}`,
      },
    }
  }

  const status = pathname.match(STATUS_PATH)
  if (status?.[2]) {
    const handleRaw = status[1] ?? null
    const tweetId = status[2]
    if (!handleRaw || handleRaw.toLowerCase() === "i") {
      return {
        ok: true,
        data: {
          tweetId,
          handle: null,
          canonicalUrl: `https://x.com/i/web/status/${tweetId}`,
        },
      }
    }
    const handle = handleRaw.replace(/^@/, "")
    return {
      ok: true,
      data: {
        tweetId,
        handle,
        canonicalUrl: `https://x.com/${handle}/status/${tweetId}`,
      },
    }
  }

  return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG }
}

/** 用抓取到的 screen_name 生成最终 canonical_url */
export function twitterCanonicalUrl(
  screenName: string,
  tweetId: string,
): string {
  const handle = screenName.replace(/^@/, "").trim() || "i"
  return `https://x.com/${handle}/status/${tweetId}`
}
