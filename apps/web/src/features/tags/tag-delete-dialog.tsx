import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { Tag } from "@/lib/types"

export type TagDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag: Tag | null
}

export function TagDeleteDialog({
  open,
  onOpenChange,
  tag,
}: TagDeleteDialogProps) {
  const { t } = useTranslation(["tags", "common", "errors"])
  const queryClient = useQueryClient()
  const count = tag?.count ?? 0

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!tag) throw new Error(t("deleteDialog.notSelected"))
      return api.deleteTag(tag.id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("deleteDialog.successToast"))
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("deleteDialog.errorToast"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {t("deleteDialog.title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {tag
              ? count > 0
                ? t("deleteDialog.confirmWithCount", {
                    tagName: tag.name,
                    count,
                  })
                : t("deleteDialog.confirm", { tagName: tag.name })
              : null}
          </DialogDescription>
        </DialogHeader>

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
            variant="destructive"
            size="sm"
            disabled={!tag || deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            className="text-xs font-medium"
          >
            {deleteMutation.isPending
              ? t("common:actions.wait")
              : t("deleteDialog.confirmDelete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
