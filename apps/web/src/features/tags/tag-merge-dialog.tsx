import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { FacetSelect } from "@/features/bookmarks/owner-select"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { Tag } from "@/lib/types"

export type TagMergeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sources: Tag[]
  candidates: Tag[]
  onMerged?: () => void
}

function resultUsageCount(result: unknown): number | null {
  if (!result || typeof result !== "object") return null
  if ("count" in result && typeof result.count === "number") return result.count
  if (
    "target" in result &&
    result.target &&
    typeof result.target === "object" &&
    "usage_count" in result.target &&
    typeof result.target.usage_count === "number"
  ) {
    return result.target.usage_count
  }
  return null
}

export function TagMergeDialog({
  open,
  onOpenChange,
  sources,
  candidates,
  onMerged,
}: TagMergeDialogProps) {
  const { t } = useTranslation(["tags", "common", "errors"])
  const queryClient = useQueryClient()
  const [targetId, setTargetId] = React.useState("")

  const sourceIdSet = React.useMemo(
    () => new Set(sources.map((tag) => tag.id)),
    [sources],
  )

  const options = React.useMemo(
    () => candidates.filter((tag) => !sourceIdSet.has(tag.id)),
    [candidates, sourceIdSet],
  )

  const facetItems = React.useMemo(
    () =>
      options.map((tag) => ({
        name: tag.name,
        usage_count: tag.count,
      })),
    [options],
  )

  const selectedName =
    options.find((tag) => tag.id === targetId)?.name ?? null

  const sourcesKey = sources.map((tag) => tag.id).join(",")
  const sourceIds = React.useMemo(
    () => sources.map((tag) => tag.id),
    [sources],
  )

  React.useEffect(() => {
    if (!open) return
    setTargetId("")
  }, [open, sourcesKey])

  const hasSources = sources.length > 0
  const hasTargets = options.length > 0

  const previewQuery = useQuery({
    queryKey: ["tags", "merge-preview", sourcesKey, targetId] as const,
    queryFn: () => api.previewMergeTags(sourceIds, targetId),
    enabled: open && hasSources && Boolean(targetId),
  })

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!hasSources || !targetId) throw new Error(t("mergeDialog.notSelected"))
      if (sourceIds.length === 1) {
        return api.mergeTags(sourceIds[0]!, targetId)
      }
      return api.batchTags(sourceIds, { type: "merge", targetId })
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.tags.all,
          refetchType: "all",
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.bookmarks.all,
          refetchType: "all",
        }),
      ])
      if (
        result &&
        typeof result === "object" &&
        "failed" in result &&
        Array.isArray(result.failed) &&
        result.failed.length > 0
      ) {
        toast.error(
          t("batch.partialToast", {
            processed: result.processed,
            failed: result.failed.length,
          }),
        )
      } else {
        const usageCount = resultUsageCount(result)
        toast.success(
          usageCount != null
            ? t("mergeDialog.successToastWithCount", { count: usageCount })
            : t("mergeDialog.successToast"),
        )
      }
      onMerged?.()
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("mergeDialog.errorToast"))
    },
  })

  const preview = previewQuery.data
  const showOverlapHint =
    preview != null && preview.additive_count > preview.unique_count

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {t("mergeDialog.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {sources.length === 1
              ? t("mergeDialog.description", {
                  tagName: sources[0]?.name ?? "",
                })
              : t("mergeDialog.descriptionBatch", {
                  count: sources.length,
                })}
          </p>
          {!hasTargets ? (
            <p className="text-xs leading-relaxed text-destructive">
              {t("mergeDialog.noTarget")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium">
                {t("mergeDialog.targetLabel")}
              </Label>
              <FacetSelect
                items={facetItems}
                value={selectedName}
                onValueChange={(name) => {
                  if (!name) {
                    setTargetId("")
                    return
                  }
                  const tag = options.find((item) => item.name === name)
                  setTargetId(tag?.id ?? "")
                }}
                fullWidth
                size="sm"
                variant="tag"
                showAllOption={false}
                allLabel={t("mergeDialog.targetPlaceholder")}
                searchPlaceholder={t("searchPlaceholder")}
                loadingLabel={t("common:actions.wait")}
                noMatchLabel={t("emptySearch")}
                contentClassName="z-[60]"
              />
            </div>
          )}

          {targetId && preview ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {showOverlapHint
                ? t("mergeDialog.previewOverlap", {
                    additive: preview.additive_count,
                    unique: preview.unique_count,
                  })
                : t("mergeDialog.previewUnique", {
                    count: preview.unique_count,
                  })}
            </p>
          ) : null}
        </div>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              !hasSources ||
              !hasTargets ||
              !targetId ||
              mergeMutation.isPending
            }
            className="text-xs font-medium"
            onClick={() => mergeMutation.mutate()}
          >
            {mergeMutation.isPending
              ? t("common:actions.wait")
              : t("mergeDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
