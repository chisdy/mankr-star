import * as React from "react"
import { useNavigate, useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  CaretRightIcon,
  DotsThreeVerticalIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import {
  Files,
  FolderItem,
  FolderPanel,
  SubFiles,
} from "@workspace/ui/components/animate-ui/components/base/files"
import {
  FolderHeader,
  FolderTrigger,
  FolderHighlight,
  Folder,
  FolderIcon as FolderIconAnimated,
} from "@workspace/ui/components/animate-ui/primitives/base/files"
import { api } from "@/lib/api"
import { childrenOf } from "@/lib/folder-utils"
import { queryKeys } from "@/lib/query-keys"
import type { Folder as FolderType } from "@/lib/types"
import { useAuth } from "@/hooks/use-auth"
import { FolderDeleteDialog } from "./folder-delete-dialog"
import { FolderFormDialog } from "./folder-form-dialog"

function ancestorIdsForFolder(
  folderId: string | null,
  folders: FolderType[],
): string[] {
  if (!folderId) return []
  const folder = folders.find((f) => f.id === folderId)
  if (!folder) return []
  return folder.path.split("/").filter(Boolean)
}

function FolderCount({
  count,
  hidden,
}: {
  count?: number
  hidden?: boolean
}) {
  if (typeof count !== "number" || count <= 0) {
    return <span className="size-6 shrink-0" aria-hidden />
  }
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-end font-mono text-[10px] tabular-nums text-muted-foreground transition-opacity",
        "group-hover/folder:opacity-0",
        hidden && "opacity-0",
      )}
    >
      {count}
    </span>
  )
}

