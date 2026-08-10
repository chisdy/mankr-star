import * as React from "react"
import { useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { UPDATE_EVENT_TYPES, type UpdateEventType } from "@mankr/shared"
import {
  RssIcon,
  TagIcon,
  GitCommitIcon,
  StarIcon,
  InfoIcon,
  XIcon,
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
import { FeedStats } from "@/features/feed/feed-stats"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { EventType, UpdateEvent } from "@/lib/types"
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
  const [searchParams, setSearchParams] = useSearchParams()

  const eventTypeParam = searchParams.get(EVENT_TYPE_PARAM)
  const eventTypeFilter = isEventType(eventTypeParam) ? eventTypeParam : null
  const bookmarkIdFilter = searchParams.get(BOOKMARK_ID_PARAM) || null
  const filterKey = `${eventTypeFilter ?? ""}:${bookmarkIdFilter ?? ""}`

  // 筛选与页码绑在同一状态：筛选一变，page 立即回到 1，避免「新筛选 + 旧页」多余请求
  const [pager, setPager] = React.useState<{
    key: string
    page: number
    events: UpdateEvent[]
  }>({ key: filterKey, page: 1, events: [] })

  const page = pager.key === filterKey ? pager.page : 1
  const events = pager.key === filterKey ? pager.events : []

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: queryKeys.feed.list({
      eventType: eventTypeFilter ?? undefined,
      bookmarkId: bookmarkIdFilter ?? undefined,
      page,
      pageSize: FEED_PAGE_SIZE,
    }),
    queryFn: () =>
      api.getFeed({
        eventType: eventTypeFilter ?? undefined,
        bookmarkId: bookmarkIdFilter ?? undefined,
        page,
        pageSize: FEED_PAGE_SIZE,
      }),
  })

  useRedirectGuestOnUnauthorized(isError ? (error as Error) : null)

  React.useEffect(() => {
    if (!data) return
    setPager((prev) => ({
      key: filterKey,
      page: data.page,
      events:
        data.page === 1
          ? data.items
          : [...(prev.key === filterKey ? prev.events : []), ...data.items],
    }))
  }, [data, filterKey])

  const total = data?.total ?? 0
  const hasMore = events.length < total
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

  const loadMore = () => {
    setPager({
      key: filterKey,
      page: page + 1,
      events,
    })
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

  // Group events by date (YYYY-MM-DD)
  const groupedEvents = React.useMemo(() => {
    const map = new Map<string, UpdateEvent[]>()
    events.forEach((evt) => {
      const dateStr = new Date(evt.detected_at).toLocaleDateString(
        i18n.language,
        {
          year: "numeric",
          month: "long",
          day: "numeric",
        }
      )
      if (!map.has(dateStr)) {
        map.set(dateStr, [])
      }
      map.get(dateStr)!.push(evt)
    })
    return Array.from(map.entries())
  }, [events, i18n.language])

  const renderEventIcon = (type: EventType) => {
    switch (type) {
      case "release":
        return (
          <TagIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
        )
      case "push":
        return (
          <GitCommitIcon className="size-4 text-sky-600 dark:text-sky-400" />
        )
      case "stars_delta":
        return (
          <StarIcon className="size-4 text-amber-500/90 dark:text-amber-400" />
        )
      case "meta_change":
      default:
        return (
          <InfoIcon className="size-4 text-violet-500 dark:text-violet-400" />
        )
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* Header */}
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
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
        ) : events.length === 0 ? (
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
            <div className="space-y-8">
              {groupedEvents.map(([date, items]) => (
                <div key={date} className="space-y-3">
                  <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    {date}
                  </h3>

                  <div className="ml-1 space-y-2 border-l-2 border-border/60 pl-3 md:pl-4">
                    {items.map((evt) => {
                      let payloadData: Record<string, string> = {}
                      try {
                        if (evt.payload_json) {
                          payloadData = JSON.parse(evt.payload_json)
                        }
                      } catch {
                        // ignore
                      }

                      return (
                        <div
                          key={evt.id}
                          onClick={() => openDetail(evt.bookmark_id)}
                          className="group flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-3.5 text-card-foreground shadow-2xs transition-all hover:border-border"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {renderEventIcon(evt.event_type)}
                              <span className="truncate text-xs font-semibold text-foreground transition-colors group-hover:text-primary md:text-sm">
                                {evt.bookmark_external_id || evt.bookmark_title}
                              </span>
                              <Badge
                                variant="outline"
                                className="h-4.5 px-1.5 text-[10px] font-normal"
                              >
                                {t(`eventType.${evt.event_type}`)}
                              </Badge>
                            </div>

                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              {new Date(evt.detected_at).toLocaleTimeString(
                                i18n.language,
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                            </span>
                          </div>

                          {(payloadData.tag ||
                            payloadData.title ||
                            payloadData.commit) && (
                            <p className="pl-6 text-xs text-muted-foreground">
                              {payloadData.tag && (
                                <span className="mr-1.5 font-mono font-medium text-foreground">
                                  {payloadData.tag}
                                </span>
                              )}
                              {payloadData.title || payloadData.commit}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={isFetching}
                  className="text-xs"
                >
                  {t("loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
