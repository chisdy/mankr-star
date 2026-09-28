import {
  canonicalizeUrl,
  detectSourceType,
  parseTwitterStatusInput,
  urlExternalId,
} from "@mankr/shared"
import { parseGithubRepoInput } from "./github-url"

export type BrowserImportIdentity = {
  sourceType: "url" | "github" | "twitter"
  canonicalUrl: string
  externalId: string
  owner: string | null
}

/**
 * 导入当次不请求 GitHub / X。
 * 能解析成仓库或推文的用对应来源，其余 http(s) 退回普通网页。
 */
export function resolveBrowserImportIdentity(
  rawUrl: string
): BrowserImportIdentity | null {
  const raw = rawUrl.trim()
  if (!/^https?:\/\//i.test(raw)) return null

  const detected = detectSourceType(raw)
  if (detected.ok && detected.sourceType === "github") {
    const repo = parseGithubRepoInput(raw)
    if (repo) {
      return {
        sourceType: "github",
        canonicalUrl: repo.canonicalUrl,
        externalId: repo.externalId,
        owner: repo.owner,
      }
    }
  }

  if (detected.ok && detected.sourceType === "twitter") {
    const tweet = parseTwitterStatusInput(raw)
    if (tweet.ok) {
      return {
        sourceType: "twitter",
        canonicalUrl: tweet.data.canonicalUrl,
        externalId: tweet.data.tweetId,
        owner: tweet.data.handle,
      }
    }
  }

  const canon = canonicalizeUrl(raw)
  if (!canon.ok) return null
  return {
    sourceType: "url",
    canonicalUrl: canon.canonicalUrl,
    externalId: urlExternalId(canon.hostname, canon.pathname),
    owner: null,
  }
}
