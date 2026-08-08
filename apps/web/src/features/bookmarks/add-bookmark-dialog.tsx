import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { FolderSelect } from "@/features/folders/folder-select"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"

interface AddBookmarkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 外部带来的链接（浏览器扩展 `?add=`），打开时预填到地址框 */
  initialUrl?: string
}

export function AddBookmarkDialog({
  open,
  onOpenChange,
  initialUrl,
}: AddBookmarkDialogProps) {
  const { t } = useTranslation(["bookmarks", "common", "errors"])
  const queryClient = useQueryClient()
  const [url, setUrl] = React.useState("")
  const [folderId, setFolderId] = React.useState<string>("")
  const [notes, setNotes] = React.useState("")

  React.useEffect(() => {
    if (open && initialUrl) setUrl(initialUrl)
  }, [open, initialUrl])

  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: queryKeys.folders.all,
    queryFn: () => api.getFolders(),
    enabled: open,
  })

  const addMutation = useMutation({
    mutationFn: () =>
      api.createBookmark({
        url: url.trim(),
        folder_id: folderId || null,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (bookmark) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      // 手动指定文件夹时立刻刷新计数；AI 自动归类则由 useRefreshFoldersOnAiComplete 在完成后刷新
      if (bookmark.folder_id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      toast.success(t("add.toastSuccess"))
      setUrl("")
      setFolderId("")
      setNotes("")
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("add.toastError"))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    addMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{t("add.title")}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("add.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="url" className="text-xs font-medium">
              {t("add.urlLabel")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="url"
              placeholder={t("add.urlPlaceholder")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-9 text-xs md:text-sm"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="folder" className="text-xs font-medium">
              {t("add.folderLabel")}
            </Label>
            <FolderSelect
              id="folder"
              folders={folders}
              value={folderId || null}
              onValueChange={(id) => setFolderId(id || "")}
              noneLabel={t("add.folderNone")}
              isLoading={foldersLoading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs font-medium">
              {t("add.notesLabel")}
            </Label>
            <Textarea
              id="notes"
              placeholder={t("add.notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px] resize-none text-xs md:text-sm"
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
              disabled={!url.trim() || addMutation.isPending}
              className="text-xs font-medium"
            >
              {addMutation.isPending ? t("common:actions.wait") : t("add.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
