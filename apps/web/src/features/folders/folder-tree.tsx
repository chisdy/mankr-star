import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  CaretRightIcon,
  FolderIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react"

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
import { childrenOf } from "@/lib/folder-utils"
import type { Folder as FolderType } from "@/lib/types"

export function ancestorIdsForFolder(
  folderId: string | null,
  folders: FolderType[],
): string[] {
  if (!folderId) return []
  const folder = folders.find((f) => f.id === folderId)
  if (!folder) return []
  return folder.path.split("/").filter(Boolean)
}

function FolderTreeSelectNode({
  folder,
  folders,
  selectedId,
  openIds,
  onOpenChange,
  onSelect,
  showCount,
}: {
  folder: FolderType
  folders: FolderType[]
  selectedId: string
  openIds: string[]
  onOpenChange: (open: string[]) => void
  onSelect: (id: string) => void
  showCount?: boolean
}) {
  const { t } = useTranslation("folders")
  const children = childrenOf(folder.id, folders)
  const hasChildren = children.length > 0
  const isSelected = selectedId === folder.id

  return (
    <FolderItem value={folder.id}>
      <FolderHeader className="flex items-center gap-0.5">
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
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm",
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
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              {showCount &&
                typeof folder.count === "number" &&
                folder.count > 0 && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {folder.count}
                  </span>
                )}
            </button>
          </Folder>
        </FolderHighlight>
      </FolderHeader>

      {hasChildren && (
        <FolderPanel>
          <SubFiles open={openIds} onOpenChange={onOpenChange}>
            {children.map((child) => (
              <FolderTreeSelectNode
                key={child.id}
                folder={child}
                folders={folders}
                selectedId={selectedId}
                openIds={openIds}
                onOpenChange={onOpenChange}
                onSelect={onSelect}
                showCount={showCount}
              />
            ))}
          </SubFiles>
        </FolderPanel>
      )}
    </FolderItem>
  )
}

export type FolderTreeProps = {
  folders: FolderType[]
  value?: string | null
  onSelect: (id: string | null) => void
  /** 树顶可选空值项文案；不传则不显示 */
  noneLabel?: string
  isLoading?: boolean
  showCount?: boolean
  className?: string
  /** 排除的文件夹 id（如编辑时排除自身子树） */
  excludeIds?: Set<string>
  /** 强制展开的节点（如搜索时展开匹配路径） */
  forcedOpenIds?: string[]
  /** 空列表文案 */
  emptyLabel?: string
}

export function FolderTree({
  folders,
  value = null,
  onSelect,
  noneLabel,
  isLoading,
  showCount = false,
  className,
  excludeIds,
  forcedOpenIds,
  emptyLabel,
}: FolderTreeProps) {
  const { t } = useTranslation("folders")
  const resolvedEmptyLabel = emptyLabel ?? t("tree.empty")
  const selectedId = value || ""
  const visibleFolders = React.useMemo(() => {
    if (!excludeIds?.size) return folders
    return folders.filter((f) => !excludeIds.has(f.id))
  }, [folders, excludeIds])

  const rootFolders = React.useMemo(
    () => childrenOf(null, visibleFolders),
    [visibleFolders],
  )

  const defaultOpen = React.useMemo(
    () => ancestorIdsForFolder(selectedId || null, visibleFolders),
    [selectedId, visibleFolders],
  )

  const [openIds, setOpenIds] = React.useState<string[]>(defaultOpen)

  React.useEffect(() => {
    if (defaultOpen.length === 0) return
    setOpenIds((prev) => Array.from(new Set([...prev, ...defaultOpen])))
  }, [defaultOpen])

  React.useEffect(() => {
    if (!forcedOpenIds?.length) return
    setOpenIds((prev) => Array.from(new Set([...prev, ...forcedOpenIds])))
  }, [forcedOpenIds])

  if (isLoading) {
    return (
      <div className={cn("space-y-2 p-2", className)}>
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-7 w-3/5" />
      </div>
    )
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {noneLabel && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "mx-1 mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
            !selectedId
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <FolderOpenIcon className="size-4 shrink-0" />
          <span className="truncate">{noneLabel}</span>
        </button>
      )}

      <ScrollArea className="min-h-0 flex-1">
        {rootFolders.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {resolvedEmptyLabel}
          </p>
        ) : (
          <Files open={openIds} onOpenChange={setOpenIds} className="p-1">
            {rootFolders.map((folder) => (
              <FolderTreeSelectNode
                key={folder.id}
                folder={folder}
                folders={visibleFolders}
                selectedId={selectedId}
                openIds={openIds}
                onOpenChange={setOpenIds}
                onSelect={onSelect}
                showCount={showCount}
              />
            ))}
          </Files>
        )}
      </ScrollArea>
    </div>
  )
}
