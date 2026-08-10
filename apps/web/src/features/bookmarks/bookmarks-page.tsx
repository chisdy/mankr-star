import * as React from "react"
import { useReadableSearchParams } from "@/lib/search-params"
import { useTranslation } from "react-i18next"
import {
  PlusIcon,
  StarIcon,
  RowsIcon,
  GridFourIcon,
  XIcon,
} from "@phosphor-icons/react"
import { AI_STATUSES, type AiStatus } from "@mankr/shared"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
  useBookmarkPaginationSettings,
  useRedirectGuestOnUnauthorized,
  useRequireAuthAction,
} from "@/hooks/use-auth"
import { useBookmarkDetail } from "@/hooks/use-bookmark-detail"
import { getAppScrollRoot } from "@/lib/scroll-root"
import { BookmarkRowSkeleton } from "./bookmark-row"
import { BookmarkCardSkeleton } from "./bookmark-card"
import { AddBookmarkDialog } from "./add-bookmark-dialog"
import {
  countPanelFilters,
} from "./filter-panel-body"
import {
  BOOKMARK_PAGE_PARAM,
  clampPage,
  parsePageParam,
} from "./bookmark-pagination"
import {
  BOOKMARK_MASONRY_BREAKPOINTS,
  BookmarkResults,
} from "./bookmark-results"
import { useBookmarkPages } from "./use-bookmark-pages"
import Masonry from "react-masonry-css"
import "./bookmark-masonry.css"

