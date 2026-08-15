import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  GitCommitIcon,
  InfoIcon,
  StarIcon,
  TagIcon,
} from "@phosphor-icons/react"

import { Badge } from "@workspace/ui/components/badge"
import type { EventType, UpdateEvent } from "@/lib/types"

function EventIcon({ type }: { type: EventType }) {
  switch (type) {
    case "release":
      return <TagIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
    case "push":
      return <GitCommitIcon className="size-4 text-sky-600 dark:text-sky-400" />
    case "stars_delta":
      return <StarIcon className="size-4 text-amber-500/90 dark:text-amber-400" />
    case "meta_change":
    default:
      return <InfoIcon className="size-4 text-violet-500 dark:text-violet-400" />
  }
}

function parsePayload(raw?: string): Record<string, string> {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function FeedEventCard({
  event,
  onOpen,
}: {
  event: UpdateEvent
  onOpen: () => void
}) {
  const { t, i18n } = useTranslation("feed")
  const payload = React.useMemo(
    () => parsePayload(event.payload_json),
    [event.payload_json],
  )

  return (
    <div
      onClick={onOpen}
      className="group flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-3.5 text-card-foreground shadow-2xs transition-all hover:border-border"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <EventIcon type={event.event_type} />
          <span className="truncate text-xs font-semibold text-foreground transition-colors group-hover:text-primary md:text-sm">
            {event.bookmark_external_id || event.bookmark_title}
          </span>
          <Badge
            variant="outline"
            className="h-4.5 px-1.5 text-[10px] font-normal"
          >
            {t(`eventType.${event.event_type}`)}
          </Badge>
        </div>

        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {new Date(event.detected_at).toLocaleTimeString(i18n.language, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {(payload.tag || payload.title || payload.commit) && (
        <p className="pl-6 text-xs text-muted-foreground">
          {payload.tag && (
            <span className="mr-1.5 font-mono font-medium text-foreground">
              {payload.tag}
            </span>
          )}
          {payload.title || payload.commit}
        </p>
      )}
    </div>
  )
}
