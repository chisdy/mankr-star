import * as React from "react"
import { useSearchParams, useNavigate } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  FunnelIcon,
  XIcon,
  PlusIcon,
  StarIcon,
  RowsIcon,
  GridFourIcon,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { api } from "@/lib/api"
import {
  folderPathLabel,
} from "@/lib/folder-utils"
import { queryKeys } from "@/lib/query-keys"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  useRedirectGuestOnUnauthorized,
  useRequireAuthAction,
} from "@/hooks/use-auth"
import { BookmarkRow, BookmarkRowSkeleton } from "./bookmark-row"
import { BookmarkCard, BookmarkCardSkeleton } from "./bookmark-card"
import { BookmarkDetailDrawer } from "./bookmark-detail-drawer"
import { AddBookmarkDialog } from "./add-bookmark-dialog"
import { OwnerSelect } from "./owner-select"

export function BookmarksPage() {
  const { t } = useTranslation(["bookmarks", "common"])
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const requireAuth = useRequireAuthAction()

  // Selected item for drawer
  const [selectedBookmarkId, setSelectedBookmarkId] = React.useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [addDialogOpen, setAddDialogOpen] = React.useState(false)

  // View mode state ("list" | "grid"), default to "grid" or saved preference
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

  // Filter params from URL
  const folderId = searchParams.get("folder_id") || ""
  const tag = searchParams.get("tag") || ""
  const language = searchParams.get("language") || ""
  const owner = searchParams.get("owner") || ""
  const healthStatus = searchParams.get("health_status") || ""
  const sortParam = searchParams.get("sort")
  const sort: "recent" | "updated" | "stars" | "name" =
    sortParam === "stars" ||
    sortParam === "name" ||
    sortParam === "updated"
      ? sortParam
      : "recent"
  const q = searchParams.get("q") || ""
  const archived = searchParams.get("archived") === "true"

  const queryParams = React.useMemo(
    () => ({
      folder_id: folderId || undefined,
      tag: tag || undefined,
      language: language || undefined,
      owner: owner || undefined,
      health_status: (healthStatus || undefined) as
        | "unavailable"
        | "empty"
        | "archived"
        | "stale"
        | "active"
        | "hot"
        | "unknown"
        | undefined,
      sort,
      q: q || undefined,
      archived: archived || undefined,
    }),
    [folderId, tag, language, owner, healthStatus, sort, q, archived]
  )

  // Query bookmarks
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

  // Query folders for active filter chip label
  const { data: folders = [] } = useQuery({
    queryKey: queryKeys.folders.all,
    queryFn: () => api.getFolders(),
  })

  // Query tags for filter dropdown
  const { data: tags = [] } = useQuery({
    queryKey: queryKeys.tags.all,
    queryFn: () => api.getTags(),
  })

  const { data: owners = [], isLoading: ownersLoading } = useQuery({
    queryKey: queryKeys.bookmarks.owners,
    queryFn: () => api.getOwners(),
  })

  // Languages list extracted or standard
  const popularLanguages = ["TypeScript", "JavaScript", "Python", "Rust", "Go", "C++"]

  const tagItems = React.useMemo(
    () => [
      { value: null, label: t("list.tagAll") },
      ...tags.map((tagItem) => ({ value: tagItem.name, label: `#${tagItem.name}` })),
    ],
    [tags, t]
  )

  const languageItems = React.useMemo(
    () => [
      { value: null, label: t("list.languageAll") },
      ...popularLanguages.map((lang) => ({ value: lang, label: lang })),
    ],
    [t]
  )

  const sortItems = React.useMemo(
    () => [
      { value: "recent", label: t("list.sortRecent") },
      { value: "updated", label: t("list.sortUpdated") },
      { value: "stars", label: t("list.sortStars") },
      { value: "name", label: t("list.sortName") },
    ],
    [t]
  )

  const healthItems = React.useMemo(
    () => [
      { value: null, label: t("health.all") },
      { value: "hot", label: t("health.hot") },
      { value: "active", label: t("health.active") },
      { value: "stale", label: t("health.stale") },
      { value: "archived", label: t("health.archived") },
      { value: "empty", label: t("health.empty") },
      { value: "unavailable", label: t("health.unavailable") },
    ],
    [t]
  )

  const updateParam = (key: string, value: string | null | undefined) => {
    const newParams = new URLSearchParams(searchParams)
    if (value) {
      newParams.set(key, value)
    } else {
      newParams.delete(key)
    }
    setSearchParams(newParams)
  }

  const clearAllFilters = () => {
    setSearchParams(new URLSearchParams())
  }

  const hasActiveFilters = !!(
    folderId ||
    tag ||
    language ||
    owner ||
    healthStatus ||
    q ||
    archived ||
    sort !== "recent"
  )

  const handleRowClick = (bookmarkId: string) => {
    if (isMobile) {
      navigate(`/bookmarks/${bookmarkId}`)
    } else {
      setSelectedBookmarkId(bookmarkId)
      setDrawerOpen(true)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-12">
      {/* Toolbar / Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-2xs md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FunnelIcon className="size-4" />
              <span>{t("list.filterTitle")}</span>
            </div>

            {/* Tag Select */}
            <Select
              items={tagItems}
              value={tag || null}
              onValueChange={(val) => updateParam("tag", val || null)}
            >
              <SelectTrigger size="sm" className="h-8 min-w-28 text-xs">
                <SelectValue placeholder={t("list.tagAll")} />
              </SelectTrigger>
              <SelectContent>
                {tagItems.map((item) => (
                  <SelectItem key={String(item.value)} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Language Select */}
            <Select
              items={languageItems}
              value={language || null}
              onValueChange={(val) => updateParam("language", val || null)}
            >
              <SelectTrigger size="sm" className="h-8 min-w-28 text-xs">
                <SelectValue placeholder={t("list.languageAll")} />
              </SelectTrigger>
              <SelectContent>
                {languageItems.map((item) => (
                  <SelectItem key={String(item.value)} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <OwnerSelect
              owners={owners}
              value={owner || null}
              onValueChange={(val) => updateParam("owner", val)}
              isLoading={ownersLoading}
              size="sm"
            />

            {/* Health status Select */}
            <Select
              items={healthItems}
              value={healthStatus || null}
              onValueChange={(val) => updateParam("health_status", val || null)}
            >
              <SelectTrigger size="sm" className="h-8 min-w-28 text-xs">
                <SelectValue placeholder={t("list.healthPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {healthItems.map((item) => (
                  <SelectItem key={String(item.value)} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Sort Select */}
            <Select
              items={sortItems}
              value={sort}
              onValueChange={(val) =>
                updateParam(
                  "sort",
                  !val || val === "recent" ? null : val
                )
              }
            >
              <SelectTrigger size="sm" className="h-8 min-w-32 text-xs">
                <SelectValue placeholder={t("list.sortRecent")} />
              </SelectTrigger>
              <SelectContent>
                {sortItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Archived Toggle */}
          <div className="flex shrink-0 items-center gap-2">
            <Checkbox
              id="archived"
              checked={archived}
              onCheckedChange={(checked) =>
                updateParam("archived", checked ? "true" : null)
              }
            />
            <Label
              htmlFor="archived"
              className="cursor-pointer select-none text-xs font-normal text-muted-foreground"
            >
              {t("list.includeArchived")}
            </Label>
          </div>
        </div>

        {/* Filter Chips Bar */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-1 text-xs">
            <span className="mr-1 text-[11px] text-muted-foreground">
              {t("list.activePrefix")}
            </span>

            {q && (
              <Badge
                variant="secondary"
                className="h-5 gap-1 text-[11px] font-normal"
              >
                <span>{t("list.chipSearch", { query: q })}</span>
                <XIcon
                  className="size-3 cursor-pointer"
                  onClick={() => updateParam("q", null)}
                />
              </Badge>
            )}

            {folderId && (
              <Badge
                variant="secondary"
                className="h-5 gap-1 text-[11px] font-normal"
              >
                <span>
                  {t("list.chipFolder", {
                    folder: folders.find((f) => f.id === folderId)
                      ? folderPathLabel(
                          folders.find((f) => f.id === folderId)!,
                          folders,
                        )
                      : folderId,
                  })}
                </span>
                <XIcon
                  className="size-3 cursor-pointer"
                  onClick={() => updateParam("folder_id", null)}
                />
              </Badge>
            )}

            {tag && (
              <Badge
                variant="secondary"
                className="h-5 gap-1 text-[11px] font-normal"
              >
                <span>{t("list.chipTag", { tag })}</span>
                <XIcon
                  className="size-3 cursor-pointer"
                  onClick={() => updateParam("tag", null)}
                />
              </Badge>
            )}

            {language && (
              <Badge
                variant="secondary"
                className="h-5 gap-1 text-[11px] font-normal"
              >
                <span>{t("list.chipLanguage", { language })}</span>
                <XIcon
                  className="size-3 cursor-pointer"
                  onClick={() => updateParam("language", null)}
                />
              </Badge>
            )}

            {owner && (
              <Badge
                variant="secondary"
                className="h-5 gap-1 text-[11px] font-normal"
              >
                <span>{t("list.chipOwner", { name: owner })}</span>
                <XIcon
                  className="size-3 cursor-pointer"
                  onClick={() => updateParam("owner", null)}
                />
              </Badge>
            )}

            {healthStatus && (
              <Badge
                variant="secondary"
                className="h-5 gap-1 text-[11px] font-normal"
              >
                <span>
                  {t("list.chipHealth", {
                    health:
                      healthItems.find((h) => h.value === healthStatus)?.label ||
                      healthStatus,
                  })}
                </span>
                <XIcon
                  className="size-3 cursor-pointer"
                  onClick={() => updateParam("health_status", null)}
                />
              </Badge>
            )}

            {sort !== "recent" && (
              <Badge
                variant="secondary"
                className="h-5 gap-1 text-[11px] font-normal"
              >
                <span>
                  {sortItems.find((s) => s.value === sort)?.label || sort}
                </span>
                <XIcon
                  className="size-3 cursor-pointer"
                  onClick={() => updateParam("sort", null)}
                />
              </Badge>
            )}

            {archived && (
              <Badge
                variant="secondary"
                className="h-5 gap-1 text-[11px] font-normal"
              >
                <span>{t("list.chipArchived")}</span>
                <XIcon
                  className="size-3 cursor-pointer"
                  onClick={() => updateParam("archived", null)}
                />
              </Badge>
            )}

            <Button
              variant="ghost"
              size="xs"
              onClick={clearAllFilters}
              className="ml-auto h-5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("common:actions.clearFilters")}
            </Button>
          </div>
        )}
      </div>

      {/* Bookmarks List State */}
      {isLoading ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
            <BookmarkCardSkeleton />
          </div>
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
        /* Empty State */
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card p-12 text-center my-6 space-y-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <StarIcon className="size-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">{t("list.emptyTitle")}</h3>
            <p className="text-xs text-muted-foreground max-w-sm">
              {hasActiveFilters
                ? t("list.emptyFiltered")
                : t("list.emptyDefault")}
            </p>
          </div>
          {hasActiveFilters ? (
            <Button
              variant="outline"
              size="sm"
              onClick={clearAllFilters}
              className="text-xs mt-2"
            >
              {t("common:actions.resetFilters")}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => requireAuth(() => setAddDialogOpen(true))}
              className="gap-1.5 text-xs mt-2"
            >
              <PlusIcon className="size-4" />
              <span>{t("common:actions.add")}</span>
            </Button>
          )}
        </div>
      ) : (
        /* Items List */
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>{t("list.total", { total: data.total })}</span>

            {/* View Mode Switcher */}
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

          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {data.items.map((bookmark) => (
                <BookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  onClick={() => handleRowClick(bookmark.id)}
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-3">
              {data.items.map((bookmark) => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  onClick={() => handleRowClick(bookmark.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail Sheet Drawer for Desktop */}
      <BookmarkDetailDrawer
        bookmarkId={selectedBookmarkId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />

      {/* Add Dialog */}
      <AddBookmarkDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  )
}
