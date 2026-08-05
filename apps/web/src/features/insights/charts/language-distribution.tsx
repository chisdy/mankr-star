import { useTranslation } from "react-i18next"

import {
  CHART_PALETTE,
  LANG_COLORS,
  formatNumber,
} from "@/features/insights/format"

export function LanguageDistribution({
  languages,
}: {
  languages: Array<{ name: string; count: number }>
}) {
  const { t, i18n } = useTranslation(["insights", "common"])

  const displayName = (name: string) =>
    !name || name === "未知" ? t("common:unknown") : name

  const total = languages.reduce((sum, l) => sum + l.count, 0)
  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
        {t("charts.languageEmpty")}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted/60 p-0.5 ring-1 ring-border/40"
        role="img"
        aria-label={t("charts.languageAria", {
          total: formatNumber(total, i18n.language),
        })}
      >
        {languages.map((lang, idx) => {
          const pct = (lang.count / total) * 100
          const color =
            LANG_COLORS[lang.name] || CHART_PALETTE[idx % CHART_PALETTE.length]
          const name = displayName(lang.name)
          return (
            <div
              key={lang.name}
              style={{ width: `${pct}%`, backgroundColor: color }}
              className="h-full transition-all first:rounded-l-full last:rounded-r-full hover:brightness-110"
              title={`${name}: ${lang.count} (${Math.round(pct)}%)`}
            />
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {languages.map((lang, idx) => {
          const pct = Math.round((lang.count / total) * 100)
          const color =
            LANG_COLORS[lang.name] || CHART_PALETTE[idx % CHART_PALETTE.length]
          return (
            <div
              key={lang.name}
              className="flex items-center justify-between gap-1.5 rounded-md border border-border/40 bg-muted/30 p-2 transition-colors hover:bg-muted/50"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate font-medium text-foreground">
                  {displayName(lang.name)}
                </span>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {formatNumber(lang.count, i18n.language)}{" "}
                <span className="ml-0.5 font-semibold text-foreground/70">
                  ({pct}%)
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
