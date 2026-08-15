import * as React from "react"
import { useInfiniteQuery } from "@tanstack/react-query"

import {
  dedupeById,
  hasNextPage as computeHasNextPage,
} from "@/features/bookmarks/bookmark-pagination"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { EventType, UpdateEvent } from "@/lib/types"

type Options = {
  eventType?: EventType
  bookmarkId?: string
  pageSize: number
}

export type FeedPagesResult = {
  items: UpdateEvent[]
  /** 仅首屏：已有数据后追加不再回到骨架 */
  isLoading: boolean
  isError: boolean
  error: Error | null
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** 已有数据但追加失败：底部提示重试，不把整页换成错误态 */
  loadMoreError: boolean
  fetchNextPage: () => void
}

/**
 * 动态时间线的追加分页。页码走 pageParam 而不进 query key，
 * 因此加载下一页只是往 InfiniteData 追加，不会让列表回到 pending 态重挂载。
 */
export function useFeedPages({
  eventType,
  bookmarkId,
  pageSize,
}: Options): FeedPagesResult {
  const params = React.useMemo(
    () => ({ eventType, bookmarkId, pageSize }),
    [eventType, bookmarkId, pageSize],
  )

  const query = useInfiniteQuery({
    queryKey: queryKeys.feed.infinite(params),
    queryFn: ({ pageParam }) => api.getFeed({ ...params, page: pageParam }),
    initialPageParam: 1,
    // feed 信封字段是 pageSize，不能复用收藏页读 limit 的 nextPageParam
    getNextPageParam: (last) =>
      computeHasNextPage(last.page, last.pageSize, last.total)
        ? last.page + 1
        : undefined,
  })

  const pages = query.data?.pages
  // offset 分页在新事件写入时可能让同一条落在两页里，保留先出现的那条
  const items = React.useMemo(
    () => dedupeById((pages ?? []).flatMap((p) => p.items)),
    [pages],
  )

  const {
    fetchNextPage: fetchMore,
    hasNextPage,
    isFetchingNextPage,
  } = query
  // 追加进行中时不再触发，防止连点并发拉同一页
  const fetchNextPage = React.useCallback(() => {
    if (isFetchingNextPage || !hasNextPage) return
    void fetchMore()
  }, [fetchMore, hasNextPage, isFetchingNextPage])

  return {
    items,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    hasNextPage,
    isFetchingNextPage,
    loadMoreError: query.isError && items.length > 0,
    fetchNextPage,
  }
}
