import * as React from "react"
import { Link } from "react-router"
import { useReadableSearchParams } from "@/lib/search-params"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  BroomIcon,
  CaretLeftIcon,
  CaretRightIcon,
  DotsThreeVerticalIcon,
  HashIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { TagClearEmptyDialog } from "@/features/tags/tag-clear-empty-dialog"
import { TagDeleteDialog } from "@/features/tags/tag-delete-dialog"
import { TagRenameDialog } from "@/features/tags/tag-rename-dialog"
import { useAuth, useRedirectGuestOnUnauthorized } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { getAppScrollRoot } from "@/lib/scroll-root"
import {
  clampPage,
  paginationItems,
  parsePageParam,
  totalPageCount,
} from "@/features/bookmarks/bookmark-pagination"
import type { Tag } from "@/lib/types"

type TagSort = "count" | "name"

const PAGE_PARAM = "page"

/** 与宫格列数对齐：2/3/4 列都能整除 */
const TAGS_PAGE_SIZE = 48

const SORT_ITEMS: Array<{
  value: TagSort
  labelKey: "sortCount" | "sortName"
}> = [
  { value: "count", labelKey: "sortCount" },
  { value: "name", labelKey: "sortName" },
]

function sortTags(tags: Tag[], sort: TagSort): Tag[] {
  const list = [...tags]
  if (sort === "name") {
    list.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    )
  } else {
    list.sort((a, b) => {
      const diff = (b.count ?? 0) - (a.count ?? 0)
      if (diff !== 0) return diff
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    })
  }
  return list
}

