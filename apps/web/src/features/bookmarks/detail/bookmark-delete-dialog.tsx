import { useTranslation } from "react-i18next"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

/** 删除收藏的二次确认。叠在详情弹窗之上。 */
export function BookmarkDeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  pending: boolean
  title: string
}) {
  const { t } = useTranslation(["bookmarks", "common"])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("detail.deleteConfirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("detail.deleteConfirmBody", { title })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="h-8 text-xs"
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={pending}
            className="h-8 text-xs font-medium"
          >
            {pending ? t("common:actions.wait") : t("common:actions.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
