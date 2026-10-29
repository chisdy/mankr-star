import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  CaretRightIcon,
  DotsSixVerticalIcon,
  FolderIcon,
  FolderOpenIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react"

import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { ColorPicker } from "@workspace/ui/components/color-picker"
import { FOLDER_COLOR_PRESETS } from "@mankr/shared"

import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import {
  childrenOf,
  collectSubtreeFolderIds,
  planFolderDrop,
  type FolderDropPosition,
} from "@/lib/folder-utils"
import type { Folder } from "@/lib/types"
import { FolderSelect } from "./folder-select"
import { FolderSlugSuggestButton } from "./folder-slug-suggest-button"

type EditingField = "name" | "slug" | "description"

interface EditingCell {
  folderId: string
  field: EditingField
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** 行高上下各 40% 为同级插入，中间 20% 才改成该行的子级 */
const DROP_EDGE_RATIO = 0.4

function flattenTree(
  folders: Folder[],
  collapsedIds: ReadonlySet<string>
): Folder[] {
  const result: Folder[] = []
  function traverse(parentId: string | null) {
    const children = childrenOf(parentId, folders)
    for (const child of children) {
      result.push(child)
      if (!collapsedIds.has(child.id)) traverse(child.id)
    }
  }
  traverse(null)
  return result
}

function FolderRowHandle({
  hasChildren,
  expanded,
  label,
  onToggle,
  onDragStart,
  onDragEnd,
}: {
  hasChildren: boolean
  expanded: boolean
  label: string
  onToggle: () => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: (event: React.DragEvent) => void
}) {
  const suppressToggleRef = React.useRef(false)

  return (
    <button
      type="button"
      draggable
      aria-expanded={hasChildren ? expanded : undefined}
      aria-label={label}
      onClick={() => {
        if (!hasChildren || suppressToggleRef.current) return
        onToggle()
      }}
      onDragStart={(event) => {
        suppressToggleRef.current = true
        onDragStart(event)
      }}
      onDragEnd={(event) => {
        onDragEnd(event)
        window.setTimeout(() => {
          suppressToggleRef.current = false
        }, 0)
      }}
      className={cn(
        "relative grid size-6 place-items-center rounded-md text-muted-foreground/80 transition-colors",
        "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        hasChildren
          ? "cursor-pointer group-hover/row:cursor-grab active:cursor-grabbing"
          : "cursor-grab opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
      )}
    >
      {hasChildren ? (
        <span
          aria-hidden
          className={cn(
            "col-start-1 row-start-1 grid place-items-center transition-[opacity,rotate] duration-150",
            expanded && "rotate-90",
            "group-hover/row:opacity-0"
          )}
        >
          <CaretRightIcon className="size-3.5" />
        </span>
      ) : null}
      <DotsSixVerticalIcon
        aria-hidden
        weight="bold"
        className={cn(
          "col-start-1 row-start-1 size-4 transition-opacity duration-150",
          hasChildren ? "opacity-0 group-hover/row:opacity-100" : "opacity-100"
        )}
      />
    </button>
  )
}

export function FolderManagePage() {
  const { t } = useTranslation(["folders", "common", "errors"])
  const queryClient = useQueryClient()

  const {
    data: folders = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.folders.all,
    queryFn: () => api.getFolders(),
  })

  const [collapsedIds, setCollapsedIds] = React.useState<Set<string>>(
    () => new Set()
  )
  const folderIdsWithChildren = React.useMemo(() => {
    const ids = new Set<string>()
    for (const folder of folders) {
      if (folder.parent_id) ids.add(folder.parent_id)
    }
    return ids
  }, [folders])
  const flattenedFolders = React.useMemo(
    () => flattenTree(folders, collapsedIds),
    [folders, collapsedIds]
  )

  // 本地颜色修改缓冲（浮层关闭时统一提交）
  const [localColors, setLocalColors] = React.useState<Record<string, string>>(
    {}
  )

