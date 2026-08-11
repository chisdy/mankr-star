import * as React from "react"
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query"
import { DEFAULT_FACET_PAGE_SIZE } from "@mankr/shared"

import type { FacetPage, FacetPageParams } from "@/lib/types"

const SEARCH_DEBOUNCE_MS = 250

type Options<T> = {
  /** 由防抖后的搜索词构造 query key；前缀需挂在 tags / bookmarks 下以便统一失效 */
  keyFor: (q: string) => QueryKey
  fetchPage: (params: FacetPageParams) => Promise<FacetPage<T>>
  enabled?: boolean
  pageSize?: number
}

export type FacetInfiniteResult<T> = {
  items: T[]
  isLoading: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** 已有数据但追加失败：展示重试而不是整体报错 */
  loadMoreError: boolean
  fetchNextPage: () => void
  setSearch: (q: string) => void
}

/**
 * facet 下拉的服务端搜索 + 上拉分页。
 * 搜索词防抖后进 query key，改词即从第 1 页重新开始。
 */
export function useFacetInfinite<T extends { name: string }>({
  keyFor,
  fetchPage,
  enabled = true,
  pageSize = DEFAULT_FACET_PAGE_SIZE,
}: Options<T>): FacetInfiniteResult<T> {
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")

  React.useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search),
      SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [search])

  const query = useInfiniteQuery({
    queryKey: keyFor(debouncedSearch),
    queryFn: ({ pageParam }) =>
      fetchPage({ q: debouncedSearch, page: pageParam, pageSize }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total
        ? lastPage.page + 1
        : undefined,
    enabled,
  })

  const pages = query.data?.pages
  // offset 分页在数据变动时可能让同一项落在两页，保留先出现的那条
  const items = React.useMemo(() => {
    const seen = new Set<string>()
    const out: T[] = []
    for (const item of (pages ?? []).flatMap((p) => p.items)) {
      if (seen.has(item.name)) continue
      seen.add(item.name)
      out.push(item)
    }
    return out
  }, [pages])

  const { fetchNextPage: fetchMore, hasNextPage, isFetchingNextPage } = query
  const fetchNextPage = React.useCallback(() => {
    if (isFetchingNextPage || !hasNextPage) return
    void fetchMore()
  }, [fetchMore, hasNextPage, isFetchingNextPage])

  return {
    items,
    isLoading: enabled && query.isPending,
    hasNextPage,
    isFetchingNextPage,
    loadMoreError: query.isError && items.length > 0,
    fetchNextPage,
    setSearch,
  }
}
