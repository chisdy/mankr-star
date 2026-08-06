import * as React from "react"
import { useSearchParams, useNavigate } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  FunnelIcon,
  PlusIcon,
  StarIcon,
  RowsIcon,
  GridFourIcon,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { useIsMobile } from "@/hooks/use-mobile"
import { useFilterPanelOpen } from "@/hooks/use-filter-panel-open"
import {
  useRedirectGuestOnUnauthorized,
  useRequireAuthAction,
} from "@/hooks/use-auth"
import { BookmarkRow, BookmarkRowSkeleton } from "./bookmark-row"
import { BookmarkCard, BookmarkCardSkeleton } from "./bookmark-card"
import { BookmarkDetailDrawer } from "./bookmark-detail-drawer"
import { AddBookmarkDialog } from "./add-bookmark-dialog"
import {
  FilterPanelBody,
  countPanelFilters,
} from "./filter-panel-body"
import Masonry from "react-masonry-css"
import "./bookmark-masonry.css"

const BOOKMARK_MASONRY_BREAKPOINTS = {
  default: 3,
  1023: 2,
  767: 1,
}

export function BookmarksPage() {
  const { t } = useTranslation(["bookmarks", "common"])
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const requireAuth = useRequireAuthAction()
  const { open: filterPanelOpen, setOpen: setFilterPanelOpen } =
    useFilterPanelOpen()

  const [selectedBookmarkId, setSelectedBookmarkId] = React.useState<
    string | null
  >(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [addDialogOpen, setAddDialogOpen] = React.useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = React.useState(false)

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

  const queryParams = React.useMemo(
    () => ({
      folder_id: folderId || undefined,
      tag: tag || undefined,
      language: effectiveLanguage,
      owner: effectiveOwner,
      site: effectiveSite,
      source_type: sourceType || undefined,
      health_status: effectiveHealth,
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
      sort,
      q,
      archived,
    ],
  )

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.bookmarks.list(queryParams),
    queryFn: () => api.getBookmarks(queryParams),
    refetchInterval: (query) => {
      const items = query.state.data?.items
      if (!items?.length) return false
      return items.some((b) => b.ai_status === "pending") ? 2000 : false
    },
  })

  useRedirectGuestOnUnauthorized(isError ? (error as Error) : null)

  const panelFilterCount = countPanelFilters(searchParams)
  const filterUiOpen = isMobile ? filterSheetOpen : filterPanelOpen
  const hasActiveFilters = !!(
    folderId ||
    q ||
    panelFilterCount > 0
  )

  const clearListFilters = () => {
    setSearchParams(new URLSearchParams())
  }

  const handleRowClick = (bookmarkId: string) => {
    if (isMobile) {
      navigate(`/bookmarks/${bookmarkId}`)
    } else {
      setSelectedBookmarkId(bookmarkId)
      setDrawerOpen(true)
    }
  }

  return (
    <div className="mx-auto min-w-0 w-full max-w-6xl space-y-4 pb-12">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {data ? <span>{t("list.total", { total: data.total })}</span> : null}
          {panelFilterCount > 0 ? (
            <span className="truncate">
              {t("list.filterActiveCount", { count: panelFilterCount })}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <TooltipProvider delay={200}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={
                      panelFilterCount > 0
                        ? "default"
                        : filterUiOpen
                          ? "secondary"
                          : "outline"
                    }
                    size="sm"
                    className="relative h-8 gap-1.5 px-2.5 text-xs"
                    aria-pressed={filterUiOpen}
                    aria-label={
                      filterUiOpen
                        ? t("list.filterCollapseAria")
                        : t("list.filterOpenAria")
                    }
                    onClick={() => {
                      if (isMobile) setFilterSheetOpen((open) => !open)
                      else setFilterPanelOpen(!filterPanelOpen)
                    }}
                  >
                    <FunnelIcon
                      className="size-4"
                      weight={panelFilterCount > 0 ? "fill" : "regular"}
                    />
                    {panelFilterCount > 0 ? (
                      <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-background text-[10px] text-foreground shadow-xs">
                        {panelFilterCount}
                      </span>
                    ) : null}
                  </Button>
                }
              />
              <TooltipContent side="top">
                {filterUiOpen
                  ? t("list.filterCollapseAria")
                  : t("list.filterOpenAria")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

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
      ) : isError ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center text-xs text-destructive">
          {t("list.loadError")}
        </div>
      ) : !data || data.items.length === 0 ? (
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
      ) : viewMode === "grid" ? (
        <Masonry
          breakpointCols={BOOKMARK_MASONRY_BREAKPOINTS}
          className="bookmark-masonry"
          columnClassName="bookmark-masonry_column"
        >
          {data.items.map((bookmark) => (
            <BookmarkCard
              key={bookmark.id}
              bookmark={bookmark}
              onClick={() => handleRowClick(bookmark.id)}
            />
          ))}
        </Masonry>
      ) : (
        <div className="grid min-w-0 w-full gap-3">
          {data.items.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              onClick={() => handleRowClick(bookmark.id)}
            />
          ))}
        </div>
      )}

      <BookmarkDetailDrawer
        bookmarkId={selectedBookmarkId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />

      <AddBookmarkDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetContent
          side="right"
          className="flex w-[min(100vw,20rem)] flex-col gap-0 p-0 sm:max-w-xs"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t("list.filterTitle")}</SheetTitle>
          </SheetHeader>
          <FilterPanelBody className="min-h-0 flex-1" />
        </SheetContent>
      </Sheet>
    </div>
  )
}
