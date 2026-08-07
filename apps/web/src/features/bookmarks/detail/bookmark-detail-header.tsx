import { useTranslation } from "react-i18next"

import { DialogTitle } from "@workspace/ui/components/dialog"
import type { Bookmark } from "@/lib/types"

export function BookmarkDetailHeader({
  bookmark,
  editing,
}: {
  bookmark: Bookmark | undefined
  editing: boolean
}) {
  const { t } = useTranslation("bookmarks")

  return (
    <div className="shrink-0 space-y-1 border-b border-border p-4 md:p-6">
      <div className="pr-10">
        <DialogTitle className="min-w-0 truncate text-base font-semibold text-foreground md:text-lg">
          {bookmark?.external_id || bookmark?.title || t("detail.titleFallback")}
        </DialogTitle>
      </div>

      {bookmark?.description && !editing ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {bookmark.description}
        </p>
      ) : null}
    </div>
  )
}
