/**
 * 扩展用的收藏匹配。不依赖 chrome，方便单独核对「打开已收藏页面时能对上」。
 * 运行时由 background.ts 调用；匹配规则从共享包打进来，不要在这里手抄一份。
 */
import { canonicalizeUrl } from "../../../packages/shared/src/canonicalize-url.ts"
import { detectSourceType } from "../../../packages/shared/src/detect-source.ts"
import { parseTwitterStatusInput } from "../../../packages/shared/src/twitter-url.ts"
import { parseGithubRepoInput } from "../../web/src/worker/lib/github-url.ts"

export type MatchItem = {
  id: string
  source_type: string
  canonical_url: string
  external_id: string
  archived: boolean
}

let byGithub = new Map<string, MatchItem>()
let byTweet = new Map<string, MatchItem>()
let byUrl = new Map<string, MatchItem>()

export function indexItems(items: MatchItem[]) {
  byGithub = new Map()
  byTweet = new Map()
  byUrl = new Map()
  for (const item of items) {
    if (item.source_type === "github") byGithub.set(item.canonical_url, item)
    else if (item.source_type === "twitter") byTweet.set(item.external_id, item)
    else if (item.source_type === "url" || item.source_type === "wechat") {
      const key = canonicalizeUrl(item.canonical_url)
      if (key.ok) byUrl.set(key.canonicalUrl, item)
    }
  }
}

export function matchUrl(raw: string): MatchItem | null {
  const detected = detectSourceType(raw)
  if (!detected.ok) return null
  if (detected.sourceType === "github") {
    const parsed = parseGithubRepoInput(raw)
    return parsed ? (byGithub.get(parsed.canonicalUrl) ?? null) : null
  }
  if (detected.sourceType === "twitter") {
    const parsed = parseTwitterStatusInput(raw)
    return parsed.ok ? (byTweet.get(parsed.data.tweetId) ?? null) : null
  }
  if (detected.sourceType === "url" || detected.sourceType === "wechat") {
    const canonical = canonicalizeUrl(raw)
    return canonical.ok ? (byUrl.get(canonical.canonicalUrl) ?? null) : null
  }
  return null
}
