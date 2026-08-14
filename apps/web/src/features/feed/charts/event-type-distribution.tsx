import { useTranslation } from "react-i18next"
import type { UpdateEventType } from "@mankr/shared"

import { EmptyState } from "@/components/empty-state"
import { formatNumber } from "@/features/insights/format"

const TYPE_COLOR: Record<string, string> = {
  push: "bg-sky-500 dark:bg-sky-400",
  release: "bg-emerald-500 dark:bg-emerald-400",
  stars_delta: "bg-amber-500 dark:bg-amber-400",
  meta_change: "bg-violet-500 dark:bg-violet-400",
}

export function EventTypeDistribution({
  items,
  selected,
  onSelect,
}: {
  items: Array<{ event_type: string; count: number }>
  selected?: string | null
  onSelect: (eventType: UpdateEventType | null) => void
}) {
  const { t, i18n } = useTranslation("feed")
  const total = items.reduce((sum, item) => sum + item.count, 0)

  if (total === 0) {
    return <EmptyState>{t("charts.typeEmpty")}</EmptyState>
  }

  const maxCount = Math.max(...items.map((item) => item.count), 1)

  return (
    <ul className="space-y-3 text-xs">
      {items.map((item) => {
        const type = item.event_type as UpdateEventType
        const label = t(`eventType.${type}`, { defaultValue: item.event_type })
        const barClass = TYPE_COLOR[item.event_type] ?? "bg-muted-foreground"
        const pct = Math.round((item.count / total) * 100)
        const widthPct = Math.max(
          item.count > 0 ? 4 : 0,
          Math.round((item.count / maxCount) * 100),
        )
        const isActive = selected === item.event_type

        return (
          <li key={item.event_type} className="space-y-1">
            <button
              type="button"
              onClick={() => onSelect(isActive ? null : type)}
              title={t("charts.typeFilterHint")}
              className={`-mx-1.5 block w-[calc(100%+0.75rem)] space-y-1 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-muted/50 ${
                isActive ? "bg-muted/60 ring-1 ring-border" : ""
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${barClass}`}
                  />
                  <span className="truncate font-medium text-foreground">
                    {label}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 font-mono">
                  <span className="text-muted-foreground">
                    {formatNumber(item.count, i18n.language)}
                  </span>
                  <span className="w-8 text-right text-[11px] font-semibold text-foreground/80">
                    {pct}%
                  </span>
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${barClass}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
