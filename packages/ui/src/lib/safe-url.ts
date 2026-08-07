/**
 * 仅允许 http(s) 外链，拒绝 javascript: / data: 等危险协议。
 *
 * 组件的 url 常来自模型输出或第三方搜索结果，调用方过滤与否不可控，
 * 所以渲染 href 之前在组件内部再兜一次。ui 包不依赖 app/shared，
 * 这里保持独立实现；app 侧的等价物是 @/lib/safe-url。
 */
export function safeHttpHref(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return parsed.href
  } catch {
    return null
  }
}
