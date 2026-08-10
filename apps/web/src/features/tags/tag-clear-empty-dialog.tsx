import * as React from "react"
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

export type TagClearEmptyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  emptyCount: number
}

export function TagClearEmptyDialog({
  open,
  onOpenChange,
  emptyCount,
}: TagClearEmptyDialogProps) {
  const { t } = useTranslation(["tags", "common", "errors"])
  const queryClient = useQueryClient()
  // 打开时冻结数量，避免弹窗停留期间列表刷新导致确认文案跳动
  const [confirmCount, setConfirmCount] = React.useState(emptyCount)

  React.useEffect(() => {
    if (open) setConfirmCount(emptyCount)
  }, [open, emptyCount])

  const clearMutation = useMutation({
    mutationFn: () => api.deleteEmptyTags(),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("clearEmpty.successToast", { count: result.deleted }))
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("clearEmpty.errorToast"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {t("clearEmpty.dialogTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("clearEmpty.confirm", { count: confirmCount })}
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
            disabled={confirmCount === 0 || clearMutation.isPending}
            onClick={() => clearMutation.mutate()}
            className="text-xs font-medium"
          >
            {clearMutation.isPending
              ? t("common:actions.wait")
              : t("clearEmpty.confirmDelete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
