import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { FOLDER_COLOR_PRESETS } from "@mankr/shared"
import { Button } from "@workspace/ui/components/button"
import { ColorPicker } from "@workspace/ui/components/color-picker"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { FolderSelect } from "@/features/folders/folder-select"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { Folder } from "@/lib/types"

const DEFAULT_FOLDER_COLOR = "#4A7BB0"
const SLUG_SUGGEST_DEBOUNCE_MS = 500

export type FolderFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑时传入；新建时为 null */
  folder?: Folder | null
  /** 新建时的默认父级 */
  defaultParentId?: string | null
  folders: Folder[]
}

export function FolderFormDialog({
  open,
  onOpenChange,
  folder = null,
  defaultParentId = null,
  folders,
}: FolderFormDialogProps) {
  const { t } = useTranslation(["folders", "common", "errors"])
  const queryClient = useQueryClient()
  const editingFolder = folder

  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugDirty, setSlugDirty] = React.useState(false)
  const [slugSuggesting, setSlugSuggesting] = React.useState(false)
  const [color, setColor] = React.useState(DEFAULT_FOLDER_COLOR)
  const [description, setDescription] = React.useState("")
  const [moveParentId, setMoveParentId] = React.useState<string>("")
  const suggestSeq = React.useRef(0)

  React.useEffect(() => {
    if (!open) return
    if (editingFolder) {
      setName(editingFolder.name)
      setSlug(editingFolder.slug)
      setSlugDirty(false)
      setColor(editingFolder.color || DEFAULT_FOLDER_COLOR)
      setDescription(editingFolder.description || "")
      setMoveParentId(editingFolder.parent_id || "")
    } else {
      setName("")
      setSlug("")
      setSlugDirty(false)
      setColor(DEFAULT_FOLDER_COLOR)
      setDescription("")
      setMoveParentId(defaultParentId || "")
    }
  }, [open, editingFolder, defaultParentId])

  const requestSuggestSlug = React.useCallback(
    async (folderName: string, parentId: string | null) => {
      const trimmed = folderName.trim()
      if (!trimmed) return
      const seq = ++suggestSeq.current
      setSlugSuggesting(true)
      try {
        const res = await api.suggestFolderSlug({
          name: trimmed,
          parent_id: parentId,
          exclude_id: editingFolder?.id ?? null,
        })
        if (seq !== suggestSeq.current) return
        if (!slugDirty) {
          setSlug(res.slug)
        }
      } catch {
        /* 忽略建议失败，用户可手填或保存时由服务端生成 */
      } finally {
        if (seq === suggestSeq.current) setSlugSuggesting(false)
      }
    },
    [editingFolder?.id, slugDirty],
  )

  // 新建：名称防抖后建议 slug（未 dirty 时）
  React.useEffect(() => {
    if (!open || editingFolder || slugDirty) return
    const trimmed = name.trim()
    if (!trimmed) {
      setSlug("")
      return
    }
    const timer = window.setTimeout(() => {
      void requestSuggestSlug(trimmed, moveParentId || null)
    }, SLUG_SUGGEST_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [open, editingFolder, name, moveParentId, slugDirty, requestSuggestSlug])

  const excludeIds = React.useMemo(() => {
    if (!editingFolder) return undefined
    return new Set(
      folders
        .filter((f) => f.path.startsWith(editingFolder.path))
        .map((f) => f.id),
    )
  }, [folders, editingFolder])

  const saveMutation = useMutation({
    mutationFn: () => {
      if (editingFolder) {
        return api.updateFolder(editingFolder.id, {
          name: name.trim(),
          ...(slugDirty ? { slug: slug.trim() } : {}),
          color,
          description: description.trim(),
          parent_id: moveParentId || null,
        })
      }
      return api.createFolder({
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        color,
        description: description.trim(),
        parent_id: moveParentId || null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(
        editingFolder ? t("form.updatedToast") : t("form.createdToast"),
      )
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("form.errorToast"))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    saveMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {editingFolder ? t("form.editTitle") : t("form.createTitle")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name" className="text-xs font-medium">
              {t("form.nameLabel")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("form.namePlaceholder")}
              className="h-9 text-xs md:text-sm"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="folder-parent" className="text-xs font-medium">
              {t("form.parentLabel")}
            </Label>
            <FolderSelect
              id="folder-parent"
              folders={folders}
              value={moveParentId || null}
              onValueChange={(id) => setMoveParentId(id || "")}
              noneLabel={t("form.root")}
              excludeIds={excludeIds}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="folder-slug" className="text-xs font-medium">
                {t("form.slugLabel")}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 gap-1 text-[11px] text-muted-foreground"
                disabled={!name.trim() || slugSuggesting}
                onClick={() => {
                  const trimmed = name.trim()
                  if (!trimmed) return
                  const seq = ++suggestSeq.current
                  setSlugSuggesting(true)
                  void api
                    .suggestFolderSlug({
                      name: trimmed,
                      parent_id: moveParentId || null,
                      exclude_id: editingFolder?.id ?? null,
                    })
                    .then((res) => {
                      if (seq !== suggestSeq.current) return
                      setSlug(res.slug)
                      setSlugDirty(false)
                    })
                    .catch(() => {})
                    .finally(() => {
                      if (seq === suggestSeq.current) setSlugSuggesting(false)
                    })
                }}
              >
                <ArrowClockwiseIcon
                  className={`size-3 ${slugSuggesting ? "animate-spin" : ""}`}
                />
                {t("form.generateSlug")}
              </Button>
            </div>
            <Input
              id="folder-slug"
              value={slug}
              onChange={(e) => {
                setSlugDirty(true)
                setSlug(e.target.value.toLowerCase())
              }}
              placeholder="agent-skills"
              className="h-9 font-mono text-xs md:text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              {t("form.slugHelp")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="folder-color" className="text-xs font-medium">
              {t("form.colorLabel")}
            </Label>
            <ColorPicker
              id="folder-color"
              value={color}
              onValueChange={setColor}
              presets={FOLDER_COLOR_PRESETS}
              aria-label={t("form.colorAria")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="folder-desc" className="text-xs font-medium">
              {t("form.descriptionLabel")}
            </Label>
            <Textarea
              id="folder-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("form.descriptionPlaceholder")}
              className="min-h-[70px] resize-none text-xs"
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
              disabled={!name.trim() || saveMutation.isPending}
              className="text-xs font-medium"
            >
              {saveMutation.isPending
                ? t("common:actions.wait")
                : editingFolder
                  ? t("form.submitSave")
                  : t("form.submitCreate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
