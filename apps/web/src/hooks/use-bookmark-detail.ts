import * as React from "react"
import { useSearchParams } from "react-router"

import {
  readBookmarkDetailParams,
  withBookmarkDetail,
  withoutBookmarkDetail,
} from "@/features/bookmarks/bookmark-detail-params"

/**
 * 详情弹窗的开关与模式都挂在 search params 上，所以任何页面都能原地打开它，
 * 链接也能直接分享。只动 search，不动 pathname —— KB 面板在 /feed、/insights
 * 上同样可用，导航过去会把用户从当前页面弹走。
 *
 * 打开、切换编辑、关闭都用 push：后退键沿「编辑态 → 展示态 → 关闭」原路退回。
 */
export function useBookmarkDetail() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { bookmarkId, editing } = readBookmarkDetailParams(searchParams)

  // 全部走函数式更新，回调才能不依赖当前 searchParams 而保持引用稳定 ——
  // KB 回答里的 citations 数组按这些回调做 memo，换新函数会让来源列表重放动画。
  const openDetail = React.useCallback(
    (id: string) => {
      setSearchParams((prev) => withBookmarkDetail(prev, id))
    },
    [setSearchParams],
  )

  const closeDetail = React.useCallback(() => {
    setSearchParams((prev) => withoutBookmarkDetail(prev))
  }, [setSearchParams])

  const setEditing = React.useCallback(
    (next: boolean, options?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const current = readBookmarkDetailParams(prev)
          if (!current.bookmarkId) return prev
          return withBookmarkDetail(prev, current.bookmarkId, next)
        },
        options?.replace ? { replace: true } : undefined,
      )
    },
    [setSearchParams],
  )

  return { bookmarkId, editing, openDetail, closeDetail, setEditing }
}
