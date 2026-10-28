import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

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
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { FolderSelect } from "@/features/folders/folder-select"
import { FolderSlugSuggestButton } from "@/features/folders/folder-slug-suggest-button"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { Folder } from "@/lib/types"

const DEFAULT_FOLDER_COLOR = "#4A7BB0"
const SLUG_SUGGEST_DEBOUNCE_MS = 500

type SlugHint = "ai" | "fallback" | "unchanged" | "kept"

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
  const [slugHint, setSlugHint] = React.useState<SlugHint | null>(null)
  const [color, setColor] = React.useState(DEFAULT_FOLDER_COLOR)
  const [description, setDescription] = React.useState("")
  const [moveParentId, setMoveParentId] = React.useState<string>("")
  const suggestSeq = React.useRef(0)
  const slugDirtyRef = React.useRef(false)
  const slugRef = React.useRef("")
  const descriptionRef = React.useRef("")

  React.useEffect(() => {
    slugDirtyRef.current = slugDirty
    slugRef.current = slug
    descriptionRef.current = description
  }, [slugDirty, slug, description])

  React.useEffect(() => {
    if (!open) return
    if (editingFolder) {
      setName(editingFolder.name)
      setSlug(editingFolder.slug)
      setSlugDirty(false)
      setSlugHint(null)
      setColor(editingFolder.color || DEFAULT_FOLDER_COLOR)
      setDescription(editingFolder.description || "")
      setMoveParentId(editingFolder.parent_id || "")
    } else {
      setName("")
      setSlug("")
      setSlugDirty(false)
      setSlugHint(null)
      setColor(DEFAULT_FOLDER_COLOR)
      setDescription("")
      setMoveParentId(defaultParentId || "")
    }
  }, [open, editingFolder, defaultParentId])

  const runSuggest = React.useCallback(
    async (explicit: boolean) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const previous = slugRef.current.trim()
      const seq = ++suggestSeq.current
      setSlugSuggesting(true)
      if (explicit) setSlugHint(null)
      try {
        const res = await api.suggestFolderSlug({
          name: trimmed,
          parent_id: moveParentId || null,
          exclude_id: editingFolder?.id ?? null,
          ...(explicit
            ? {
                current_slug: previous || null,
                description: descriptionRef.current.trim() || null,
              }
            : {}),
        })
        if (seq !== suggestSeq.current) return
        if (!explicit && slugDirtyRef.current) return
        setSlug(res.slug)
        if (explicit) setSlugDirty(true)
        if (explicit && res.slug === previous) {
          setSlugHint(res.source === "ai" ? "unchanged" : "kept")
        } else {
          setSlugHint(res.source === "ai" ? "ai" : "fallback")
        }
      } catch (err) {
        if (seq !== suggestSeq.current) return
        if (explicit) {
          toast.error(
            formatApiError(err as Error, t) || t("form.slugSuggestFailed")
          )
        }
      } finally {
        if (seq === suggestSeq.current) setSlugSuggesting(false)
      }
    },
    [editingFolder, moveParentId, name, t]
  )

  // 新建：名称防抖后建议 slug（用户还没改过 slug 时）
  React.useEffect(() => {
    if (!open || editingFolder || slugDirty) return
    const trimmed = name.trim()
    if (!trimmed) {
      setSlug("")
      setSlugHint(null)
      return
    }
    const timer = window.setTimeout(() => {
      void runSuggest(false)
    }, SLUG_SUGGEST_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [open, editingFolder, name, moveParentId, slugDirty, runSuggest])

  const slugHelp = slugSuggesting
    ? t("form.slugGenerating")
    : slugHint === "ai"
      ? t("form.slugGeneratedAi")
      : slugHint === "fallback"
        ? t("form.slugGeneratedFallback")
        : slugHint === "unchanged"
          ? t("form.slugUnchanged")
          : slugHint === "kept"
            ? t("form.slugKept")
            : t("form.slugHelp")

  const excludeIds = React.useMemo(() => {
    if (!editingFolder) return undefined
    return new Set(
      folders
        .filter((f) => f.path.startsWith(editingFolder.path))
        .map((f) => f.id)
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
        editingFolder ? t("form.updatedToast") : t("form.createdToast")
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

        <TooltipProvider delay={300}>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="folder-name" className="text-xs font-medium">
                {t("form.nameLabel")}{" "}
                <span className="text-destructive">*</span>
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
              <Label htmlFor="folder-slug" className="text-xs font-medium">
                {t("form.slugLabel")}
              </Label>
              <div className="relative">
                <Input
                  id="folder-slug"
                  value={slug}
                  aria-busy={slugSuggesting}
                  onChange={(e) => {
                    setSlugDirty(true)
                    setSlugHint(null)
                    setSlug(e.target.value.toLowerCase())
                  }}
                  placeholder="agent-skills"
                  className="h-9 pr-8 font-mono text-xs md:text-sm"
                />
                <FolderSlugSuggestButton
                  pending={slugSuggesting}
                  disabled={!name.trim()}
                  label={t("form.generateSlug")}
                  pendingLabel={t("form.slugGenerating")}
                  onClick={() => void runSuggest(true)}
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">{slugHelp}</p>
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
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}
