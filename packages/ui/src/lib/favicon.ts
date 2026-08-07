/** 把站点 URL 解析为其根目录下约定的 favicon 地址；非法 URL 返回 null */
export function getFaviconUrl(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    return new URL("/favicon.ico", value).toString()
  } catch {
    return null
  }
}
