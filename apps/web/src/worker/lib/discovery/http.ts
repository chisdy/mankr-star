import { assertPublicHttpUrl } from "../url-ssrf"
import {
  SourceFetchError,
  type DiscoveryRequestKind,
  type SourceFetchContext,
} from "./types"

export const DISCOVERY_HTTP_MAX_BYTES = 1024 * 1024
export const DISCOVERY_HTTP_TIMEOUT_MS = 8000

const inFlight = new WeakMap<SourceFetchContext, number>()

function retryAt(response: Response, now: Date): string {
  const retry = response.headers.get("retry-after")
  if (retry) {
    const seconds = Number(retry)
    const date = Number.isFinite(seconds)
      ? now.getTime() + Math.max(1, seconds) * 1000
      : Date.parse(retry)
    if (Number.isFinite(date))
      return new Date(Math.max(date, now.getTime() + 1000)).toISOString()
  }
  const reset = Number(response.headers.get("x-ratelimit-reset"))
  if (reset > 0)
    return new Date(Math.max(reset * 1000, now.getTime() + 1000)).toISOString()
  return new Date(now.getTime() + 10 * 60 * 1000).toISOString()
}

export async function fetchDiscoveryResponse<T>(
  input: string,
  kind: DiscoveryRequestKind,
  allowedHosts: readonly string[],
  context: SourceFetchContext,
  read: (response: Response) => Promise<T>,
  headers?: HeadersInit
): Promise<T> {
  if ((inFlight.get(context) ?? 0) >= 3)
    throw new SourceFetchError("CONCURRENCY_LIMIT", true)
  inFlight.set(context, (inFlight.get(context) ?? 0) + 1)
  const controller = new AbortController()
  let requestAccountingError: unknown
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new SourceFetchError("SOURCE_TIMEOUT", true))
    }, DISCOVERY_HTTP_TIMEOUT_MS)
  })
  const work = async (): Promise<T> => {
    let url = input
    for (let redirects = 0; redirects <= 2; redirects++) {
      let checked: URL
      try {
        checked = assertPublicHttpUrl(url)
      } catch {
        throw new SourceFetchError("SOURCE_URL_BLOCKED")
      }
      if (
        checked.protocol !== "https:" ||
        checked.username ||
        checked.password ||
        checked.port ||
        !allowedHosts.includes(checked.hostname.toLowerCase())
      ) {
        throw new SourceFetchError("SOURCE_HOST_NOT_ALLOWED")
      }
      try {
        await context.beforeRequest(kind, checked.href)
      } catch (error) {
        requestAccountingError = error
        throw error
      }
      const response = await (context.fetch ?? fetch)(checked.href, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location")
        await response.body?.cancel()
        if (!location || redirects === 2)
          throw new SourceFetchError("SOURCE_REDIRECT_LIMIT")
        url = new URL(location, checked).href
        continue
      }
      if (
        response.status === 429 ||
        (response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0")
      ) {
        await response.body?.cancel()
        throw new SourceFetchError(
          "SOURCE_RATE_LIMITED",
          true,
          retryAt(response, context.now)
        )
      }
      if (response.status >= 500) {
        await response.body?.cancel()
        throw new SourceFetchError(
          "SOURCE_UNAVAILABLE",
          true,
          retryAt(response, context.now)
        )
      }
      if (!response.ok && response.status !== 304) {
        await response.body?.cancel()
        throw new SourceFetchError(`SOURCE_HTTP_${response.status}`)
      }
      return read(response)
    }
    throw new SourceFetchError("SOURCE_REDIRECT_LIMIT")
  }
  try {
    return await Promise.race([work(), timeout])
  } catch (error) {
    if (error === requestAccountingError) throw error
    if (error instanceof SourceFetchError) throw error
    throw new SourceFetchError(
      controller.signal.aborted ? "SOURCE_TIMEOUT" : "SOURCE_FETCH_FAILED",
      true
    )
  } finally {
    clearTimeout(timer)
    controller.abort()
    inFlight.set(context, Math.max(0, (inFlight.get(context) ?? 1) - 1))
  }
}

export async function readDiscoveryJson(response: Response): Promise<unknown> {
  if (
    Number(response.headers.get("content-length")) > DISCOVERY_HTTP_MAX_BYTES
  ) {
    await response.body?.cancel()
    throw new SourceFetchError("SOURCE_BODY_TOO_LARGE")
  }
  if (!response.body) throw new SourceFetchError("SOURCE_EMPTY_BODY")
  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
  let size = 0
  let text = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > DISCOVERY_HTTP_MAX_BYTES)
        throw new SourceFetchError("SOURCE_BODY_TOO_LARGE")
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new SourceFetchError("SOURCE_INVALID_JSON")
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
