/**
 * 收藏列表查询参数的纯函数：筛选签名比较、list query key 解析。
 * 与分页页码工具分开，避免筛选语义混进 bookmark-pagination。
 */

import type { BookmarksQueryParams } from "@/lib/types"

/**
 * 传统分页 placeholder：仅当筛选签名相同（可翻页）时保留上一页数据。
 * 忽略 page，对其余字段做浅比较——新筛选项会自动纳入，避免手维护 key 列表漏骨架。
 */
export function sameFiltersIgnoringPage(
  a: BookmarksQueryParams,
  b: BookmarksQueryParams,
): boolean {
  const { page: _pa, ...fa } = a
  const { page: _pb, ...fb } = b
  const keys = new Set([
    ...Object.keys(fa),
    ...Object.keys(fb),
  ] as Array<keyof typeof fa>)
  for (const key of keys) {
    if (fa[key] !== fb[key]) return false
  }
  return true
}

/** 从 `queryKeys.bookmarks.list(params)` 的 key 取出 params；形状不符则 undefined */
export function paramsFromBookmarksListKey(
  queryKey: readonly unknown[],
): BookmarksQueryParams | undefined {
  if (queryKey[0] !== "bookmarks" || queryKey[1] !== "list") return undefined
  const params = queryKey[2]
  if (!params || typeof params !== "object") return undefined
  return params as BookmarksQueryParams
}
