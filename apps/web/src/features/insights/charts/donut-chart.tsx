import { SparkleIcon } from "@phosphor-icons/react"
import { useTranslation } from "react-i18next"

import { CHART_PALETTE, formatNumber } from "@/features/insights/format"

export function DonutChart({
  items,
  totalLabel,
  totalValue,
}: {
  items: Array<{ label: string; value: number; color?: string }>
  totalLabel: string
  totalValue: number
}) {
  const { t, i18n } = useTranslation("insights")

  const sum = items.reduce((acc, i) => acc + i.value, 0)
  if (sum === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
        <SparkleIcon className="mb-1 size-6 text-muted-foreground/40" />
        <span>{t("charts.donutEmpty")}</span>
      </div>
    )
  }

  let cumulativePercent = 0
  const size = 110
  const strokeWidth = 14
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const segments = items.map((item, idx) => {
    const percent = item.value / sum
    const strokeDasharray = `${percent * circumference} ${circumference}`
    const strokeDashoffset = -cumulativePercent * circumference
    cumulativePercent += percent
    return {
      ...item,
      color: item.color || CHART_PALETTE[idx % CHART_PALETTE.length],
      percent: Math.round(percent * 100),
      strokeDasharray,
      strokeDashoffset,
    }
  })

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div
        className="relative flex size-28 shrink-0 items-center justify-center"
        role="img"
        aria-label={t("charts.donutAria", {
          totalLabel,
          totalValue: formatNumber(totalValue, i18n.language),
        })}
      >
        <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted opacity-40"
          />
          {segments.map((seg) => (
            <circle
              key={seg.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={seg.strokeDasharray}
              strokeDashoffset={seg.strokeDashoffset}
              className="transition-opacity duration-300 hover:opacity-90"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            {totalLabel}
          </span>
          <span className="text-base font-bold tracking-tight tabular-nums">
            {formatNumber(totalValue, i18n.language)}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-2 text-xs">
        {segments.map((seg) => (
          <li
            key={seg.label}
            className="flex items-center justify-between gap-2 border-b border-border/30 pb-1.5 last:border-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full shadow-xs"
                style={{ backgroundColor: seg.color }}
              />
              <span className="truncate font-medium text-foreground">
                {seg.label}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 font-mono">
              <span className="text-muted-foreground">
                {t("charts.donutValue", {
                  count: formatNumber(seg.value, i18n.language),
                })}
              </span>
              <span className="w-10 rounded-xs bg-muted/60 px-1.5 py-0.5 text-right text-xs font-semibold text-foreground">
                {seg.percent}%
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
