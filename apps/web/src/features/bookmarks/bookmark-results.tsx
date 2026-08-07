import * as React from "react"
import { useTranslation } from "react-i18next"
import { CaretLeftIcon, CaretRightIcon, CircleNotchIcon } from "@phosphor-icons/react"
import Masonry from "react-masonry-css"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { Bookmark, BookmarkPaginationMode } from "@/lib/types"
import { getAppScrollRoot } from "@/lib/scroll-root"
import { BookmarkCard } from "./bookmark-card"
import { BookmarkRow } from "./bookmark-row"
import { paginationItems } from "./bookmark-pagination"
import { VirtualBookmarkList } from "./virtual-bookmark-list"
import "./bookmark-masonry.css"

export const BOOKMARK_MASONRY_BREAKPOINTS = {
  default: 3,
  1023: 2,
  767: 1,
}

/** 与 bookmark-masonry.css 的 0.875rem 保持一致 */
const GRID_GAP = 14
/** 列表视图的 gap-3 */
const LIST_GAP = 12
const GRID_CARD_ESTIMATE = 260
const LIST_ROW_ESTIMATE = 96
/** 提前一屏触发加载，滚到底之前下一页通常已经就位 */
const AUTO_LOAD_ROOT_MARGIN = "600px"

export type BookmarkResultsProps = {
  mode: BookmarkPaginationMode
  viewMode: "list" | "grid"
  items: Bookmark[]
  page: number
  pageCount: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  /** 追加失败时保留已加载项，只在底部提示可重试 */
  loadMoreError: boolean
  onPageChange: (page: number) => void
  onOpenDetail: (id: string) => void
}

export function BookmarkResults({
  mode,
  viewMode,
  items,
  page,
  pageCount,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  loadMoreError,
  onPageChange,
  onOpenDetail,
}: BookmarkResultsProps) {
  const isGrid = viewMode === "grid"

  const renderItem = React.useCallback(
    (bookmark: Bookmark) =>
      isGrid ? (
        <BookmarkCard
          bookmark={bookmark}
          onClick={() => onOpenDetail(bookmark.id)}
        />
      ) : (
        <BookmarkRow
          bookmark={bookmark}
          onClick={() => onOpenDetail(bookmark.id)}
        />
      ),
    [isGrid, onOpenDetail],
  )

  if (mode === "pagination") {
    return (
      <div className="space-y-4">
        <StaticList items={items} isGrid={isGrid} renderItem={renderItem} />
        <Paginator
          page={page}
          pageCount={pageCount}
          onPageChange={onPageChange}
        />
      </div>
    )
  }

  return (
    <AppendList
      mode={mode}
      items={items}
      isGrid={isGrid}
      renderItem={renderItem}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={fetchNextPage}
      loadMoreError={loadMoreError}
    />
  )
}

/** 传统分页只渲染当前页，直接复用原有瀑布流布局 */
function StaticList({
  items,
  isGrid,
  renderItem,
}: {
  items: Bookmark[]
  isGrid: boolean
  renderItem: (bookmark: Bookmark) => React.ReactNode
}) {
  if (isGrid) {
    return (
      <Masonry
        breakpointCols={BOOKMARK_MASONRY_BREAKPOINTS}
        className="bookmark-masonry"
        columnClassName="bookmark-masonry_column"
      >
        {items.map((bookmark) => (
          <React.Fragment key={bookmark.id}>
            {renderItem(bookmark)}
          </React.Fragment>
        ))}
      </Masonry>
    )
  }

  return (
    <div className="grid min-w-0 w-full gap-3">
      {items.map((bookmark) => (
        <React.Fragment key={bookmark.id}>{renderItem(bookmark)}</React.Fragment>
      ))}
    </div>
  )
}

