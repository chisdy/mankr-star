import { useTranslation } from "react-i18next"

import { formatNumber } from "@/features/insights/format"

const HEALTH_BAR: Record<string, string> = {
  hot: "bg-amber-500 dark:bg-amber-400",
  active: "bg-emerald-500 dark:bg-emerald-400",
  stale: "bg-zinc-400 dark:bg-zinc-500",
  archived: "bg-slate-500 dark:bg-slate-400",
  empty: "bg-slate-400 dark:bg-slate-500",
  unavailable: "bg-rose-500 dark:bg-rose-400",
  unknown: "bg-muted-foreground",
}

export function HealthDistribution({
  health,
}: {
  health: Array<{ status: string; label: string; count: number }>
}) {
  const { t } = useTranslation("insights")
  const { t: tBookmarks } = useTranslation("bookmarks")
  const { t: tCommon, i18n } = useTranslation("common")

  const total = health.reduce((sum, h) => sum + h.count, 0)
  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
        {t("charts.healthEmpty")}
      </div>
    )
  }

  const maxCount = Math.max(...health.map((h) => h.count), 1)

  return (
    <ul className="space-y-3 text-xs">
      {health.map((item) => {
        const fallback =
          !item.label || item.label === "未知"
            ? tCommon("unknown")
            : item.label
        const label = tBookmarks(`health.${item.status}`, {
          defaultValue: fallback,
        })
        const barClass = HEALTH_BAR[item.status] ?? HEALTH_BAR.unknown
        const pct = Math.round((item.count / total) * 100)
        const widthPct = Math.max(4, Math.round((item.count / maxCount) * 100))

        return (
          <li key={item.status} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${barClass}`} />
                <span className="font-medium text-foreground">{label}</span>
              </div>
              <div className="flex items-center gap-2 font-mono">
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
          </li>
        )
      })}
    </ul>
  )
}
