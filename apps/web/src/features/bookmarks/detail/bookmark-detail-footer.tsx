import { useTranslation } from "react-i18next"
import {
  ArchiveIcon,
  ArrowsClockwiseIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { BookmarkOpenButton } from "../bookmark-open-button"
import type { Bookmark } from "@/lib/types"

/** 详情弹窗底部的操作条，一律右对齐 */
export function BookmarkDetailFooter({
  bookmark,
  editing,
  canEdit,
  onEdit,
  onCancelEdit,
  onSave,
  saving,
  onSync,
  syncing,
  showSync,
  onArchive,
  onRequestDelete,
  mutating,
}: {
  bookmark: Bookmark
  editing: boolean
  canEdit: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  saving: boolean
  onSync?: () => void
  syncing?: boolean
  /** 同步成功后隐藏，本轮详情只允许一次 */
  showSync?: boolean
  onArchive: () => void
  onRequestDelete: () => void
  mutating: boolean
}) {
  const { t } = useTranslation(["bookmarks", "common"])

  const hasExternalLink = Boolean(bookmark.canonical_url)
  if (!hasExternalLink && !canEdit) return null

  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/50 bg-muted/50 p-3">
      {editing ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancelEdit}
            disabled={saving}
            className="h-8 text-xs"
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving}
            className="h-8 text-xs font-medium"
          >
            {saving ? t("common:actions.wait") : t("common:actions.save")}
          </Button>
        </>
      ) : (
        <>
          {canEdit ? (
            <>
              {showSync && onSync ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onSync}
                  disabled={syncing || mutating}
                  className="h-8 gap-1 text-xs"
                  title={t("detail.syncHint")}
                >
                  <ArrowsClockwiseIcon
                    className={`size-3.5 ${syncing ? "animate-spin" : ""}`}
                  />
                  <span>{t("detail.sync")}</span>
                </Button>
              ) : null}

              <Button
                variant="outline"
                size="sm"
                onClick={onArchive}
                disabled={mutating}
                className="h-8 gap-1 text-xs"
              >
                <ArchiveIcon className="size-3.5" />
                <span>
                  {bookmark.archived_at
                    ? t("detail.unarchive")
                    : t("detail.archive")}
                </span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="h-8 gap-1 text-xs"
              >
                <PencilSimpleIcon className="size-3.5" />
                <span>{t("detail.edit")}</span>
              </Button>

              <Button
                variant="destructive"
                size="sm"
                onClick={onRequestDelete}
                disabled={mutating}
                className="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <TrashIcon className="size-3.5" />
                <span>{t("common:actions.delete")}</span>
              </Button>
            </>
          ) : null}

          {hasExternalLink ? (
            <BookmarkOpenButton
              bookmark={bookmark}
              showCount={false}
              className="h-8 gap-1.5 rounded-md border border-input bg-secondary px-2.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            />
          ) : null}
        </>
      )}
    </div>
  )
}