export function BookmarksPage() {
  const { t } = useTranslation(["bookmarks", "common"])
  const [searchParams, setSearchParams] = useReadableSearchParams()
  const requireAuth = useRequireAuthAction()
  const { openDetail } = useBookmarkDetail()

  const [addDialogOpen, setAddDialogOpen] = React.useState(false)

  const [viewMode, setViewMode] = React.useState<"list" | "grid">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mankr_view_mode")
      if (saved === "list" || saved === "grid") return saved
    }
    return "grid"
  })

  const handleViewModeChange = (mode: "list" | "grid") => {
    setViewMode(mode)
    if (typeof window !== "undefined") {
      localStorage.setItem("mankr_view_mode", mode)
    }
  }

  const folderId = searchParams.get("folder_id") || ""
  const tag = searchParams.get("tag") || ""
  const language = searchParams.get("language") || ""
  const owner = searchParams.get("owner") || ""
  const site = searchParams.get("site") || ""
  const sourceType = searchParams.get("source_type") || ""
  const healthStatus = searchParams.get("health_status") || ""
  const sortParam = searchParams.get("sort")
  const sortRaw: "recent" | "updated" | "stars" | "name" =
    sortParam === "stars" ||
    sortParam === "name" ||
    sortParam === "updated"
      ? sortParam
      : "recent"
  // updated 仅 github；stars 允许 github / twitter / 全部
  const sort: "recent" | "updated" | "stars" | "name" =
    sortRaw === "updated" && sourceType !== "github"
      ? "recent"
      : sortRaw === "stars" && sourceType === "url"
        ? "recent"
        : sortRaw
  const q = searchParams.get("q") || ""
  const archived = searchParams.get("archived") === "true"
  const aiStatusParam = searchParams.get("ai_status")
  const aiStatus: AiStatus | undefined = (
    AI_STATUSES as readonly string[]
  ).includes(aiStatusParam || "")
    ? (aiStatusParam as AiStatus)
    : undefined
  const hasAccountParam = searchParams.get("has_account")
  const hasAccount =
    hasAccountParam === "true"
      ? true
      : hasAccountParam === "false"
        ? false
        : undefined

  const isGithubSource = sourceType === "github"
  const isUrlSource = sourceType === "url"
  const isTwitterSource = sourceType === "twitter"
  // 隐藏控件对应的 URL 残留参数不参与查询；全部来源下 owner/site 互斥（并存时保留 owner）
  const effectiveLanguage = isGithubSource ? language || undefined : undefined
  const effectiveHealth = isGithubSource
    ? ((healthStatus || undefined) as
        | "unavailable"
        | "empty"
        | "archived"
        | "stale"
        | "active"
        | "hot"
        | "unknown"
        | undefined)
    : undefined
  const effectiveOwner =
    !isUrlSource && owner ? owner : undefined
  const effectiveSite =
    !isGithubSource &&
    !isTwitterSource &&
    site &&
    !(sourceType === "" && owner)
      ? site
      : undefined
  const effectiveHasAccount = isUrlSource ? hasAccount : undefined

  const queryParams = React.useMemo(
    () => ({
      folder_id: folderId || undefined,
      tag: tag || undefined,
      language: effectiveLanguage,
      owner: effectiveOwner,
      site: effectiveSite,
      source_type: sourceType || undefined,
      health_status: effectiveHealth,
      has_account: effectiveHasAccount,
      ai_status: aiStatus,
      sort,
      q: q || undefined,
      archived: archived || undefined,
    }),
    [
      folderId,
      tag,
      effectiveLanguage,
      effectiveOwner,
      effectiveSite,
      sourceType,
      effectiveHealth,
      effectiveHasAccount,
      aiStatus,
      sort,
      q,
      archived,
    ],
  )

  const {
    mode: paginationMode,
    pageSize,
    isResolved: paginationResolved,
  } = useBookmarkPaginationSettings()

  const requestedPage = parsePageParam(searchParams.get(BOOKMARK_PAGE_PARAM))

  const {
    items,
    total,
    isLoading,
    isError,
    error,
    page,
    pageCount,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useBookmarkPages({
    mode: paginationMode,
    pageSize,
    page: requestedPage,
    params: queryParams,
    enabled: paginationResolved,
  })

  useRedirectGuestOnUnauthorized(isError ? (error as Error) : null)

  const goToPage = React.useCallback(
    (nextPage: number) => {
      const next = new URLSearchParams(searchParams)
      if (nextPage <= 1) next.delete(BOOKMARK_PAGE_PARAM)
      else next.set(BOOKMARK_PAGE_PARAM, String(nextPage))
      setSearchParams(next)
      getAppScrollRoot()?.scrollTo({ top: 0 })
    },
    [searchParams, setSearchParams],
  )

  // 页码越界（改了 pageSize、删了收藏）时替换为最后有效页，不留历史记录
  React.useEffect(() => {
    if (paginationMode !== "pagination" || isLoading || isError) return
    const valid = clampPage(requestedPage, pageSize, total)
    if (valid === requestedPage) return
    const next = new URLSearchParams(searchParams)
    if (valid <= 1) next.delete(BOOKMARK_PAGE_PARAM)
    else next.set(BOOKMARK_PAGE_PARAM, String(valid))
    setSearchParams(next, { replace: true })
  }, [
    paginationMode,
    isLoading,
    isError,
    requestedPage,
    total,
    pageSize,
    searchParams,
    setSearchParams,
  ])

  // 非传统模式下 URL 里的遗留页码没有意义，直接清掉
  React.useEffect(() => {
    if (paginationMode === "pagination") return
    if (!searchParams.has(BOOKMARK_PAGE_PARAM)) return
    const next = new URLSearchParams(searchParams)
    next.delete(BOOKMARK_PAGE_PARAM)
    setSearchParams(next, { replace: true })
  }, [paginationMode, searchParams, setSearchParams])

  // 首屏加载失败才整页报错；追加失败保留已加载内容
  const showListError = isError && items.length === 0
  const loadMoreError = isError && items.length > 0

  const panelFilterCount = countPanelFilters(searchParams)
  const hasActiveFilters = !!(
    folderId ||
    q ||
    panelFilterCount > 0 ||
    aiStatus
  )

  const clearListFilters = () => {
    setSearchParams(new URLSearchParams())
  }

  const clearAiStatusFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete("ai_status")
    next.delete(BOOKMARK_PAGE_PARAM)
    setSearchParams(next)
  }

  return (
    <div className="mx-auto min-w-0 w-full max-w-6xl space-y-4 pb-12">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {!isLoading && !showListError ? (
            <span>{t("list.total", { total })}</span>
          ) : null}
          {paginationMode === "pagination" && pageCount > 1 ? (
            <span className="whitespace-nowrap">
              {t("pagination.pageStatus", { page, pageCount })}
            </span>
          ) : null}
          {panelFilterCount > 0 ? (
            <span className="truncate">
              {t("list.filterActiveCount", { count: panelFilterCount })}
            </span>
          ) : null}
          {aiStatus ? (
            <Badge
              variant="outline"
              className="h-6 shrink-0 gap-1 pr-1 pl-2 text-[11px] font-normal"
            >
              <span className="truncate">
                {t("list.aiStatusFilterLabel", {
                  status: t(`list.aiStatus${aiStatus[0]!.toUpperCase()}${aiStatus.slice(1)}`),
                })}
              </span>
              <button
                type="button"
                onClick={clearAiStatusFilter}
                aria-label={t("list.clearAiStatusFilter")}
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <TooltipProvider delay={200}>
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card p-0.5 shadow-2xs">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant={viewMode === "list" ? "secondary" : "ghost"}
                      size="xs"
                      className="size-7 p-0"
                      onClick={() => handleViewModeChange("list")}
                    >
                      <RowsIcon className="size-4" />
                    </Button>
                  }
                />
                <TooltipContent side="top">{t("list.listView")}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant={viewMode === "grid" ? "secondary" : "ghost"}
                      size="xs"
                      className="size-7 p-0"
                      onClick={() => handleViewModeChange("grid")}
                    >
                      <GridFourIcon className="size-4" />
                    </Button>
                  }
                />
                <TooltipContent side="top">{t("list.gridView")}</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </div>

      {isLoading ? (
        viewMode === "grid" ? (
          <Masonry
            breakpointCols={BOOKMARK_MASONRY_BREAKPOINTS}
            className="bookmark-masonry"
            columnClassName="bookmark-masonry_column"
          >
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
          </Masonry>
        ) : (
          <div className="space-y-3">
            <BookmarkRowSkeleton />
            <BookmarkRowSkeleton />
            <BookmarkRowSkeleton />
          </div>
        )
      ) : showListError ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center text-xs text-destructive">
          {t("list.loadError")}
        </div>
      ) : items.length === 0 ? (
        <div className="my-6 flex flex-col items-center justify-center space-y-3 rounded-xl border border-dashed border-border/80 bg-card p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <StarIcon className="size-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t("list.emptyTitle")}
            </h3>
            <p className="max-w-sm text-xs text-muted-foreground">
              {hasActiveFilters
                ? t("list.emptyFiltered")
                : t("list.emptyDefault")}
            </p>
          </div>
          {hasActiveFilters ? (
            <Button
              variant="outline"
              size="sm"
              onClick={clearListFilters}
              className="mt-2 text-xs"
            >
              {t("common:actions.resetFilters")}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => requireAuth(() => setAddDialogOpen(true))}
              className="mt-2 gap-1.5 text-xs"
            >
              <PlusIcon className="size-4" />
              <span>{t("common:actions.add")}</span>
            </Button>
          )}
        </div>
      ) : (
        <BookmarkResults
          mode={paginationMode}
          viewMode={viewMode}
          items={items}
          page={page}
          pageCount={pageCount}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          loadMoreError={loadMoreError}
          onPageChange={goToPage}
          onOpenDetail={openDetail}
        />
      )}

      <AddBookmarkDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  )
}
