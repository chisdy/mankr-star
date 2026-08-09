import { useTranslation } from "react-i18next"
import { CloudArrowDownIcon } from "@phosphor-icons/react"

import { useGithubImportJob } from "@/hooks/use-github-import-job"

/**
 * 离开设置页后仍可见的导入进度条（挂在 AppShell）。
 */
export function GithubImportBanner() {
  const { t } = useTranslation("settings")
  const { job, isActive } = useGithubImportJob()

  if (!isActive || !job) return null

  const pct =
    job.total > 0
      ? Math.min(100, Math.round((job.processed / job.total) * 100))
      : 0

  return (
    <div className="border-b border-border/60 bg-muted/40 px-3 py-2 md:px-4">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <CloudArrowDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-[11px] text-muted-foreground">
            {job.phase === "discover"
              ? t("import.discovering")
              : t("import.progress", {
                  processed: job.processed,
                  total: job.total,
                  current: job.current_title || "—",
                })}
          </p>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${job.total > 0 ? pct : 8}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {job.total > 0 ? `${pct}%` : "…"}
        </span>
      </div>
    </div>
  )
}