  // 内联编辑状态
  const [editingCell, setEditingCell] = React.useState<EditingCell | null>(null)
  const [cellDraft, setCellDraft] = React.useState("")
  const [suggestingSlugId, setSuggestingSlugId] = React.useState<string | null>(
    null
  )
  const inputRef = React.useRef<HTMLInputElement>(null)
  const polishSeq = React.useRef(0)
  const editingRef = React.useRef(editingCell)

  React.useEffect(() => {
    editingRef.current = editingCell
  }, [editingCell])

  // 拖动排序状态
  const [draggedFolderId, setDraggedFolderId] = React.useState<string | null>(
    null
  )
  const [dropTarget, setDropTarget] = React.useState<{
    folderId: string
    position: FolderDropPosition
  } | null>(null)
  const dropRejectRef = React.useRef<"depth" | null>(null)
  const dropHandledRef = React.useRef(false)

  React.useEffect(() => {
    if (editingCell) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editingCell])

  const startEdit = (folder: Folder, field: EditingField) => {
    const initial =
      field === "name"
        ? folder.name
        : field === "slug"
          ? folder.slug
          : (folder.description ?? "")
    setEditingCell({ folderId: folder.id, field })
    setCellDraft(initial)
  }

  const cancelEdit = () => {
    setEditingCell(null)
    setCellDraft("")
  }

