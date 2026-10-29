/** 弹窗状态条上的来源名。 */
export function sourceLabel(sourceType: string): string {
  if (sourceType === "github") return "GitHub"
  if (sourceType === "twitter") return "X"
  if (sourceType === "wechat") return "微信公众号"
  return "网页"
}

/** 已匹配收藏时弹窗状态条文案。 */
export function savedStatusText(match: {
  source_type: string
  archived: boolean
}): string {
  const label = sourceLabel(match.source_type)
  return match.archived ? `已收藏 · ${label} · 已归档` : `已收藏 · ${label}`
}
