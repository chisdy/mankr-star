import * as React from "react"
import { ChartBarIcon, ClockIcon } from "@phosphor-icons/react"
import { useTranslation } from "react-i18next"

import { formatNumber } from "@/features/insights/format"
import type { FeedStatsResponse } from "@/lib/types"

function formatChartDate(dateStr: string, locale: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function DailyEventsChart({
  daily,
}: {
  daily: FeedStatsResponse["daily"]
}) {
  const { t, i18n } = useTranslation("feed")
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null)
  const locale = i18n.language

  if (daily.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 py-10 text-center">
        <ChartBarIcon className="mb-2 size-7 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">
          {t("charts.dailyEmptyTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          {t("charts.dailyEmptyDescription")}
        </p>
      </div>
    )
  }

  const maxCount = Math.max(...daily.map((d) => d.count), 1)

  return (
    <div className="space-y-3">
      <div className="flex min-h-[24px] items-center justify-between text-xs">
        {hoverIndex !== null && daily[hoverIndex] ? (
          <div className="flex items-center gap-2 rounded bg-accent/60 px-2 py-0.5 font-mono text-accent-foreground">
            <span className="font-medium">
              {formatChartDate(daily[hoverIndex].date, locale)}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-semibold text-primary">
              {t("charts.dailyHover", {
                count: formatNumber(daily[hoverIndex].count, locale),
              })}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <ClockIcon className="size-3.5 text-primary/70" />
            <span>{t("charts.dailySummary", { count: daily.length })}</span>
          </div>
        )}
        <span className="font-mono text-[11px] text-muted-foreground">
          {t("charts.dailyPeak", {
            count: formatNumber(maxCount, locale),
          })}
        </span>
      </div>

      <div
        className="relative flex h-[100px] w-full items-end gap-0.5 border-b border-border/60 px-1 pt-2 pb-1 sm:gap-1"
        role="img"
        aria-label={t("charts.dailyAria", {
          count: daily.length,
          peak: formatNumber(maxCount, locale),
        })}
      >
        {daily.map((d, idx) => {
          const heightPct = Math.max(
            d.count > 0 ? 6 : 2,
            Math.round((d.count / maxCount) * 100),
          )
          const isHovered = hoverIndex === idx
          const detail = t("charts.dailyBarDetail", {
            date: formatChartDate(d.date, locale),
            count: formatNumber(d.count, locale),
          })
          return (
            <div
              key={d.date}
              className="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end"
              onMouseEnter={() => setHoverIndex(idx)}
              onMouseLeave={() => setHoverIndex(null)}
              onFocus={() => setHoverIndex(idx)}
              onBlur={() => setHoverIndex(null)}
            >
              <div
                role="img"
                tabIndex={0}
                aria-label={detail}
                title={detail}
                className={`w-full max-w-[20px] rounded-t-xs transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  d.count === 0
                    ? "bg-muted-foreground/20"
                    : isHovered
                      ? "scale-x-105 bg-primary opacity-100 shadow-sm"
                      : "bg-primary/70 opacity-80 hover:bg-primary/90"
                }`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          )
        })}
      </div>

      <div className="flex justify-between px-1 font-mono text-[10px] text-muted-foreground">
        <span>
          {daily[0] ? formatChartDate(daily[0].date, locale) : null}
        </span>
        {daily.length > 2 ? (
          <span>
            {formatChartDate(
              daily[Math.floor(daily.length / 2)]!.date,
              locale,
            )}
          </span>
        ) : null}
        <span>
          {daily[daily.length - 1]
            ? formatChartDate(daily[daily.length - 1]!.date, locale)
            : null}
        </span>
      </div>
    </div>
  )
}
