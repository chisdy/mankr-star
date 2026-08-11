import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CloudIcon, WarningCircleIcon } from "@phosphor-icons/react"
import {
  CF_QUOTA_CRITICAL_RATIO,
  CF_QUOTA_WARN_RATIO,
  type CloudflareQuotaMetric,
} from "@mankr/shared"

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { formatNumber } from "@/features/insights/format"

function barClass(ratio: number): string {
  if (ratio >= CF_QUOTA_CRITICAL_RATIO) return "bg-destructive"
  if (ratio >= CF_QUOTA_WARN_RATIO) return "bg-amber-500"
  return "bg-primary/70"
}

function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${formatNumber(bytes, locale)} B`
  if (bytes < 1024 * 1024) {
    return `${formatNumber(Math.round((bytes / 1024) * 10) / 10, locale)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10, locale)} MB`
  }
  return `${formatNumber(Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100, locale)} GB`
}

function QuotaBar({
  label,
  metric,
  formatValue,
  locale,
  remainingLabel,
}: {
  label: string
  metric: CloudflareQuotaMetric
  formatValue: (n: number) => string
  locale: string
  remainingLabel: string
}) {
  const pct = Math.min(100, Math.round(metric.ratio * 1000) / 10)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {formatValue(metric.used)} / {formatValue(metric.limit)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
        <div
          className={`h-full rounded-full transition-all ${barClass(metric.ratio)}`}
          style={{ width: `${Math.max(metric.used > 0 ? 2 : 0, pct)}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>
          {formatNumber(pct, locale)}% · {remainingLabel}
        </span>
      </div>
    </div>
  )
}

export function CloudflareQuotaSection() {
  const { t, i18n } = useTranslation(["insights", "common"])
  const locale = i18n.language

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.insights.cloudflareQuota,
    queryFn: () => api.getCloudflareQuota(),
    staleTime: 60_000,
  })

  return (
    <Card>
      <CardHeader className="border-b border-border/40 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CloudIcon className="size-4 text-primary" />
            <CardTitle className="text-sm font-semibold">
              {t("cloudflare.title")}
            </CardTitle>
          </div>
          {data?.configured ? (
            <span className="rounded bg-muted/60 px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {t("cloudflare.scopeAccount")}
            </span>
          ) : null}
        </div>
        <CardDescription className="text-xs">
          {t("cloudflare.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {error instanceof Error
                ? error.message
                : t("cloudflare.loadError")}
            </span>
          </div>
        ) : !data?.configured ? (
          <p className="text-xs text-muted-foreground">
            {t("cloudflare.unconfiguredPrefix")}{" "}
            <Link
              to="/settings"
              className="text-foreground underline-offset-2 hover:underline"
            >
              {t("cloudflare.settingsLink")}
            </Link>{" "}
            {t("cloudflare.unconfiguredSuffix")}
          </p>
        ) : (
          <div className="space-y-4">
            {data.stale ? (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                <WarningCircleIcon className="size-3.5" />
                {t("cloudflare.stale")}
              </p>
            ) : null}
            <QuotaBar
              label={t("cloudflare.workersRequests")}
              metric={data.workers.requests}
              formatValue={(n) => formatNumber(n, locale)}
              locale={locale}
              remainingLabel={t("cloudflare.remaining", {
                value: formatNumber(data.workers.requests.remaining, locale),
              })}
            />
            <QuotaBar
              label={t("cloudflare.d1RowsRead")}
              metric={data.d1.rows_read}
              formatValue={(n) => formatNumber(n, locale)}
              locale={locale}
              remainingLabel={t("cloudflare.remaining", {
                value: formatNumber(data.d1.rows_read.remaining, locale),
              })}
            />
            <QuotaBar
              label={t("cloudflare.d1RowsWritten")}
              metric={data.d1.rows_written}
              formatValue={(n) => formatNumber(n, locale)}
              locale={locale}
              remainingLabel={t("cloudflare.remaining", {
                value: formatNumber(data.d1.rows_written.remaining, locale),
              })}
            />
            <QuotaBar
              label={t("cloudflare.d1Storage")}
              metric={data.d1.storage_bytes}
              formatValue={(n) => formatBytes(n, locale)}
              locale={locale}
              remainingLabel={t("cloudflare.remaining", {
                value: formatBytes(data.d1.storage_bytes.remaining, locale),
              })}
            />
            <p className="border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
              {t("cloudflare.footnote", {
                asOf: new Date(data.as_of).toLocaleString(locale),
                cached: data.cached
                  ? t("cloudflare.cached")
                  : t("cloudflare.live"),
              })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
