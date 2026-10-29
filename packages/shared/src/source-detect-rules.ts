export const SOURCE_TYPES = ["github", "twitter", "wechat", "url"] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

/** 本期已实现写库/同步的适配器 */
export const IMPLEMENTED_SOURCE_TYPES = [
  "github",
  "twitter",
  "wechat",
  "url",
] as const
export type ImplementedSourceType = (typeof IMPLEMENTED_SOURCE_TYPES)[number]

/** 公众号文章页主机。短链与带参长链都在这个域名上。 */
export const WECHAT_ARTICLE_HOST = /(?:^|\.)mp\.weixin\.qq\.com$/i

/** 识别规则：更具体的 host 须排在通用 url 之前 */
export const SOURCE_DETECT_RULES: Array<{
  type: SourceType
  match: RegExp
  label: string
}> = [
  { type: "github", match: /(?:^|\.)github\.com$/i, label: "GitHub" },
  {
    type: "twitter",
    match: /(?:^|\.)(?:x|twitter)\.com$/i,
    label: "X",
  },
  { type: "wechat", match: WECHAT_ARTICLE_HOST, label: "微信公众号" },
  { type: "url", match: /^https?:\/\//i, label: "通用网页" },
]
