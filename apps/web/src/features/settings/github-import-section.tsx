import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  CloudArrowDownIcon,
  XIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { useGithubImportJob } from "@/hooks/use-github-import-job"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { User } from "@/lib/types"

function ImportProgressBar({
  processed,
  total,
}: {
  processed: number
  total: number
}) {
  const pct =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
        style={{ width: `${total > 0 ? pct : 8}%` }}
      />
    </div>
  )
}

/** 从 GitHub Stars 批量导入；依赖上方已配置的 GitHub PAT */
export function GithubImportSection({ user }: { user: User | undefined }) {
  const { t } = useTranslation(["settings", "common", "errors"])
  const queryClient = useQueryClient()
  const patConfigured = Boolean(user?.github_pat_configured)
  const { job, isActive } = useGithubImportJob()
  const seenFinishedId = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!job) return
    if (job.status !== "completed" && job.status !== "failed") return
    if (seenFinishedId.current === job.id) return
    // 仅提示本会话启动后结束的任务（避免刷新设置页重复 toast）
    if (!job.finished_at) return
    const finishedAt = Date.parse(job.finished_at)
    if (!Number.isFinite(finishedAt) || Date.now() - finishedAt > 60_000) {
      seenFinishedId.current = job.id
      return
    }
    seenFinishedId.current = job.id
    if (job.status === "completed") {
      toast.success(
        t("toasts.importFinished", {
          imported: job.imported,
          skipped: job.skipped,
          failed: job.failed_count,
        }),
      )
    } else {
      toast.error(job.last_error || t("toasts.importFailed"))
    }
  }, [job, t])

  const importMutation = useMutation({
    mutationFn: () => api.importGithubStars(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.import.githubActive,
      })
      toast.success(t("toasts.importStarted"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelGithubImport(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.import.githubActive,
      })
      toast.success(t("toasts.importCancelled"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const handleImport = () => {
    if (!patConfigured) {
      toast.error(t("import.patRequired"))
      return
    }
    importMutation.mutate()
  }

  const showProgress = Boolean(job && (isActive || job.total > 0))

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("import.section")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("import.description")}
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
        {!patConfigured && (
          <p className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <WarningCircleIcon className="size-3.5 shrink-0" />
            <span>{t("import.patRequired")}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleImport}
            disabled={
              importMutation.isPending || !patConfigured || isActive
            }
            className="gap-1.5 text-xs font-medium"
          >
            <CloudArrowDownIcon className="size-3.5" />
            <span>
              {importMutation.isPending || isActive
                ? t("common:actions.wait")
                : t("import.button")}
            </span>
          </Button>

          {isActive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="gap-1.5 text-xs"
            >
              <XIcon className="size-3.5" />
              <span>{t("import.cancel")}</span>
            </Button>
          ) : null}
        </div>

        {showProgress && job ? (
          <div className="space-y-2">
            <ImportProgressBar
              processed={job.processed}
              total={job.total}
            />
            <p className="text-[11px] text-muted-foreground">
              {isActive
                ? job.phase === "discover"
                  ? t("import.discovering")
                  : t("import.progress", {
                      processed: job.processed,
                      total: job.total,
                      current: job.current_title || "—",
                    })
                : t("import.result", {
                    imported: job.imported,
                    skipped: job.skipped,
                    failed: job.failed_count,
                    status: job.status,
                  })}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
