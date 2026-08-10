import type { ReactNode } from "react"
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ActivityIcon,
  CalendarBlankIcon,
  GitBranchIcon,
  PulseIcon,
} from "@phosphor-icons/react"
import type { UpdateEventType } from "@mankr/shared"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { DailyEventsChart } from "@/features/feed/charts/daily-events-chart"
import { EventTypeDistribution } from "@/features/feed/charts/event-type-distribution"
import { formatNumber } from "@/features/insights/format"
import { useRedirectGuestOnUnauthorized } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { InsightsRange } from "@/lib/types"

const RANGE_VALUES: InsightsRange[] = ["7d", "30d", "all"]

function MetricCard({
  label,
  value,
  icon,
  iconClass,
  footer,
}: {
  label: string
  value: string
  icon: ReactNode
  iconClass: string
  footer: ReactNode
}) {
  return (
    <Card size="sm" className="border-border/70 transition-colors hover:border-border">
      <CardContent className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-bold tracking-tight tabular-nums sm:text-2xl">
              {value}
            </p>
          </div>
          <div className={`shrink-0 rounded-lg p-1.5 sm:p-2 ${iconClass}`}>
            {icon}
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">{footer}</div>
      </CardContent>
    </Card>
  )
}

export function FeedStats({
  selectedEventType,
  onSelectEventType,
}: {
  selectedEventType: UpdateEventType | null
  onSelectEventType: (eventType: UpdateEventType | null) => void
}) {
  const { t, i18n } = useTranslation("feed")
  const [range, setRange] = React.useState<InsightsRange>("30d")
  const locale = i18n.language

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.feed.stats(range),
    queryFn: () => api.getFeedStats(range),
  })

  useRedirectGuestOnUnauthorized(isError ? (error as Error) : null)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div
          className="flex rounded-lg border border-border/80 bg-muted/30 p-1 shadow-2xs"
          role="tablist"
          aria-label={t("range.aria")}
        >
          {RANGE_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={range === value}
              onClick={() => setRange(value)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all active:scale-[0.98] sm:px-3 ${
                range === value
                  ? "border border-border/60 bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {t(`range.${value}`)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
          {t("stats.error")}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label={t("stats.totalEvents")}
              value={formatNumber(data.summary.total_events, locale)}
              icon={<PulseIcon className="size-4 sm:size-5" />}
              iconClass="bg-primary/10 text-primary"
              footer={t("stats.totalEventsFooter")}
            />
            <MetricCard
              label={t("stats.todayEvents")}
              value={formatNumber(data.summary.today_events, locale)}
              icon={<CalendarBlankIcon className="size-4 sm:size-5" />}
              iconClass="bg-sky-500/10 text-sky-600 dark:text-sky-400"
              footer={t("stats.todayEventsFooter")}
            />
            <MetricCard
              label={t("stats.activeBookmarks")}
              value={formatNumber(data.summary.active_bookmarks, locale)}
              icon={<GitBranchIcon className="size-4 sm:size-5" />}
              iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              footer={t("stats.activeBookmarksFooter")}
            />
            <MetricCard
              label={t("stats.trackedBookmarks")}
              value={formatNumber(data.summary.tracked_bookmarks, locale)}
              icon={<ActivityIcon className="size-4 sm:size-5" />}
              iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
              footer={t("stats.trackedBookmarksFooter")}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card size="sm" className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t("stats.byTypeTitle")}</CardTitle>
                <CardDescription className="text-[11px]">
                  {t("charts.typeFilterHint")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EventTypeDistribution
                  items={data.events_by_type}
                  selected={selectedEventType}
                  onSelect={onSelectEventType}
                />
              </CardContent>
            </Card>

            <Card size="sm" className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t("stats.dailyTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <DailyEventsChart daily={data.daily} />
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
