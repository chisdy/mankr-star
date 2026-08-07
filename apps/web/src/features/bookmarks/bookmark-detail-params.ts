/**
 * 收藏详情弹窗的 URL 状态。放在不依赖 React 的纯函数里，
 * 既方便单测，也让「拼一个能打开弹窗的链接」这件事有唯一出处。
 */

import { BOOKMARK_PAGE_PARAM } from "./bookmark-pagination"

export const BOOKMARK_PARAM = "bookmark"
export const EDIT_PARAM = "edit"
export const TAG_PARAM = "tag"

export interface BookmarkDetailParams {
  bookmarkId: string | null
  editing: boolean
}

export function readBookmarkDetailParams(
  searchParams: URLSearchParams,
): BookmarkDetailParams {
  const bookmarkId = searchParams.get(BOOKMARK_PARAM)?.trim() || null
  return {
    bookmarkId,
    // 没有选中收藏时 edit 无意义，避免残留参数让空弹窗进编辑态
    editing: bookmarkId !== null && searchParams.get(EDIT_PARAM) === "1",
  }
}

export function withBookmarkDetail(
  searchParams: URLSearchParams,
  bookmarkId: string,
  editing = false,
): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  next.set(BOOKMARK_PARAM, bookmarkId)
  if (editing) next.set(EDIT_PARAM, "1")
  else next.delete(EDIT_PARAM)
  return next
}

export function withoutBookmarkDetail(
  searchParams: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  next.delete(BOOKMARK_PARAM)
  next.delete(EDIT_PARAM)
  return next
}

/** 可分享/可被 AI 引用的详情链接。始终落在收藏列表页上。 */
export function bookmarkDetailHref(bookmarkId: string): string {
  return `/?${BOOKMARK_PARAM}=${encodeURIComponent(bookmarkId)}`
}

/**
 * 从详情点标签：关掉弹窗、落到该标签筛选，页码回到第一页。
 * 其它筛选参数保留，方便在现有筛选上叠加。
 */
export function withTagFilter(
  searchParams: URLSearchParams,
  tag: string,
): URLSearchParams {
  const next = withoutBookmarkDetail(searchParams)
  next.set(TAG_PARAM, tag)
  next.delete(BOOKMARK_PAGE_PARAM)
  return next
}

/** 非收藏列表页（如 feed / insights）上点标签时，直接回首页按标签筛 */
export function tagFilterHref(tag: string): string {
  return `/?${TAG_PARAM}=${encodeURIComponent(tag)}`
}
