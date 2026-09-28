import { assertPublicHttpUrl, UrlFetchError } from "./url-ssrf"

export type ProbeLinkStatus = "ok" | "dead" | "unknown" | "invalid"

export type ProbeOutcome = {
  linkStatus: ProbeLinkStatus
  httpStatus: number | null
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_HOPS = 5
const PROBE_TIMEOUT_MS = 8_000

/** 404 / 410 视为打不开；403、405、限流和 5xx 无法确认。 */
export function classifyProbeHttpStatus(status: number): ProbeLinkStatus {
  if (status === 404 || status === 410) return "dead"
  if (status === 403 || status === 405 || status === 429) return "unknown"
  if (status >= 500) return "unknown"
  if (status >= 200 && status < 300) return "ok"
  return "unknown"
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === "TimeoutError" || error.name === "AbortError"
}

/**
 * 只看状态，不读正文。每一跳都先 assertPublicHttpUrl，不跟随到内网。
 */
export async function probeBookmarkUrl(rawUrl: string): Promise<ProbeOutcome> {
  let current = rawUrl
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let url: URL
    try {
      url = assertPublicHttpUrl(current)
    } catch (error) {
      if (error instanceof UrlFetchError) {
        return { linkStatus: "invalid", httpStatus: null }
      }
      return { linkStatus: "invalid", httpStatus: null }
    }

    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "User-Agent": "MankrStarBookmarkImport/1.0",
        },
      })
    } catch (error) {
      if (isTimeout(error)) return { linkStatus: "unknown", httpStatus: null }
      return { linkStatus: "dead", httpStatus: null }
    }

    await response.body?.cancel().catch(() => {})

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location")
      if (!location || hop === MAX_HOPS) {
        return { linkStatus: "unknown", httpStatus: response.status }
      }
      try {
        current = new URL(location, url).toString()
      } catch {
        return { linkStatus: "invalid", httpStatus: response.status }
      }
      continue
    }

    return {
      linkStatus: classifyProbeHttpStatus(response.status),
      httpStatus: response.status,
    }
  }

  return { linkStatus: "unknown", httpStatus: null }
}
