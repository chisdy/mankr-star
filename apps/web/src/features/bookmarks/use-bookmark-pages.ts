import * as React from "react"
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query"

import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type {
  Bookmark,
  BookmarkPaginationMode,
  BookmarksQueryParams,
  BookmarksResponse,
} from "@/lib/types"
import {
  clampPage,
  dedupeById,
  hasNextPage as computeHasNextPage,
  nextPageParam,
  totalPageCount,
} from "./bookmark-pagination"

const AI_POLL_INTERVAL_MS = 2000

type BookmarkPages = InfiniteData<BookmarksResponse, number>

function hasPendingAi(items: Bookmark[] | undefined): boolean {
  return Boolean(items?.some((b) => b.ai_status === "pending"))
}

function pendingPageNumbers(pages: BookmarksResponse[] | undefined): number[] {
  return (pages ?? []).filter((p) => hasPendingAi(p.items)).map((p) => p.page)
}

export type BookmarkPagesResult = {
  items: Bookmark[]
  total: number
  isLoading: boolean
  isError: boolean
  error: Error | null
  /** 传统模式下当前页码（已收敛到有效范围） */
  page: number
  pageCount: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
}

type Options = {
  mode: BookmarkPaginationMode
  pageSize: number
  /** 传统分页模式下来自 URL 的页码 */
  page: number
  params: BookmarksQueryParams
  /** 实例设置尚未就绪时先不发请求，避免用默认 pageSize 白拉一轮 */
  enabled?: boolean
}

/**
 * 传统分页走 useQuery，两种追加模式走 useInfiniteQuery。
 * pageSize 与筛选条件都进 query key，改动后从第 1 页重新开始。
 */
export function useBookmarkPages({
  mode,
  pageSize,
  page,
  params,
  enabled = true,
}: Options): BookmarkPagesResult {
  const isInfinite = mode !== "pagination"

  const pagedParams = React.useMemo(
    () => ({ ...params, limit: pageSize, page }),
    [params, pageSize, page],
  )
  const infiniteParams = React.useMemo(
    () => ({ ...params, limit: pageSize }),
    [params, pageSize],
  )
  const infiniteKey = React.useMemo(
    () => queryKeys.bookmarks.infinite(infiniteParams),
    [infiniteParams],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.bookmarks.list(pagedParams),
    queryFn: () => api.getBookmarks(pagedParams),
    enabled: enabled && !isInfinite,
    placeholderData: (prev) => prev,
    // 传统模式一页一查，整页重取的代价是固定的
    refetchInterval: (query) =>
      hasPendingAi(query.state.data?.items) ? AI_POLL_INTERVAL_MS : false,
  })

  const infiniteQuery = useInfiniteQuery({
    queryKey: infiniteKey,
    queryFn: ({ pageParam }) =>
      api.getBookmarks({ ...infiniteParams, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: enabled && isInfinite,
  })

  const infinitePages = infiniteQuery.data?.pages
  usePendingAiRefresh({
    enabled: enabled && isInfinite,
    queryKey: infiniteKey,
    params: infiniteParams,
    pages: infinitePages,
  })

  const infiniteItems = React.useMemo(
    () => dedupeById((infinitePages ?? []).flatMap((p) => p.items)),
    [infinitePages],
  )

  const { fetchNextPage: fetchMore, hasNextPage: canFetchMore } = infiniteQuery
  const isFetchingNextPage = infiniteQuery.isFetchingNextPage
  // 追加请求进行中时不再触发，防止哨兵反复命中导致并发重复拉取
  const fetchNextPage = React.useCallback(() => {
    if (isFetchingNextPage || !canFetchMore) return
    void fetchMore()
  }, [isFetchingNextPage, canFetchMore, fetchMore])

  if (isInfinite) {
    const last = infinitePages?.[infinitePages.length - 1]
    const total = last?.total ?? 0
    return {
      items: infiniteItems,
      total,
      isLoading: !enabled || infiniteQuery.isPending,
      isError: infiniteQuery.isError,
      error: (infiniteQuery.error as Error | null) ?? null,
      page: last?.page ?? 1,
      pageCount: totalPageCount(total, pageSize),
      hasNextPage: canFetchMore,
      isFetchingNextPage,
      fetchNextPage,
    }
  }

  const total = listQuery.data?.total ?? 0
  return {
    items: listQuery.data?.items ?? [],
    total,
    isLoading: !enabled || listQuery.isPending,
    isError: listQuery.isError,
    error: (listQuery.error as Error | null) ?? null,
    page: clampPage(page, pageSize, total),
    pageCount: totalPageCount(total, pageSize),
    hasNextPage: computeHasNextPage(page, pageSize, total),
    isFetchingNextPage: false,
    fetchNextPage: noop,
  }
}

function noop() {}

/**
 * 只刷新真正含 pending AI 的那几页并就地替换。
 *
 * useInfiniteQuery 的 refetchInterval 会串行重取全部已加载页，代价随滚动深度
 * 线性增长；而 AI 结果通常只落在一两页上，按页定向刷新把代价钉在实际待办上。
 */
function usePendingAiRefresh({
  enabled,
  queryKey,
  params,
  pages,
}: {
  enabled: boolean
  queryKey: QueryKey
  params: BookmarksQueryParams
  pages: BookmarksResponse[] | undefined
}) {
  const queryClient = useQueryClient()
  const hasPending = pendingPageNumbers(pages).length > 0

  React.useEffect(() => {
    if (!enabled || !hasPending) return
    let cancelled = false

    const timer = setInterval(async () => {
      // 每次从缓存重新取，避免闭包里的页码过期
      const current = queryClient.getQueryData<BookmarkPages>(queryKey)
      const targets = pendingPageNumbers(current?.pages)
      if (!targets.length) return

      let fresh: BookmarksResponse[]
      try {
        fresh = await Promise.all(
          targets.map((page) => api.getBookmarks({ ...params, page })),
        )
      } catch {
        // 轮询失败不打断已加载内容，下一拍再试
        return
      }
      if (cancelled) return

      const byPage = new Map(fresh.map((p) => [p.page, p]))
      queryClient.setQueryData<BookmarkPages>(queryKey, (prev) =>
        prev
          ? { ...prev, pages: prev.pages.map((p) => byPage.get(p.page) ?? p) }
          : prev,
      )
    }, AI_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, hasPending, queryClient, queryKey, params])
}
