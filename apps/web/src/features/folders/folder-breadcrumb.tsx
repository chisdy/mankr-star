import * as React from "react"
import { useNavigate, useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CaretRightIcon, HouseIcon } from "@phosphor-icons/react"

import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Folder } from "@/lib/types"
import { BOOKMARK_PAGE_PARAM } from "@/features/bookmarks/bookmark-pagination"
import { cn } from "@workspace/ui/lib/utils"

function breadcrumbFolders(
  folderId: string,
  folders: Folder[],
): Folder[] {
  const current = folders.find((f) => f.id === folderId)
  if (!current) return []
  return current.path
    .split("/")
    .filter(Boolean)
    .map((id) => folders.find((f) => f.id === id))
    .filter((f): f is Folder => Boolean(f))
}

export function FolderBreadcrumb({ className }: { className?: string }) {
  const { t } = useTranslation("folders")
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const folderId = searchParams.get("folder_id") || ""

  const { data: folders = [] } = useQuery({
    queryKey: queryKeys.folders.all,
    queryFn: () => api.getFolders(),
  })

  const crumbs = React.useMemo(
    () => (folderId ? breadcrumbFolders(folderId, folders) : []),
    [folderId, folders],
  )

  const goToFolder = (id: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (id) next.set("folder_id", id)
    else next.delete("folder_id")
    next.delete(BOOKMARK_PAGE_PARAM)
    const qs = next.toString()
    navigate(qs ? `/?${qs}` : "/")
  }

  return (
    <nav
      aria-label={t("breadcrumb.aria")}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-sm",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => goToFolder(null)}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 transition-colors",
          crumbs.length === 0
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        aria-current={crumbs.length === 0 ? "page" : undefined}
      >
        <HouseIcon className="size-3.5" />
        <span className="hidden sm:inline">{t("breadcrumb.all")}</span>
      </button>

      {crumbs.map((folder, index) => {
        const isLast = index === crumbs.length - 1
        return (
          <React.Fragment key={folder.id}>
            <CaretRightIcon className="size-3 shrink-0 text-muted-foreground/60" />
            <button
              type="button"
              onClick={() => {
                if (!isLast) goToFolder(folder.id)
              }}
              disabled={isLast}
              className={cn(
                "min-w-0 truncate rounded-md px-1.5 py-1 transition-colors",
                isLast
                  ? "cursor-default font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-current={isLast ? "page" : undefined}
            >
              {folder.name}
            </button>
          </React.Fragment>
        )
      })}
    </nav>
  )
}
