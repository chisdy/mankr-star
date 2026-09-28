export const SOURCE_TYPES = ["github", "twitter", "url"] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

/** 本期已实现写库/同步的适配器 */
export const IMPLEMENTED_SOURCE_TYPES = ["github", "twitter", "url"] as const
export type ImplementedSourceType = (typeof IMPLEMENTED_SOURCE_TYPES)[number]

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
  { type: "url", match: /^https?:\/\//i, label: "通用网页" },
]
