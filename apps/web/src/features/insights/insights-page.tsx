import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router"
import {
  ChartBarIcon,
  CpuIcon,
  DatabaseIcon,
  CoinsIcon,
  CheckCircleIcon,
  SparkleIcon,
  FolderIcon,
  TagIcon,
  ActivityIcon,
  ArrowSquareOutIcon,
  WarningCircleIcon,
  LightningIcon,
} from "@phosphor-icons/react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@workspace/ui/components/card"
import { DailyTokenChart } from "@/features/insights/charts/daily-token-chart"
import { DonutChart } from "@/features/insights/charts/donut-chart"
import { LanguageDistribution } from "@/features/insights/charts/language-distribution"
import { HealthDistribution } from "@/features/insights/charts/health-distribution"
import { CHART_PALETTE, formatCost, formatNumber } from "@/features/insights/format"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { InsightsRange, InsightsResponse } from "@/lib/types"

const RANGE_VALUES: InsightsRange[] = ["7d", "30d", "all"]

function parseRange(raw: string | null): InsightsRange {
  if (raw === "7d" || raw === "30d" || raw === "all") return raw
  return "30d"
}

function aiDoneRate(data: InsightsResponse): string {
  const { total } = data.library
  if (total === 0) return "0%"
  const done = data.library.ai_status.done ?? 0
  return `${Math.round((done / total) * 100)}%`
}

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
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
              {value}
            </p>
          </div>
          <div className={`rounded-lg p-2 ${iconClass}`}>{icon}</div>
        </div>
        <div className="text-[11px] text-muted-foreground">{footer}</div>
      </CardContent>
    </Card>
  )
}

function localizeFolderName(
  name: string,
  t: (key: string) => string,
): string {
  if (name === "未分类") return t("common:uncategorized")
  if (name === "未知" || name === "未知文件夹") return t("common:unknown")
  return name
}