function AppendList({
  mode,
  items,
  isGrid,
  renderItem,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  loadMoreError,
}: {
  mode: BookmarkPaginationMode
  items: Bookmark[]
  isGrid: boolean
  renderItem: (bookmark: Bookmark) => React.ReactNode
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  loadMoreError: boolean
}) {
  const { t } = useTranslation("bookmarks")
  const containerRef = React.useRef<HTMLDivElement>(null)
  const sentinelRef = React.useRef<HTMLDivElement>(null)
  const scrollElement = useAppScrollRoot()
  const columns = useColumnCount(containerRef, isGrid)

  const shouldAutoLoad =
    mode === "auto" && hasNextPage && !isFetchingNextPage && !loadMoreError

  React.useEffect(() => {
    if (!shouldAutoLoad) return
    const sentinel = sentinelRef.current
    if (!sentinel || !scrollElement) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fetchNextPage()
      },
      { root: scrollElement, rootMargin: AUTO_LOAD_ROOT_MARGIN },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [shouldAutoLoad, scrollElement, fetchNextPage])

  return (
    <div ref={containerRef} className="min-w-0">
      <VirtualBookmarkList
        items={items}
        columns={isGrid ? columns : 1}
        gap={isGrid ? GRID_GAP : LIST_GAP}
        estimateSize={isGrid ? GRID_CARD_ESTIMATE : LIST_ROW_ESTIMATE}
        scrollElement={scrollElement}
        renderItem={renderItem}
      />

      <div ref={sentinelRef} aria-hidden className="h-px w-full" />

      <div
        className="flex min-h-9 items-center justify-center pt-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {loadMoreError ? (
          <div className="flex items-center gap-2">
            <span className="text-destructive">
              {t("pagination.loadMoreError")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={fetchNextPage}
            >
              {t("pagination.retry")}
            </Button>
          </div>
        ) : isFetchingNextPage ? (
          <span className="flex items-center gap-1.5">
            <CircleNotchIcon className="size-3.5 animate-spin" />
            {t("pagination.loadingMore")}
          </span>
        ) : hasNextPage ? (
          mode === "manual" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={fetchNextPage}
            >
              {t("pagination.loadNext")}
            </Button>
          ) : null
        ) : (
          <span>{t("pagination.end")}</span>
        )}
      </div>
    </div>
  )
}

function Paginator({
  page,
  pageCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation("bookmarks")
  if (pageCount <= 1) return null

  const items = paginationItems(page, pageCount)

  return (
    <nav
      aria-label={t("pagination.navAria")}
      className="flex flex-wrap items-center justify-center gap-1.5 pt-2"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1 px-2.5 text-xs"
        disabled={page <= 1}
        aria-label={t("pagination.prev")}
        onClick={() => onPageChange(page - 1)}
      >
        <CaretLeftIcon className="size-3.5" />
        <span className="hidden sm:inline">{t("pagination.prev")}</span>
      </Button>

      {items.map((item, index) =>
        item === "ellipsis" ? (
          <span
            // 省略号本身没有稳定 id，位置即身份
            key={`ellipsis-${index}`}
            aria-hidden
            className="px-1 text-xs text-muted-foreground"
          >
            …
          </span>
        ) : (
          <Button
            key={item}
            type="button"
            variant={item === page ? "default" : "outline"}
            size="sm"
            className={cn("h-8 min-w-8 px-2 text-xs", item === page && "font-semibold")}
            aria-current={item === page ? "page" : undefined}
            aria-label={
              item === page
                ? t("pagination.currentPageAria", { page: item })
                : t("pagination.pageAria", { page: item })
            }
            onClick={() => onPageChange(item)}
          >
            {item}
          </Button>
        ),
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1 px-2.5 text-xs"
        disabled={page >= pageCount}
        aria-label={t("pagination.next")}
        onClick={() => onPageChange(page + 1)}
      >
        <span className="hidden sm:inline">{t("pagination.next")}</span>
        <CaretRightIcon className="size-3.5" />
      </Button>
    </nav>
  )
}

/** 滚动根在 AppShell 里，挂载后才拿得到 */
function useAppScrollRoot(): HTMLElement | null {
  const [element, setElement] = React.useState<HTMLElement | null>(null)
  React.useLayoutEffect(() => {
    setElement(getAppScrollRoot())
  }, [])
  return element
}

/**
 * 按容器宽度而非窗口宽度分列：文件夹树和筛选面板都会挤占结果区，
 * 用窗口断点会在面板展开时把卡片压得过窄。
 */
function useColumnCount(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): number {
  const [columns, setColumns] = React.useState(1)

  React.useLayoutEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const width = container.clientWidth
      setColumns(width >= 1000 ? 3 : width >= 640 ? 2 : 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef, enabled])

  return enabled ? columns : 1
}
