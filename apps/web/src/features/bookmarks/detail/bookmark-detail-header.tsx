import { useTranslation } from "react-i18next"

import { DialogTitle } from "@workspace/ui/components/dialog"
import type { Bookmark } from "@/lib/types"

function displayTitle(bookmark: Bookmark | undefined, fallback: string) {
  if (!bookmark) return fallback
  return bookmark.title || bookmark.external_id || fallback
}

export function BookmarkDetailHeader({
  bookmark,
}: {
  bookmark: Bookmark | undefined
}) {
  const { t } = useTranslation("bookmarks")
  const title = displayTitle(bookmark, t("detail.titleFallback"))

  return (
    <div className="shrink-0 space-y-1 border-b border-border/50 bg-muted/50 p-4 md:p-6">
      <div className="pr-10">
        <DialogTitle className="min-w-0 truncate text-base font-semibold text-foreground md:text-lg">
          {title}
        </DialogTitle>
      </div>

      {bookmark?.description ? (
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {bookmark.description}
        </p>
      ) : null}
    </div>
  )
}
