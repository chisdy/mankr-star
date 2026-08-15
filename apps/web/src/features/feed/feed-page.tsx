import * as React from "react"
import { useReadableSearchParams } from "@/lib/search-params"
import { useTranslation } from "react-i18next"
import { UPDATE_EVENT_TYPES, type UpdateEventType } from "@mankr/shared"
import {
  RssIcon,
  XIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
} from "@phosphor-icons/react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { FeedEventCard } from "@/features/feed/feed-event-card"
import { FeedStats } from "@/features/feed/feed-stats"
import { flattenFeedRows } from "@/features/feed/feed-timeline"
import { useFeedPages } from "@/features/feed/use-feed-pages"
import { VirtualFeedList } from "@/features/feed/virtual-feed-list"
import type { UpdateEvent } from "@/lib/types"
import { useAppScrollRoot } from "@/hooks/use-app-scroll-root"
import { useBookmarkDetail } from "@/hooks/use-bookmark-detail"
import { useRedirectGuestOnUnauthorized } from "@/hooks/use-auth"

const FEED_PAGE_SIZE = 20
const EVENT_TYPE_PARAM = "eventType"
const BOOKMARK_ID_PARAM = "bookmarkId"

function isEventType(value: string | null): value is UpdateEventType {
  return !!value && (UPDATE_EVENT_TYPES as readonly string[]).includes(value)
}

export function FeedPage() {
  const { t, i18n } = useTranslation("feed")
  const { openDetail } = useBookmarkDetail()
  const [searchParams, setSearchParams] = useReadableSearchParams()
  const scrollElement = useAppScrollRoot()

  const eventTypeParam = searchParams.get(EVENT_TYPE_PARAM)
  const eventTypeFilter = isEventType(eventTypeParam) ? eventTypeParam : null
  const bookmarkIdFilter = searchParams.get(BOOKMARK_ID_PARAM) || null

  // 筛选进 queryKey：改筛选即换一条查询，自然从第 1 页重新开始
  const {
    items,
    isLoading,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    loadMoreError,
    fetchNextPage,
  } = useFeedPages({
    eventType: eventTypeFilter ?? undefined,
    bookmarkId: bookmarkIdFilter ?? undefined,
    pageSize: FEED_PAGE_SIZE,
  })

  useRedirectGuestOnUnauthorized(isError ? error : null)

  const isFiltered = Boolean(eventTypeFilter || bookmarkIdFilter)

  const setEventTypeFilter = (value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(EVENT_TYPE_PARAM, value)
    else next.delete(EVENT_TYPE_PARAM)
    setSearchParams(next)
  }

  const clearBookmarkFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete(BOOKMARK_ID_PARAM)
    setSearchParams(next)
  }

  const eventTypeItems = React.useMemo(
    () => [
      { value: null, label: t("filterAll") },
      ...UPDATE_EVENT_TYPES.map((type) => ({
        value: type,
        label: t(`eventType.${type}`),
      })),
    ],
    [t]
  )

  const rows = React.useMemo(
    () => flattenFeedRows(items, i18n.language),
    [items, i18n.language]
  )

  const renderEvent = React.useCallback(
    (event: UpdateEvent) => (
      <FeedEventCard event={event} onOpen={() => openDetail(event.bookmark_id)} />
    ),
    [openDetail]
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
              <RssIcon className="size-4.5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("title")}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("description")}
          </p>
        </div>

        <FeedStats
          selectedEventType={eventTypeFilter}
          onSelectEventType={setEventTypeFilter}
        />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
            <ClockCounterClockwiseIcon className="size-4 text-primary" />
            {t("timelineTitle")}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              items={eventTypeItems}
              value={eventTypeFilter}
              onValueChange={(val) => setEventTypeFilter(val)}
            >
              <SelectTrigger size="sm" className="h-8 w-full text-xs sm:w-56">
                <SelectValue placeholder={t("filterAll")} />
              </SelectTrigger>
              <SelectContent>
                {eventTypeItems.map((item) => (
                  <SelectItem key={item.value ?? "all"} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {bookmarkIdFilter && (
              <Badge
                variant="outline"
                className="h-8 gap-1.5 px-2.5 text-[11px] font-normal"
              >
                <span>{t("filteredByBookmark")}</span>
                <button
                  type="button"
                  onClick={clearBookmarkFilter}
                  aria-label={t("clearFilter")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center space-y-3 rounded-xl border border-dashed border-border/80 bg-card p-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <RssIcon className="size-5" />
            </div>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              {isFiltered ? t("emptyFiltered") : t("empty")}
            </p>
          </div>
        ) : (
          <>
            <VirtualFeedList
              rows={rows}
              scrollElement={scrollElement}
              renderEvent={renderEvent}
            />

            <div
              className="flex min-h-9 items-center justify-center pt-2 text-xs text-muted-foreground"
              aria-live="polite"
            >
              {loadMoreError ? (
                <div className="flex items-center gap-2">
                  <span className="text-destructive">{t("loadMoreError")}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={fetchNextPage}
                  >
                    {t("retry")}
                  </Button>
                </div>
              ) : isFetchingNextPage ? (
                <span className="flex items-center gap-1.5">
                  <CircleNotchIcon className="size-3.5 animate-spin" />
                  {t("loadingMore")}
                </span>
              ) : hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fetchNextPage}
                  className="h-8 text-xs"
                >
                  {t("loadMore")}
                </Button>
              ) : (
                <span>{t("end")}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
