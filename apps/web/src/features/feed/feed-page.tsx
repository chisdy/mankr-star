import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  RssIcon,
  TagIcon,
  GitCommitIcon,
  StarIcon,
  InfoIcon,
} from "@phosphor-icons/react"

import { Badge } from "@workspace/ui/components/badge"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { EventType, UpdateEvent } from "@/lib/types"
import { BookmarkDetailDrawer } from "@/features/bookmarks/bookmark-detail-drawer"
import { useRedirectGuestOnUnauthorized } from "@/hooks/use-auth"

export function FeedPage() {
  const { t, i18n } = useTranslation("feed")
  const [selectedBookmarkId, setSelectedBookmarkId] = React.useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const { data: events = [], isLoading, isError, error } = useQuery({
    queryKey: queryKeys.feed.all,
    queryFn: () => api.getFeed(),
  })

  useRedirectGuestOnUnauthorized(isError ? (error as Error) : null)

  // Group events by date (YYYY-MM-DD)
  const groupedEvents = React.useMemo(() => {
    const map = new Map<string, UpdateEvent[]>()
    events.forEach((evt) => {
      const dateStr = new Date(evt.detected_at).toLocaleDateString(i18n.language, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
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
        return <TagIcon className="size-4 text-emerald-500" />
      case "push":
        return <GitCommitIcon className="size-4 text-blue-500" />
      case "stars_delta":
        return <StarIcon className="size-4 text-amber-500" />
      case "meta_change":
      default:
        return <InfoIcon className="size-4 text-purple-500" />
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-12">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("description")}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : events.length === 0 ? (
        /* Empty state with UI_DESIGN exact text */
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card p-12 text-center space-y-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <RssIcon className="size-5" />
          </div>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            {t("empty")}
          </p>
        </div>
      ) : (
        /* Timeline List */
        <div className="space-y-8">
          {groupedEvents.map(([date, items]) => (
            <div key={date} className="space-y-3">
              <h2 className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                {date}
              </h2>

              <div className="space-y-2 border-l-2 border-border/60 pl-3 md:pl-4 ml-1">
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
                      onClick={() => {
                        setSelectedBookmarkId(evt.bookmark_id)
                        setDrawerOpen(true)
                      }}
                      className="group flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-3.5 text-card-foreground shadow-2xs hover:border-border transition-all cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {renderEventIcon(evt.event_type)}
                          <span className="font-semibold text-xs md:text-sm text-foreground truncate group-hover:text-primary transition-colors">
                            {evt.bookmark_external_id || evt.bookmark_title}
                          </span>
                          <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 font-normal">
                            {t(`eventType.${evt.event_type}`)}
                          </Badge>
                        </div>

                        <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                          {new Date(evt.detected_at).toLocaleTimeString(i18n.language, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>

                      {(payloadData.tag || payloadData.title || payloadData.commit) && (
                        <p className="text-xs text-muted-foreground pl-6">
                          {payloadData.tag && <span className="font-mono font-medium text-foreground mr-1.5">{payloadData.tag}</span>}
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
      )}

      {/* Detail Drawer */}
      <BookmarkDetailDrawer
        bookmarkId={selectedBookmarkId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  )
}
