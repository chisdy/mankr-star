import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ArrowClockwiseIcon,
  CloudArrowDownIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { GithubImportResult, User } from "@/lib/types"

/** 从 GitHub Stars 批量导入；依赖上方已配置的 GitHub PAT */
export function GithubImportSection({ user }: { user: User | undefined }) {
  const { t } = useTranslation(["settings", "common", "errors"])
  const queryClient = useQueryClient()
  const [result, setResult] = React.useState<GithubImportResult | null>(null)
  const patConfigured = Boolean(user?.github_pat_configured)

  const importMutation = useMutation({
    mutationFn: (page?: number) =>
      api.importGithubStars(page ? { page } : undefined),
    onSuccess: (res) => {
      setResult(res)
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      toast.success(
        t("toasts.importSuccess", {
          imported: res.imported,
          skipped: res.skipped,
        }),
      )
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const handleImport = (page?: number) => {
    if (!patConfigured) {
      toast.error(t("import.patRequired"))
      return
    }
    importMutation.mutate(page)
  }

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("import.section")}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("import.description")}
        </p>
      </div>

      <div className="bg-card p-4 rounded-xl border border-border/60 space-y-3">
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
            onClick={() => handleImport()}
            disabled={importMutation.isPending || !patConfigured}
            className="text-xs gap-1.5 font-medium"
          >
            <CloudArrowDownIcon className="size-3.5" />
            <span>
              {importMutation.isPending
                ? t("common:actions.wait")
                : t("import.button")}
            </span>
          </Button>

          {result?.next_page != null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleImport(result.next_page!)}
              disabled={importMutation.isPending}
              className="text-xs gap-1.5"
            >
              <ArrowClockwiseIcon className="size-3.5" />
              <span>{t("import.continue", { page: result.next_page })}</span>
            </Button>
          )}
        </div>

        {result && (
          <p className="text-[11px] text-muted-foreground">
            {t("import.result", {
              imported: result.imported,
              skipped: result.skipped,
              pendingAi: result.pending_ai,
            })}
          </p>
        )}
      </div>
    </section>
  )
}
