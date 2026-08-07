import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { Tag } from "@/lib/types"

export type TagRenameDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag: Tag | null
}

export function TagRenameDialog({
  open,
  onOpenChange,
  tag,
}: TagRenameDialogProps) {
  const { t } = useTranslation(["tags", "common", "errors"])
  const queryClient = useQueryClient()
  const [name, setName] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setName(tag?.name ?? "")
  }, [open, tag?.id, tag?.name])

  const renameMutation = useMutation({
    mutationFn: () => {
      if (!tag) throw new Error(t("renameDialog.notSelected"))
      return api.updateTag(tag.id, { name: name.trim() })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("renameDialog.successToast"))
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("renameDialog.errorToast"))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !tag) return
    renameMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {t("renameDialog.title")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name" className="text-xs font-medium">
              {t("renameDialog.nameLabel")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("renameDialog.namePlaceholder")}
              maxLength={64}
              autoFocus
              className="h-9 text-sm"
            />
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
              type="submit"
              size="sm"
              disabled={!name.trim() || !tag || renameMutation.isPending}
              className="text-xs font-medium"
            >
              {renameMutation.isPending
                ? t("common:actions.wait")
                : t("common:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
