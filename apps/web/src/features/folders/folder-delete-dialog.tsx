import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"
import { FolderSelect } from "@/features/folders/folder-select"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { childrenOf } from "@/lib/folder-utils"
import { queryKeys } from "@/lib/query-keys"
import type { Folder } from "@/lib/types"

export type BookmarkDisposition = "detach" | "delete" | "move"

export type FolderDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: Folder | null
  folders: Folder[]
  onDeleted?: (folderId: string) => void
}

export function FolderDeleteDialog({
  open,
  onOpenChange,
  folder,
  folders,
  onDeleted,
}: FolderDeleteDialogProps) {
  const { t } = useTranslation(["folders", "common", "errors"])
  const queryClient = useQueryClient()
  const childFolders = React.useMemo(
    () => (folder ? childrenOf(folder.id, folders) : []),
    [folder, folders],
  )
  const hasChildren = childFolders.length > 0
  const bookmarkCount = folder?.count ?? 0
  const hasBookmarks = !hasChildren && bookmarkCount > 0

  const [disposition, setDisposition] =
    React.useState<BookmarkDisposition>("detach")
  const [moveToFolderId, setMoveToFolderId] = React.useState<string>("")

  React.useEffect(() => {
    if (!open) return
    setDisposition("detach")
    setMoveToFolderId("")
  }, [open, folder?.id])

  const moveExcludeIds = React.useMemo(
    () => (folder ? new Set([folder.id]) : undefined),
    [folder],
  )

  const dispositionOptions = React.useMemo(
    () =>
      [
        {
          value: "detach" as const,
          title: t("deleteDialog.dispositionDetachTitle"),
          description: t("deleteDialog.dispositionDetachDescription"),
        },
        {
          value: "delete" as const,
          title: t("deleteDialog.dispositionDeleteTitle"),
          description: t("deleteDialog.dispositionDeleteDescription"),
        },
        {
          value: "move" as const,
          title: t("deleteDialog.dispositionMoveTitle"),
          description: t("deleteDialog.dispositionMoveDescription"),
        },
      ] satisfies Array<{
        value: BookmarkDisposition
        title: string
        description: string
      }>,
    [t],
  )

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!folder) throw new Error(t("deleteDialog.notSelected"))
      return api.deleteFolder(folder.id, {
        bookmarkAction: hasBookmarks ? disposition : "detach",
        moveToFolderId:
          hasBookmarks && disposition === "move" ? moveToFolderId : undefined,
      })
    },
    onSuccess: () => {
      if (!folder) return
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("deleteDialog.successToast"))
      onOpenChange(false)
      onDeleted?.(folder.id)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("deleteDialog.errorToast"))
    },
  })

  const canSubmit =
    Boolean(folder) &&
    !hasChildren &&
    (!hasBookmarks || disposition !== "move" || Boolean(moveToFolderId))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {hasChildren
              ? t("deleteDialog.blockedTitle")
              : t("deleteDialog.title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {folder
              ? hasChildren
                ? t("deleteDialog.hasChildrenDescription", {
                    folderName: folder.name,
                    count: childFolders.length,
                  })
                : hasBookmarks
                  ? t("deleteDialog.hasBookmarksDescription", {
                      folderName: folder.name,
                      count: bookmarkCount,
                    })
                  : t("deleteDialog.confirmDescription", {
                      folderName: folder.name,
                    })
              : null}
          </DialogDescription>
        </DialogHeader>

        {hasChildren && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {childFolders.map((child) => (
              <li key={child.id} className="truncate text-foreground">
                {child.name}
              </li>
            ))}
          </ul>
        )}

        {hasBookmarks && (
          <div
            className="space-y-3 py-1"
            role="radiogroup"
            aria-label={t("deleteDialog.dispositionAria")}
          >
            {dispositionOptions.map((option) => {
              const selected = disposition === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDisposition(option.value)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-primary bg-accent/60"
                      : "border-border/70 hover:bg-muted/50",
                  )}
                >
                  <div className="text-sm font-medium text-foreground">
                    {option.title}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </button>
              )
            })}

            {disposition === "move" && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="move-target" className="text-xs font-medium">
                  {t("deleteDialog.targetLabel")}
                </Label>
                <FolderSelect
                  id="move-target"
                  folders={folders}
                  value={moveToFolderId || null}
                  onValueChange={(id) => setMoveToFolderId(id || "")}
                  excludeIds={moveExcludeIds}
                />
                {folders.filter((f) => f.id !== folder?.id).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("deleteDialog.noMoveTarget")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="pt-2">
          {hasChildren ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs font-medium"
            >
              {t("deleteDialog.acknowledge")}
            </Button>
          ) : (
            <>
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
                disabled={!canSubmit || deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                className="text-xs font-medium"
              >
                {deleteMutation.isPending
                  ? t("common:actions.wait")
                  : t("deleteDialog.confirmDelete")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