function TagsPaginator({
  page,
  pageCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation("tags")
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
            className={cn(
              "h-8 min-w-8 px-2 text-xs",
              item === page && "font-semibold"
            )}
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
        )
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

function TagCard({
  tag,
  canManage,
  onEdit,
  onDelete,
}: {
  tag: Tag
  canManage: boolean
  onEdit: (tag: Tag) => void
  onDelete: (tag: Tag) => void
}) {
  const { t } = useTranslation("tags")
  const [menuOpen, setMenuOpen] = React.useState(false)
  const count = tag.count ?? 0

  return (
    <div
      className={cn(
        "group relative flex min-h-24 flex-col rounded-lg border border-border/60 bg-card transition-colors",
        "hover:border-border hover:bg-muted/40",
        menuOpen && "border-border bg-muted/40"
      )}
    >
      <Link
        to={`/?tag=${encodeURIComponent(tag.name)}`}
        className={cn(
          "flex min-h-24 flex-1 flex-col justify-between gap-3 p-4 active:scale-[0.98]",
          canManage && "pr-10"
        )}
      >
        <span className="flex min-w-0 items-start gap-1.5">
          <HashIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
          <span className="line-clamp-2 text-sm font-medium break-all text-foreground group-hover:text-primary">
            {tag.name}
          </span>
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {t("count", { count })}
        </span>
      </Link>

      {canManage ? (
        <div
          className={cn(
            "pointer-events-none absolute top-2 right-2 z-10 opacity-0 transition-opacity",
            "group-hover:pointer-events-auto group-hover:opacity-100",
            menuOpen && "pointer-events-auto opacity-100"
          )}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  aria-label={t("menu.aria", { tagName: tag.name })}
                  onClick={(e) => e.stopPropagation()}
                />
              }
            >
              <DotsThreeVerticalIcon className="size-3.5" weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(tag)
                }}
              >
                <PencilSimpleIcon className="mr-2 size-4" />
                {t("menu.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(tag)
                }}
              >
                <TrashIcon className="mr-2 size-4" />
                {t("menu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  )
}

export function TagsPage() {
  const { t } = useTranslation("tags")
  const { isAuthenticated: canManage } = useAuth()
  const [searchParams, setSearchParams] = useReadableSearchParams()
  const [filter, setFilter] = React.useState("")
  const [sort, setSort] = React.useState<TagSort>("count")
  const [renameTag, setRenameTag] = React.useState<Tag | null>(null)
  const [deleteTag, setDeleteTag] = React.useState<Tag | null>(null)
  const [clearEmptyOpen, setClearEmptyOpen] = React.useState(false)

  const requestedPage = parsePageParam(searchParams.get(PAGE_PARAM))

  const {
    data: tags = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: queryKeys.tags.all,
    queryFn: () => api.getTags(),
  })

  useRedirectGuestOnUnauthorized(isError ? (error as Error) : null)

  const emptyCount = tags.filter((tag) => (tag.count ?? 0) === 0).length

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q
      ? tags.filter((tag) => tag.name.toLowerCase().includes(q))
      : tags
    return sortTags(list, sort)
  }, [filter, sort, tags])

  const total = filtered.length
  const pageCount = totalPageCount(total, TAGS_PAGE_SIZE)
  const page = clampPage(requestedPage, TAGS_PAGE_SIZE, total)
  const pageItems = filtered.slice(
    (page - 1) * TAGS_PAGE_SIZE,
    page * TAGS_PAGE_SIZE
  )

  const goToPage = React.useCallback(
    (nextPage: number, replace = false) => {
      const next = new URLSearchParams(searchParams)
      if (nextPage <= 1) next.delete(PAGE_PARAM)
      else next.set(PAGE_PARAM, String(nextPage))
      setSearchParams(next, { replace })
      getAppScrollRoot()?.scrollTo({ top: 0 })
    },
    [searchParams, setSearchParams]
  )

  const handleFilterChange = (value: string) => {
    setFilter(value)
    if (requestedPage > 1) goToPage(1, true)
  }

  const handleSortChange = (val: string | null) => {
    if (val !== "count" && val !== "name") return
    setSort(val)
    if (requestedPage > 1) goToPage(1, true)
  }

  // 页码越界（搜索结果变少）时收敛到有效页
  React.useEffect(() => {
    if (isLoading || isError || total === 0) return
    if (page === requestedPage) return
    goToPage(page, true)
  }, [isLoading, isError, total, page, requestedPage, goToPage])

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div className="pb-2">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("description")}
        </p>
      </div>

      {!isLoading && !isError && tags.length > 0 ? (
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlassIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 border-muted bg-muted/40 pr-3 pl-8 text-sm"
            />
          </div>
          <Select
            items={SORT_ITEMS.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            value={sort}
            onValueChange={handleSortChange}
          >
            <SelectTrigger
              aria-label={t("sortLabel")}
              className="h-9 w-[7.5rem] shrink-0 border-muted bg-muted/40 text-xs sm:w-36"
            >
              <SelectValue placeholder={t("sortLabel")} />
            </SelectTrigger>
            <SelectContent>
              {SORT_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {t(item.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && emptyCount > 0 ? (
            <TooltipProvider delay={200}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 border-muted bg-muted/40 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      aria-label={t("clearEmpty.label")}
                      onClick={() => setClearEmptyOpen(true)}
                    >
                      <BroomIcon className="size-3.5" />
                      <span className="font-mono tabular-nums">
                        {emptyCount}
                      </span>
                    </Button>
                  }
                />
                <TooltipContent side="top">
                  {t("clearEmpty.label")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card p-12 text-center">
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            {t("error")}
          </p>
        </div>
      ) : tags.length === 0 ? (
        <div className="flex flex-col items-center justify-center space-y-3 rounded-xl border border-dashed border-border/80 bg-card p-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <HashIcon className="size-5" />
          </div>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            {t("empty")}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card p-12 text-center">
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            {t("emptySearch")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              {t("total", { count: total })}
            </span>
            {pageCount > 1 ? (
              <>
                <span className="mx-1.5 text-border">·</span>
                {t("pagination.pageStatus", { page, pageCount })}
              </>
            ) : null}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {pageItems.map((tag) => (
              <TagCard
                key={tag.id}
                tag={tag}
                canManage={canManage}
                onEdit={setRenameTag}
                onDelete={setDeleteTag}
              />
            ))}
          </div>
          <TagsPaginator
            page={page}
            pageCount={pageCount}
            onPageChange={goToPage}
          />
        </div>
      )}

      <TagRenameDialog
        open={Boolean(renameTag)}
        onOpenChange={(open) => {
          if (!open) setRenameTag(null)
        }}
        tag={renameTag}
      />
      <TagDeleteDialog
        open={Boolean(deleteTag)}
        onOpenChange={(open) => {
          if (!open) setDeleteTag(null)
        }}
        tag={deleteTag}
      />
      <TagClearEmptyDialog
        open={clearEmptyOpen}
        onOpenChange={setClearEmptyOpen}
        emptyCount={emptyCount}
      />
    </div>
  )
}
