import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { WarningCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
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

/** 不做多语言化：确认口令须与用户实际输入的字符一一对应，翻译反而会造成困惑 */
const CONFIRM_PHRASE = "CLEAR"

/** 清空全部业务数据：需在弹窗内手动输入确认口令，防止误触 */
export function ClearDataSection() {
  const { t } = useTranslation(["settings", "common", "errors"])
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [confirmText, setConfirmText] = React.useState("")

  const clearMutation = useMutation({
    mutationFn: () => api.clearData(),
    onSuccess: () => {
      queryClient.clear()
      window.location.href = "/login"
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  React.useEffect(() => {
    if (!open) setConfirmText("")
  }, [open])

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-destructive flex items-center gap-1.5">
          <WarningCircleIcon className="size-4" />
          <span>{t("danger.section")}</span>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("danger.description")}
        </p>
      </div>

      <div className="bg-card p-4 rounded-xl border border-destructive/30 flex items-center justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <div className="text-xs font-medium">{t("danger.clearTitle")}</div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("danger.foldersNote")}
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setOpen(true)}
          className="text-xs font-medium shrink-0"
        >
          {t("danger.button")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-destructive">
              {t("danger.confirmTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("danger.confirmDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="clearConfirm" className="text-xs font-medium">
              {t("danger.confirmLabel", { phrase: CONFIRM_PHRASE })}
            </Label>
            <Input
              id="clearConfirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              className="h-9 text-xs font-mono"
              autoComplete="off"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={clearMutation.isPending}
              className="text-xs"
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={confirmText !== CONFIRM_PHRASE || clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
              className="text-xs font-medium"
            >
              {clearMutation.isPending
                ? t("common:actions.wait")
                : t("danger.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