  const polishSlug = async (folder: Folder, apply: "save" | "draft") => {
    if (suggestingSlugId) return
    const seq = ++polishSeq.current
    setSuggestingSlugId(folder.id)
    const baseline =
      apply === "draft" ? cellDraft.trim().toLowerCase() : folder.slug
    try {
      const res = await api.suggestFolderSlug({
        name: folder.name.trim(),
        parent_id: folder.parent_id,
        exclude_id: folder.id,
        current_slug: baseline || folder.slug,
        description: folder.description,
      })
      if (seq !== polishSeq.current) return
      if (!SLUG_PATTERN.test(res.slug) || res.slug.length > 64) {
        toast.error(t("manage.errors.slugInvalid"))
        return
      }
      if (res.slug === baseline || (apply === "save" && res.source !== "ai")) {
        toast(
          res.source === "ai"
            ? t("manage.toasts.slugUnchanged")
            : t("manage.toasts.slugKept")
        )
        return
      }
      if (apply === "draft") {
        const editing = editingRef.current
        if (editing?.folderId !== folder.id || editing.field !== "slug") return
        setCellDraft(res.slug)
        toast(t("manage.toasts.slugDrafted", { slug: res.slug }))
        return
      }
      await api.updateFolder(folder.id, { slug: res.slug })
      queryClient.setQueryData<Folder[]>(queryKeys.folders.all, (prev) =>
        prev?.map((item) =>
          item.id === folder.id ? { ...item, slug: res.slug } : item
        )
      )
      const editing = editingRef.current
      if (editing?.folderId === folder.id && editing.field === "slug") {
        cancelEdit()
      }
      toast.success(
        res.source === "ai"
          ? t("manage.toasts.slugGenerated", { slug: res.slug })
          : t("manage.toasts.slugGeneratedFallback", { slug: res.slug })
      )
      await queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bookmarks.all,
      })
    } catch (err) {
      if (seq !== polishSeq.current) return
      toast.error(
        formatApiError(err as Error, t) || t("manage.errors.slugSuggestFailed")
      )
    } finally {
      if (seq === polishSeq.current) setSuggestingSlugId(null)
    }
  }

  const commitEdit = async (folder: Folder) => {
    if (!editingCell || editingCell.folderId !== folder.id) return
    const field = editingCell.field
    cancelEdit()

    if (field === "name") {
      const trimmed = cellDraft.trim()
      if (trimmed === folder.name) return
      if (!trimmed) {
        toast.error(t("manage.errors.nameRequired"))
        return
      }
      if (trimmed.length > 64) {
        toast.error(t("manage.errors.nameTooLong"))
        return
      }
      try {
        await api.updateFolder(folder.id, { name: trimmed })
        toast.success(t("manage.toasts.updated"))
        await queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
        await queryClient.invalidateQueries({
          queryKey: queryKeys.bookmarks.all,
        })
      } catch (err) {
        toast.error(formatApiError(err, t) || t("manage.errors.updateFailed"))
      }
    } else if (field === "slug") {
      const trimmed = cellDraft.trim().toLowerCase()
      if (trimmed === folder.slug) return
      if (!trimmed || !SLUG_PATTERN.test(trimmed) || trimmed.length > 64) {
        toast.error(t("manage.errors.slugInvalid"))
        return
      }
      try {
        await api.updateFolder(folder.id, { slug: trimmed })
        toast.success(t("manage.toasts.updated"))
        await queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
        await queryClient.invalidateQueries({
          queryKey: queryKeys.bookmarks.all,
        })
      } catch (err) {
        toast.error(formatApiError(err, t) || t("manage.errors.updateFailed"))
      }
    } else if (field === "description") {
      const trimmed = cellDraft.trim()
      const nextVal = trimmed.length === 0 ? null : trimmed
      if (nextVal === (folder.description ?? null)) return
      if (trimmed.length > 500) {
        toast.error(t("manage.errors.descTooLong"))
        return
      }
      try {
        await api.updateFolder(folder.id, { description: nextVal })
        toast.success(t("manage.toasts.updated"))
        await queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      } catch (err) {
        toast.error(formatApiError(err, t) || t("manage.errors.updateFailed"))
      }
    }
  }

  const handleParentChange = async (
    folder: Folder,
    nextParentId: string | null
  ) => {
    if (nextParentId === (folder.parent_id ?? null)) return
    const newSiblings = folders.filter(
      (f) => (f.parent_id ?? null) === nextParentId && f.id !== folder.id
    )
    const maxSort =
      newSiblings.length > 0
        ? Math.max(...newSiblings.map((f) => f.sort_order ?? 0))
        : 0
    const nextSortOrder = newSiblings.length > 0 ? maxSort + 10 : 10
    try {
      await api.updateFolder(folder.id, {
        parent_id: nextParentId,
        sort_order: nextSortOrder,
      })
      toast.success(t("manage.toasts.updated"))
      await queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
    } catch (err) {
      toast.error(formatApiError(err, t) || t("manage.errors.updateFailed"))
    }
  }

  const handleColorOpenChange = async (folder: Folder, open: boolean) => {
    if (open) return
    const draftColor = localColors[folder.id]
    if (!draftColor || draftColor === (folder.color ?? "#64748B")) return
    try {
      await api.updateFolder(folder.id, { color: draftColor })
      toast.success(t("manage.toasts.updated"))
      await queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
    } catch (err) {
      toast.error(formatApiError(err, t) || t("manage.errors.updateFailed"))
      setLocalColors((prev) => {
        const next = { ...prev }
        delete next[folder.id]
        return next
      })
    }
  }

  // 拖动交互
  const handleDragStart = (e: React.DragEvent, folder: Folder) => {
    e.dataTransfer.setData("text/plain", folder.id)
    e.dataTransfer.effectAllowed = "move"
    dropRejectRef.current = null
    dropHandledRef.current = false
    setDraggedFolderId(folder.id)
  }

  const handleDragOver = (e: React.DragEvent, targetFolder: Folder) => {
    if (!draggedFolderId) return

    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5
    const position: FolderDropPosition =
      ratio < DROP_EDGE_RATIO
        ? "before"
        : ratio > 1 - DROP_EDGE_RATIO
          ? "after"
          : "inside"
    const plan = planFolderDrop(
      folders,
      draggedFolderId,
      targetFolder.id,
      position
    )
    if (!plan.ok && plan.reason !== "noop") {
      dropRejectRef.current = plan.reason === "depth" ? "depth" : null
      setDropTarget((current) => (current === null ? current : null))
      return
    }

    dropRejectRef.current = null
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropTarget((current) =>
      current?.folderId === targetFolder.id && current.position === position
        ? current
        : { folderId: targetFolder.id, position }
    )
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dropHandledRef.current = true
    const draggedId = draggedFolderId
    const target = dropTarget
    const rejected = dropRejectRef.current
    dropRejectRef.current = null
    setDraggedFolderId(null)
    setDropTarget(null)
    if (!draggedId || !target) {
      if (rejected === "depth") toast.error(t("manage.errors.depthExceeded"))
      return
    }

    const dragged = folders.find((folder) => folder.id === draggedId)
    const plan = planFolderDrop(
      folders,
      draggedId,
      target.folderId,
      target.position
    )
    if (!plan.ok || !dragged) {
      if (plan.ok === false && plan.reason === "depth") {
        toast.error(t("manage.errors.depthExceeded"))
      }
      return
    }

    const originalParentId = dragged.parent_id ?? null
    const originalSortOrder = dragged.sort_order

    try {
      if (plan.parentChanged) {
        await api.updateFolder(draggedId, { parent_id: plan.parentId })
      }
    } catch (err) {
      toast.error(formatApiError(err, t) || t("manage.errors.reorderFailed"))
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      return
    }

    try {
      await api.reorderFolders({
        parentId: plan.parentId,
        orderedIds: plan.orderedIds,
      })
    } catch (err) {
      if (plan.parentChanged) {
        try {
          await api.updateFolder(draggedId, {
            parent_id: originalParentId,
            ...(originalSortOrder !== undefined
              ? { sort_order: originalSortOrder }
              : {}),
          })
        } catch {
          toast.error(t("manage.errors.movePartial"))
          void queryClient.invalidateQueries({
            queryKey: queryKeys.folders.all,
          })
          void queryClient.invalidateQueries({
            queryKey: queryKeys.bookmarks.all,
          })
          return
        }
      }
      toast.error(formatApiError(err, t) || t("manage.errors.reorderFailed"))
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      if (plan.parentChanged) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.bookmarks.all,
        })
      }
      return
    }

    if (plan.parentChanged && plan.parentId) {
      const parentId = plan.parentId
      setCollapsedIds((current) => {
        if (!current.has(parentId)) return current
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
    }

    toast.success(
      plan.parentChanged
        ? t("manage.toasts.moved")
        : t("manage.toasts.reordered")
    )
    await queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
    if (plan.parentChanged) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.bookmarks.all,
      })
    }
  }

  const toggleCollapsed = (folderId: string) => {
    const willCollapse = !collapsedIds.has(folderId)
    if (willCollapse && editingCell && editingCell.folderId !== folderId) {
      const hidden = new Set(collectSubtreeFolderIds(folderId, folders))
      if (hidden.has(editingCell.folderId)) cancelEdit()
    }
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const handleDragEnd = () => {
    const rejected = dropRejectRef.current
    const handled = dropHandledRef.current
    dropRejectRef.current = null
    dropHandledRef.current = false
    setDraggedFolderId(null)
    setDropTarget(null)
    if (!handled && rejected === "depth") {
      toast.error(t("manage.errors.depthExceeded"))
    }
  }

  return (
    <div className="w-full min-w-0 space-y-6 pb-12">
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
            <FolderOpenIcon className="size-4.5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("manage.title")}
          </h1>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("manage.description")}
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          {t("manage.reorderTip")}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2 rounded-xl border border-border/70 bg-card p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card p-12 text-center">
          <p className="text-xs text-muted-foreground">
            {t("common:states.loadError")}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 text-xs text-primary underline"
          >
            {t("common:actions.retry")}
          </button>
        </div>
      ) : flattenedFolders.length === 0 ? (
        <div className="flex flex-col items-center justify-center space-y-3 rounded-xl border border-dashed border-border/80 bg-card p-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FolderIcon className="size-5" />
          </div>
          <p className="text-xs text-muted-foreground">{t("manage.empty")}</p>
        </div>
      ) : (
        <TooltipProvider delay={300}>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
            <div className="overflow-x-auto">
              <div
                role="grid"
                aria-label={t("manage.title")}
                className="w-full min-w-[900px] divide-y divide-border/50 text-sm"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                {/* Header */}
                <div
                  role="row"
                  className="flex items-center bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground select-none"
                >
                  <div
                    role="columnheader"
                    className="flex w-10 shrink-0 items-center justify-center text-center"
                  >
                    {t("manage.columns.drag")}
                  </div>
                  <div role="columnheader" className="w-64 shrink-0 px-2">
                    {t("manage.columns.name")}
                  </div>
                  <div role="columnheader" className="w-48 shrink-0 px-2">
                    {t("manage.columns.slug")}
                  </div>
                  <div role="columnheader" className="w-48 shrink-0 px-2">
                    {t("manage.columns.parent")}
                  </div>
                  <div
                    role="columnheader"
                    className="w-16 shrink-0 px-2 text-center"
                  >
                    {t("manage.columns.color")}
                  </div>
                  <div role="columnheader" className="min-w-48 flex-1 px-2">
                    {t("manage.columns.description")}
                  </div>
                </div>

                {/* Rows */}
                {flattenedFolders.map((folder) => {
                  const isEditingName =
                    editingCell?.folderId === folder.id &&
                    editingCell.field === "name"
                  const isEditingSlug =
                    editingCell?.folderId === folder.id &&
                    editingCell.field === "slug"
                  const isEditingDesc =
                    editingCell?.folderId === folder.id &&
                    editingCell.field === "description"

                  const isDropTargetRow = dropTarget?.folderId === folder.id
                  const isDragOverTop =
                    isDropTargetRow && dropTarget?.position === "before"
                  const isDropInside =
                    isDropTargetRow && dropTarget?.position === "inside"
                  const isDragOverBottom =
                    isDropTargetRow && dropTarget?.position === "after"

                  const isDraggingSelf = draggedFolderId === folder.id
                  const excludeIds = collectSubtreeFolderIds(folder.id, folders)
                  const hasChildren = folderIdsWithChildren.has(folder.id)
                  const expanded = hasChildren && !collapsedIds.has(folder.id)

                  return (
                    <div
                      key={folder.id}
                      role="row"
                      data-folder-id={folder.id}
                      onDragOver={(e) => handleDragOver(e, folder)}
                      className={cn(
                        "group/row flex items-center px-3 py-2 transition-colors",
                        "focus-within:bg-muted/20 hover:bg-muted/30",
                        isDraggingSelf && "bg-muted/50 opacity-40",
                        isDropInside && "bg-primary/10",
                        isDragOverTop && "border-t-2 border-primary",
                        isDragOverBottom && "border-b-2 border-primary"
                      )}
                    >
                      {/* 默认展开箭头，悬停该行时换成拖动手柄 */}
                      <div
                        role="gridcell"
                        className="flex w-10 shrink-0 items-center justify-center"
                      >
                        <FolderRowHandle
                          hasChildren={hasChildren}
                          expanded={expanded}
                          label={
                            hasChildren
                              ? t("manage.rowHandle", {
                                  folderName: folder.name,
                                })
                              : t("manage.dragHandle")
                          }
                          onToggle={() => toggleCollapsed(folder.id)}
                          onDragStart={(event) =>
                            handleDragStart(event, folder)
                          }
                          onDragEnd={handleDragEnd}
                        />
                      </div>

                      {/* 文件夹名称 */}
                      <div
                        role="gridcell"
                        className="w-64 shrink-0 px-2"
                        style={{
                          paddingLeft: `${Math.max(8, folder.depth * 20 + 8)}px`,
                        }}
                      >
                        {isEditingName ? (
                          <Input
                            ref={inputRef}
                            value={cellDraft}
                            onChange={(e) => setCellDraft(e.target.value)}
                            onBlur={() => commitEdit(folder)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(folder)
                              if (e.key === "Escape") cancelEdit()
                            }}
                            className="h-8 text-xs font-medium"
                            maxLength={64}
                          />
                        ) : (
                          <div
                            onDoubleClick={() => startEdit(folder, "name")}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") startEdit(folder, "name")
                            }}
                            className="group/name flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-colors hover:bg-muted/60"
                          >
                            <FolderIcon
                              className="size-3.5 shrink-0"
                              weight="fill"
                              style={{
                                color:
                                  localColors[folder.id] ??
                                  folder.color ??
                                  "#64748B",
                              }}
                            />
                            <span className="truncate">{folder.name}</span>
                            <PencilSimpleIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-60" />
                          </div>
                        )}
                      </div>

                      {/* Slug */}
                      <div role="gridcell" className="w-48 shrink-0 px-2">
                        <div className="relative">
                          {isEditingSlug ? (
                            <Input
                              ref={inputRef}
                              value={cellDraft}
                              onChange={(e) => setCellDraft(e.target.value)}
                              onBlur={() => commitEdit(folder)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit(folder)
                                if (e.key === "Escape") cancelEdit()
                              }}
                              aria-busy={suggestingSlugId === folder.id}
                              className="h-8 pr-7 font-mono text-[11px]"
                              maxLength={64}
                            />
                          ) : (
                            <div
                              onDoubleClick={() => startEdit(folder, "slug")}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") startEdit(folder, "slug")
                              }}
                              className="flex items-center rounded-md py-1 pr-7 pl-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                            >
                              <span className="truncate">{folder.slug}</span>
                            </div>
                          )}
                          <FolderSlugSuggestButton
                            pending={suggestingSlugId === folder.id}
                            disabled={
                              !folder.name.trim() ||
                              (suggestingSlugId !== null &&
                                suggestingSlugId !== folder.id)
                            }
                            preserveFocus={isEditingSlug}
                            label={t("manage.generateSlugAria", {
                              name: folder.name,
                            })}
                            pendingLabel={t("form.slugGenerating")}
                            onClick={() =>
                              void polishSlug(
                                folder,
                                isEditingSlug ? "draft" : "save"
                              )
                            }
                            className="absolute top-1/2 right-0.5 -translate-y-1/2"
                          />
                        </div>
                      </div>

                      {/* 父文件夹选择 */}
                      <div role="gridcell" className="w-48 shrink-0 px-2">
                        <FolderSelect
                          folders={folders}
                          value={folder.parent_id ?? null}
                          onValueChange={(nextParentId) =>
                            handleParentChange(folder, nextParentId)
                          }
                          noneLabel={t("form.root")}
                          excludeIds={new Set(excludeIds)}
                          portaled
                          className="w-full text-xs"
                        />
                      </div>

                      {/* 颜色选择 */}
                      <div
                        role="gridcell"
                        className="flex w-16 shrink-0 items-center justify-center px-2"
                      >
                        <ColorPicker
                          value={
                            localColors[folder.id] ?? folder.color ?? "#64748B"
                          }
                          onValueChange={(hex) =>
                            setLocalColors((prev) => ({
                              ...prev,
                              [folder.id]: hex,
                            }))
                          }
                          onOpenChange={(open) =>
                            handleColorOpenChange(folder, open)
                          }
                          presets={FOLDER_COLOR_PRESETS}
                          compact
                          portaled
                          aria-label={folder.name}
                        />
                      </div>

                      {/* 说明 */}
                      <div role="gridcell" className="min-w-48 flex-1 px-2">
                        {isEditingDesc ? (
                          <Input
                            ref={inputRef}
                            value={cellDraft}
                            onChange={(e) => setCellDraft(e.target.value)}
                            onBlur={() => commitEdit(folder)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(folder)
                              if (e.key === "Escape") cancelEdit()
                            }}
                            className="h-8 text-xs text-muted-foreground"
                            maxLength={500}
                          />
                        ) : (
                          <div
                            onDoubleClick={() =>
                              startEdit(folder, "description")
                            }
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                startEdit(folder, "description")
                            }}
                            className="group/desc flex items-center justify-between rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                          >
                            <span
                              className={cn(
                                "truncate",
                                !folder.description && "italic opacity-50"
                              )}
                            >
                              {folder.description ||
                                t("manage.placeholders.description")}
                            </span>
                            <PencilSimpleIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover/desc:opacity-60" />
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </TooltipProvider>
      )}
    </div>
  )
}
