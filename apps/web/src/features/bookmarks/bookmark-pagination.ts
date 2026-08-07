/**
 * 收藏列表分页的纯函数：页码解析、边界收敛、跨页去重与分页器窗口。
 * 不依赖 React / 网络，方便单测。
 */

export const BOOKMARK_PAGE_PARAM = "page"

export type PaginationItem = number | "ellipsis"

// 下面几个函数统一采用 (page, pageSize, total) 的入参顺序：
// 三个参数都是 number，顺序不一致时类型系统抓不到写反的调用。

/** URL 上的 ?page=；非正整数一律当作第 1 页 */
export function parsePageParam(raw: string | null | undefined): number {
  if (!raw) return 1
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) return 1
  return value
}

/** 总页数至少为 1，空列表也保留一页用于展示空态 */
export function totalPageCount(total: number, pageSize: number): number {
  if (pageSize < 1) return 1
  return Math.max(1, Math.ceil(Math.max(total, 0) / pageSize))
}

/** 页码越界时收敛到最后一页，避免停在永远没有数据的页 */
export function clampPage(
  page: number,
  pageSize: number,
  total: number,
): number {
  const count = totalPageCount(total, pageSize)
  if (page < 1) return 1
  return Math.min(page, count)
}

export function hasNextPage(
  page: number,
  pageSize: number,
  total: number,
): boolean {
  return page * pageSize < total
}

/** useInfiniteQuery 的 getNextPageParam：到底了返回 undefined */
export function nextPageParam(lastPage: {
  page: number
  limit: number
  total: number
}): number | undefined {
  return hasNextPage(lastPage.page, lastPage.limit, lastPage.total)
    ? lastPage.page + 1
    : undefined
}

/**
 * 跨页拼接后按 id 去重。
 * offset 分页在数据变动时可能让同一条落在两页里，保留先出现的那条。
 */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/**
 * 分页器页码窗口：首尾页固定显示，当前页左右各留 siblings 个，
 * 断开处用 ellipsis 占位。
 */
export function paginationItems(
  current: number,
  pageCount: number,
  siblings = 1,
): PaginationItem[] {
  if (pageCount <= 1) return [1]

  const safeCurrent = Math.min(Math.max(current, 1), pageCount)
  const start = Math.max(2, safeCurrent - siblings)
  const end = Math.min(pageCount - 1, safeCurrent + siblings)

  const items: PaginationItem[] = [1]
  if (start > 2) items.push("ellipsis")
  for (let page = start; page <= end; page += 1) items.push(page)
  if (end < pageCount - 1) items.push("ellipsis")
  items.push(pageCount)
  return items
}