export function InsightsPage() {
  const { t, i18n } = useTranslation(["insights", "common"])
  const [searchParams, setSearchParams] = useSearchParams()
  const range = parseRange(searchParams.get("range"))
  const locale = i18n.language

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.insights.range(range),
    queryFn: () => api.getInsights(range),
  })

  const setRange = (next: InsightsRange) => {
    const params = new URLSearchParams(searchParams)
    if (next === "30d") params.delete("range")
    else params.set("range", next)
    setSearchParams(params, { replace: true })
  }

  const folderMax =
    data && data.composition.folders.length > 0
      ? Math.max(...data.composition.folders.map((f) => f.count), 1)
      : 1

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ChartBarIcon className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("header.title")}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("header.description")}
          </p>
        </div>

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
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-all active:scale-[0.98] ${
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
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Skeleton className="h-64 rounded-xl lg:col-span-2" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      ) : isError || !data ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center text-sm text-destructive">
          {t("states.loadError")}
        </div>
      ) : (
        <>
          {data.library.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("states.libraryEmptyPrefix")}{" "}
              <Link
                to="/"
                className="text-foreground underline-offset-2 hover:underline"
              >
                {t("states.libraryEmptyLink")}
              </Link>{" "}
              {t("states.libraryEmptySuffix")}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard
              label={t("metrics.totalBookmarks")}
              value={formatNumber(data.library.total, locale)}
              icon={<DatabaseIcon className="size-5" />}
              iconClass="bg-primary/10 text-primary"
              footer={
                <span className="flex items-center gap-1.5">
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                    +{formatNumber(data.library.added_in_range, locale)}
                  </span>
                  <span>{t("metrics.addedInRange")}</span>
                </span>
              }
            />
            <MetricCard
              label={t("metrics.aiTokens")}
              value={formatNumber(data.ai.tokens.total, locale)}
              icon={<CpuIcon className="size-5" />}
              iconClass="bg-primary/10 text-primary"
              footer={
                <span className="flex justify-between font-mono">
                  <span>
                    {t("metrics.promptTokens", {
                      count: formatNumber(data.ai.tokens.prompt, locale),
                    })}
                  </span>
                  <span>
                    {t("metrics.completionTokens", {
                      count: formatNumber(data.ai.tokens.completion, locale),
                    })}
                  </span>
                </span>
              }
            />
            <MetricCard
              label={t("metrics.estimatedCost")}
              value={formatCost(
                data.ai.estimated_cost_usd,
                t("format.costNone"),
              )}
              icon={<CoinsIcon className="size-5" />}
              iconClass="bg-primary/10 text-primary"
              footer={
                <span className="flex items-center gap-1.5">
                  <span className="font-mono">
                    {t("metrics.calls", {
                      count: formatNumber(data.ai.calls, locale),
                    })}
                  </span>
                  <span>
                    {t("metrics.successFailure", {
                      ok: data.ai.ok,
                      error: data.ai.error,
                    })}
                  </span>
                </span>
              }
            />
            <MetricCard
              label={t("metrics.aiDoneRate")}
              value={aiDoneRate(data)}
              icon={<CheckCircleIcon className="size-5" />}
              iconClass="bg-primary/10 text-primary"
              footer={
                <span className="flex items-center gap-2">
                  <span>
                    {t("metrics.classified", {
                      count: data.library.ai_status.done ?? 0,
                    })}
                  </span>
                  <span>·</span>
                  <span>
                    {t("metrics.fallback", {
                      count: data.library.ai_status.fallback ?? 0,
                    })}
                  </span>
                </span>
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="border-b border-border/40 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <LightningIcon className="size-4 text-primary" />
                    <CardTitle className="text-sm font-semibold">
                      {t("sections.dailyTokensTitle")}
                    </CardTitle>
                  </div>
                  <span className="rounded bg-muted/60 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                    DeepSeek HTTP
                  </span>
                </div>
                <CardDescription className="text-xs">
                  {t("sections.dailyTokensDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <DailyTokenChart daily={data.ai.daily} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <SparkleIcon className="size-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">
                    {t("sections.aiKindTitle")}
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  {t("sections.aiKindDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <DonutChart
                  totalLabel={t("sections.totalCalls")}
                  totalValue={data.ai.calls}
                  items={data.ai.by_kind.map((k, i) => ({
                    label: t(`format.kind.${k.kind}`, {
                      defaultValue: k.kind,
                    }),
                    value: k.calls,
                    color: CHART_PALETTE[i % CHART_PALETTE.length],
                  }))}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <DatabaseIcon className="size-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">
                    {t("sections.languageTitle")}
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  {t("sections.languageDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <LanguageDistribution languages={data.composition.languages} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <ActivityIcon className="size-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">
                    {t("sections.healthTitle")}
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  {t("sections.healthDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <HealthDistribution health={data.composition.health} />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card>
              <CardHeader className="border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <FolderIcon className="size-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">
                    {t("sections.foldersTitle")}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                {data.composition.folders.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    {t("sections.foldersEmpty")}
                  </p>
                ) : (
                  <ul className="space-y-2.5 text-xs">
                    {data.composition.folders.slice(0, 6).map((f) => (
                      <li key={f.folder_id ?? f.name} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="truncate font-medium text-foreground">
                            {localizeFolderName(f.name, t)}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            {formatNumber(f.count, locale)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{
                              width: `${Math.max(6, (f.count / folderMax) * 100)}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <ArrowSquareOutIcon className="size-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">
                    {t("sections.topClickedTitle")}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                {data.engagement.top_clicked.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    {t("sections.topClickedEmpty")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border/50 text-xs">
                    {data.engagement.top_clicked.slice(0, 5).map((b, idx) => (
                      <li
                        key={b.id}
                        className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="w-3 font-mono font-bold text-muted-foreground/60">
                            #{idx + 1}
                          </span>
                          <Link
                            to={`/?q=${encodeURIComponent(b.external_id)}`}
                            className="truncate font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {b.title}
                          </Link>
                        </div>
                        <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {t("sections.clickCount", {
                            count: formatNumber(b.click_count, locale),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <TagIcon className="size-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">
                    {t("sections.tagsAndSyncTitle")}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-3 text-xs">
                <div>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    {t("sections.topTags")}
                  </p>
                  {data.engagement.top_tags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("sections.noTags")}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {data.engagement.top_tags.slice(0, 8).map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground"
                        >
                          #{tag.name}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {tag.usage_count}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-border/40 pt-3">
                  <p className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <WarningCircleIcon className="size-3.5 text-muted-foreground/80" />
                    <span>{t("sections.syncIssues")}</span>
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-center font-mono">
                    {(
                      [
                        ["Error", "error"],
                        ["404", "not_found"],
                        ["403", "forbidden"],
                      ] as const
                    ).map(([label, key]) => (
                      <div
                        key={key}
                        className="rounded border border-border/40 bg-muted/40 p-1.5"
                      >
                        <span className="block text-[10px] text-muted-foreground">
                          {label}
                        </span>
                        <span className="font-bold text-foreground">
                          {data.tracking.sync_issues[key] ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between border-t border-border/60 pt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <ActivityIcon className="size-3.5 text-primary" />
              <span>
                {t("sections.trackingSummary", {
                  tracked: data.tracking.tracked,
                  total: data.tracking.tracked + data.tracking.untracked,
                })}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span>
                {t("sections.aiDone", {
                  count: data.library.ai_status.done ?? 0,
                })}
              </span>
              <span>
                {t("sections.aiPending", {
                  count: data.library.ai_status.pending ?? 0,
                })}
              </span>
              <span>
                {t("sections.aiFailed", {
                  count: data.library.ai_status.failed ?? 0,
                })}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