function FolderTreeNode({
  folder,
  folders,
  selectedId,
  openIds,
  onOpenChange,
  onSelect,
  onEdit,
  onCreateChild,
  onDelete,
  canManage,
}: {
  folder: FolderType
  folders: FolderType[]
  selectedId: string
  openIds: string[]
  onOpenChange: (open: string[]) => void
  onSelect: (id: string) => void
  onEdit: (folder: FolderType) => void
  onCreateChild: (parent: FolderType) => void
  onDelete: (folder: FolderType) => void
  canManage: boolean
}) {
  const { t } = useTranslation("folders")
  const children = childrenOf(folder.id, folders)
  const hasChildren = children.length > 0
  const isSelected = selectedId === folder.id
  const [menuOpen, setMenuOpen] = React.useState(false)

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open)
    if (!open) {
      // 关闭后去掉焦点，避免 focus-within 继续露出更多按钮
      queueMicrotask(() => {
        const active = document.activeElement
        if (active instanceof HTMLElement) active.blur()
      })
    }
  }

  return (
    <FolderItem value={folder.id}>
      <FolderHeader className="group/folder flex items-center gap-0.5">
        {hasChildren ? (
          <FolderTrigger
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:[&_svg]:rotate-90"
            aria-label={t("tree.expandCollapse", { folderName: folder.name })}
          >
            <CaretRightIcon className="size-3.5 transition-transform" />
          </FolderTrigger>
        ) : (
          <span className="size-7 shrink-0" aria-hidden />
        )}

        <FolderHighlight className="min-w-0 flex-1">
          <Folder
            className={cn(
              "relative flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm",
              isSelected && "bg-accent font-medium text-accent-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(folder.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
            >
              <FolderIconAnimated
                className="shrink-0"
                closeIcon={
                  folder.color ? (
                    <FolderIcon
                      className="size-4"
                      weight="fill"
                      style={{ color: folder.color }}
                    />
                  ) : (
                    <FolderIcon className="size-4 text-muted-foreground" />
                  )
                }
                openIcon={
                  folder.color ? (
                    <FolderOpenIcon
                      className="size-4"
                      weight="fill"
                      style={{ color: folder.color }}
                    />
                  ) : (
                    <FolderOpenIcon className="size-4 text-muted-foreground" />
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate text-left">
                {folder.name}
              </span>
              <FolderCount count={folder.count} hidden={menuOpen && canManage} />
            </button>

            {/* 覆盖在计数上：仅 hover / 菜单打开时显示 */}
            {canManage ? (
            <div
              className={cn(
                "pointer-events-none absolute top-1/2 right-1.5 z-10 -translate-y-1/2 opacity-0 transition-opacity",
                "group-hover/folder:pointer-events-auto group-hover/folder:opacity-100",
                menuOpen && "pointer-events-auto opacity-100",
              )}
            >
              <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-6"
                      aria-label={t("panel.folderMenuAria", {
                        folderName: folder.name,
                      })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  }
                >
                  <DotsThreeVerticalIcon className="size-3.5" weight="bold" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(folder)
                    }}
                  >
                    <PencilSimpleIcon className="mr-2 size-4" />
                    {t("panel.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      onCreateChild(folder)
                    }}
                  >
                    <FolderPlusIcon className="mr-2 size-4" />
                    {t("panel.newChild")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(folder)
                    }}
                  >
                    <TrashIcon className="mr-2 size-4" />
                    {t("panel.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            ) : null}
          </Folder>
        </FolderHighlight>
      </FolderHeader>

      {hasChildren && (
        <FolderPanel>
          <SubFiles open={openIds} onOpenChange={onOpenChange}>
            {children.map((child) => (
              <FolderTreeNode
                key={child.id}
                folder={child}
                folders={folders}
                selectedId={selectedId}
                openIds={openIds}
                onOpenChange={onOpenChange}
                onSelect={onSelect}
                onEdit={onEdit}
                onCreateChild={onCreateChild}
                onDelete={onDelete}
                canManage={canManage}
              />
            ))}
          </SubFiles>
        </FolderPanel>
      )}
    </FolderItem>
  )
}

const FOLDER_PANEL_MIN_WIDTH = 240
const FOLDER_PANEL_MAX_WIDTH = 360
const FOLDER_PANEL_DEFAULT_WIDTH = 240
const FOLDER_PANEL_WIDTH_KEY = "mankr_folder_panel_width"

function clampPanelWidth(width: number) {
  return Math.min(
    FOLDER_PANEL_MAX_WIDTH,
    Math.max(FOLDER_PANEL_MIN_WIDTH, Math.round(width)),
  )
}

function readStoredPanelWidth(): number {
  if (typeof window === "undefined") return FOLDER_PANEL_DEFAULT_WIDTH
  const raw = localStorage.getItem(FOLDER_PANEL_WIDTH_KEY)
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed)) return FOLDER_PANEL_DEFAULT_WIDTH
  return clampPanelWidth(parsed)
}

export function FolderTreePanel({
  className,
  onNavigate,
  resizable = false,
}: {
  className?: string
  /** 移动端选中后回调（如关闭 Sheet） */
  onNavigate?: () => void
  /** 桌面端启用右侧拖拽调宽 */
  resizable?: boolean
}) {
  const { t } = useTranslation("folders")
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const selectedId = searchParams.get("folder_id") || ""

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingFolder, setEditingFolder] = React.useState<FolderType | null>(
    null,
  )
  const [defaultParentId, setDefaultParentId] = React.useState<string | null>(
    null,
  )
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deletingFolder, setDeletingFolder] =
    React.useState<FolderType | null>(null)

  const [panelWidth, setPanelWidth] = React.useState(() =>
    resizable ? readStoredPanelWidth() : FOLDER_PANEL_DEFAULT_WIDTH,
  )
  const [isResizing, setIsResizing] = React.useState(false)
  const panelRef = React.useRef<HTMLElement>(null)
  const widthRef = React.useRef(panelWidth)
  const dragStartX = React.useRef(0)
  const dragStartWidth = React.useRef(FOLDER_PANEL_DEFAULT_WIDTH)
  const rafId = React.useRef(0)
  const pendingWidth = React.useRef<number | null>(null)

  React.useEffect(() => {
    widthRef.current = panelWidth
  }, [panelWidth])

  const applyWidth = React.useEffectEvent((width: number) => {
    const next = clampPanelWidth(width)
    widthRef.current = next
    const el = panelRef.current
    if (el) el.style.width = `${next}px`
  })

  const commitWidth = React.useEffectEvent((width: number) => {
    const next = clampPanelWidth(width)
    widthRef.current = next
    setPanelWidth(next)
    localStorage.setItem(FOLDER_PANEL_WIDTH_KEY, String(next))
  })

  const stopResize = React.useEffectEvent(() => {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current)
      rafId.current = 0
    }
    pendingWidth.current = null
    setIsResizing(false)
    commitWidth(widthRef.current)
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
  })

  React.useEffect(() => {
    if (!isResizing) return

    const onPointerMove = (event: PointerEvent) => {
      const delta = event.clientX - dragStartX.current
      pendingWidth.current = dragStartWidth.current + delta
      if (rafId.current) return
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0
        if (pendingWidth.current == null) return
        applyWidth(pendingWidth.current)
      })
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true })
    window.addEventListener("pointerup", stopResize)
    window.addEventListener("pointercancel", stopResize)

    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", stopResize)
      window.removeEventListener("pointercancel", stopResize)
      if (rafId.current) {
        cancelAnimationFrame(rafId.current)
        rafId.current = 0
      }
    }
  }, [isResizing])

  const handleResizePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!resizable) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragStartX.current = event.clientX
    dragStartWidth.current =
      panelRef.current?.getBoundingClientRect().width ?? widthRef.current
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    setIsResizing(true)
  }

  const { isAuthenticated: canManage } = useAuth()

  const { data: folders = [], isLoading } = useQuery({
    queryKey: queryKeys.folders.all,
    queryFn: () => api.getFolders(),
  })

  const { data: bookmarkTotal } = useQuery({
    queryKey: [...queryKeys.bookmarks.all, "total"] as const,
    queryFn: () => api.getBookmarks({ page: 1, limit: 1 }),
    select: (res) => res.total,
  })

  const rootFolders = React.useMemo(
    () => childrenOf(null, folders),
    [folders],
  )

  const defaultOpen = React.useMemo(
    () => ancestorIdsForFolder(selectedId || null, folders),
    [selectedId, folders],
  )

  const [openIds, setOpenIds] = React.useState<string[]>(defaultOpen)

  React.useEffect(() => {
    if (defaultOpen.length === 0) return
    setOpenIds((prev) => Array.from(new Set([...prev, ...defaultOpen])))
  }, [defaultOpen])

  const selectFolder = (id: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (id) next.set("folder_id", id)
    else next.delete("folder_id")
    const qs = next.toString()
    navigate(qs ? `/?${qs}` : "/")
    onNavigate?.()
  }

  const openCreate = (parentId: string | null = null) => {
    setEditingFolder(null)
    setDefaultParentId(parentId)
    setDialogOpen(true)
  }

  const openEdit = (folder: FolderType) => {
    setEditingFolder(folder)
    setDefaultParentId(folder.parent_id || null)
    setDialogOpen(true)
  }

  const openDelete = (folder: FolderType) => {
    setDeletingFolder(folder)
    setDeleteOpen(true)
  }

  return (
    <aside
      ref={panelRef}
      style={resizable ? { width: panelWidth } : undefined}
      data-resizing={isResizing ? "" : undefined}
      className={cn(
        "relative flex h-full min-h-0 shrink-0 flex-col border-r border-border/50 bg-card",
        isResizing && "select-none will-change-[width]",
        !resizable && "w-56",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden",
          isResizing && "pointer-events-none",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3">
          <span className="text-xs font-semibold tracking-wide text-foreground">
            {t("panel.title")}
          </span>
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label={t("panel.newFolderAria")}
              onClick={() => openCreate(null)}
            >
              <PlusIcon className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="shrink-0 px-2 pt-2">
          <button
            type="button"
            onClick={() => selectFolder(null)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              !selectedId
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <FolderOpenIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              {t("panel.allBookmarks")}
            </span>
            {typeof bookmarkTotal === "number" && (
              <span className="inline-flex size-6 shrink-0 items-center justify-end font-mono text-[10px] tabular-nums text-muted-foreground">
                {bookmarkTotal}
              </span>
            )}
          </button>
        </div>

        <ScrollArea className="min-h-0 flex-1 px-1 py-1">
          {isLoading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-4/5" />
              <Skeleton className="h-7 w-3/5" />
            </div>
          ) : rootFolders.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <FolderIcon className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">
                {canManage
                  ? t("panel.emptyManage")
                  : t("panel.emptyGuest")}
              </p>
            </div>
          ) : (
            <Files open={openIds} onOpenChange={setOpenIds} className="p-1">
              {rootFolders.map((folder) => (
                <FolderTreeNode
                  key={folder.id}
                  folder={folder}
                  folders={folders}
                  selectedId={selectedId}
                  openIds={openIds}
                  onOpenChange={setOpenIds}
                  onSelect={selectFolder}
                  onEdit={openEdit}
                  onCreateChild={(parent) => openCreate(parent.id)}
                  onDelete={openDelete}
                  canManage={canManage}
                />
              ))}
            </Files>
          )}
        </ScrollArea>
      </div>

      {resizable && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("panel.resizeAria")}
          aria-valuemin={FOLDER_PANEL_MIN_WIDTH}
          aria-valuemax={FOLDER_PANEL_MAX_WIDTH}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              commitWidth(widthRef.current - 8)
            } else if (event.key === "ArrowRight") {
              event.preventDefault()
              commitWidth(widthRef.current + 8)
            } else if (event.key === "Home") {
              event.preventDefault()
              commitWidth(FOLDER_PANEL_MIN_WIDTH)
            } else if (event.key === "End") {
              event.preventDefault()
              commitWidth(FOLDER_PANEL_MAX_WIDTH)
            }
          }}
          className={cn(
            "group/resize absolute inset-y-0 -right-1.5 z-30 flex w-3 cursor-col-resize touch-none items-stretch justify-center",
            "pointer-events-auto outline-none",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "my-0 w-px rounded-full bg-transparent transition-[width,background-color,box-shadow,opacity] duration-150 ease-out",
              "group-hover/resize:w-0.5 group-hover/resize:bg-primary/70 group-hover/resize:shadow-[0_0_0_1px] group-hover/resize:shadow-primary/20",
              "group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-primary",
              isResizing &&
                "w-1 bg-primary shadow-[0_0_0_1px] shadow-primary/30",
            )}
          />
        </div>
      )}

      <FolderFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        folder={editingFolder}
        defaultParentId={defaultParentId}
        folders={folders}
      />

      <FolderDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        folder={deletingFolder}
        folders={folders}
        onDeleted={(id) => {
          if (selectedId === id) selectFolder(null)
        }}
      />
    </aside>
  )
}
