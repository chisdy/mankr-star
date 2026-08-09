import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Dialog, DialogContent } from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { BookmarkDeleteDialog } from "./bookmark-delete-dialog"
import { BookmarkDetailFooter } from "./bookmark-detail-footer"
import { BookmarkDetailForm } from "./bookmark-detail-form"
import { BookmarkDetailHeader } from "./bookmark-detail-header"
import { BookmarkDetailView } from "./bookmark-detail-view"
import { useBookmarkDetailForm } from "./use-bookmark-detail-form"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"
import { useBookmarkDetail } from "@/hooks/use-bookmark-detail"

/**
 * 本轮打开详情期间已成功同步的 id。放模块级是为了扛住 StrictMode /
 * 查询失效导致的重挂载——useState 会被清掉，按钮又露出来。
 */
const syncedBookmarkIdsWhileOpen = new Set<string>()
let trackedOpenBookmarkId: string | null = null

function trackOpenBookmark(bookmarkId: string | null) {
  if (bookmarkId === trackedOpenBookmarkId) return
  if (trackedOpenBookmarkId) {
    syncedBookmarkIdsWhileOpen.delete(trackedOpenBookmarkId)
  }
  trackedOpenBookmarkId = bookmarkId
}

/**
 * 收藏详情。全局挂一份，开关与展示/编辑模式都由 URL 决定，
 * 所以列表、动态、KB 引用可以共用同一个入口，链接也能直接分享。
 */
export function BookmarkDetailDialog() {
  const { t } = useTranslation(["bookmarks", "common", "errors"])
  const queryClient = useQueryClient()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { bookmarkId, editing, closeDetail, setEditing } = useBookmarkDetail()

  const open = !!bookmarkId

  const { data: bookmark, isLoading } = useQuery({
    queryKey: queryKeys.bookmarks.detail(bookmarkId || ""),
    queryFn: () => api.getBookmark(bookmarkId!),
    enabled: !!bookmarkId,
    refetchInterval: (query) =>
      query.state.data?.ai_status === "pending" ? 2000 : false,
  })

  const { data: folders = [] } = useQuery({
    queryKey: queryKeys.folders.all,
    queryFn: () => api.getFolders(),
    enabled: open && editing,
  })

  // AI 归类落地后，分类树和标签会变，顺带把列表也刷了
  const lastAiStatus = React.useRef<string | undefined>(undefined)
  React.useEffect(() => {
    const status = bookmark?.ai_status
    const justFinished =
      lastAiStatus.current === "pending" && !!status && status !== "pending"
    if (justFinished) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
    }
    lastAiStatus.current = status
  }, [bookmark, queryClient])

  // 访客顺着别人分享的 &edit=1 进来：等鉴权落定后把参数抹掉，
  // 用 replace 是为了不让后退键又把这个不可用的状态翻出来
  React.useEffect(() => {
    if (authLoading || !editing || isAuthenticated) return
    setEditing(false, { replace: true })
  }, [authLoading, editing, isAuthenticated, setEditing])

  const canEdit = isAuthenticated
  const showEditor = editing && canEdit
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false)
  /** 仅用于在写入模块级 Set 后触发一次重渲染 */
  const [, setSyncHideEpoch] = React.useState(0)

  const form = useBookmarkDetailForm({
    bookmark,
    bookmarkId,
    editing: showEditor,
    onSaved: () => setEditing(false),
  })

  const regenerateAiMutation = useMutation({
    mutationFn: () => api.regenerateAi(bookmarkId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("detail.regenerateSubmitted"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("detail.regenerateFailed"))
    },
  })

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.syncBookmark(id),
    onSuccess: (data, id) => {
      syncedBookmarkIdsWhileOpen.add(id)
      setSyncHideEpoch((n) => n + 1)
      queryClient.setQueryData(queryKeys.bookmarks.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("detail.syncSubmitted"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("detail.syncFailed"))
    },
  })

  React.useEffect(() => {
    trackOpenBookmark(bookmarkId)
  }, [bookmarkId])

  const showSync =
    !!bookmark &&
    bookmark.source_type === "github" &&
    !syncedBookmarkIdsWhileOpen.has(bookmark.id)

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) =>
      api.updateBookmark(bookmarkId!, { archived }),
    onSuccess: (_, archived) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(
        archived ? t("detail.archivedToast") : t("detail.unarchivedToast"),
      )
      closeDetail()
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteBookmark(bookmarkId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("detail.deletedToast"))
      setDeleteConfirmOpen(false)
      closeDetail()
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  if (!open) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDetail()
      }}
    >
      <DialogContent className="flex h-dvh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none md:h-auto md:max-h-[85dvh] md:max-w-2xl md:rounded-xl">
        <BookmarkDetailHeader bookmark={bookmark} editing={showEditor} />

        {isLoading || !bookmark ? (
          <div className="space-y-4 p-6">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-20 w-full animate-pulse rounded bg-muted" />
            <div className="h-10 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <>
            <ScrollArea className="min-h-0">
              {showEditor ? (
                <BookmarkDetailForm
                  bookmark={bookmark}
                  folders={folders}
                  values={form.values}
                  patch={form.patch}
                  onRegenerate={() => regenerateAiMutation.mutate()}
                  regenerating={regenerateAiMutation.isPending}
                />
              ) : (
                <BookmarkDetailView
                  bookmark={bookmark}
                  isAuthenticated={isAuthenticated}
                  onRegenerate={() => regenerateAiMutation.mutate()}
                  regenerating={regenerateAiMutation.isPending}
                />
              )}
            </ScrollArea>

            <BookmarkDetailFooter
              bookmark={bookmark}
              editing={showEditor}
              canEdit={canEdit}
              onEdit={() => setEditing(true)}
              onCancelEdit={() => setEditing(false)}
              onSave={() => form.updateMutation.mutate()}
              saving={form.updateMutation.isPending}
              showSync={showSync}
              onSync={() => {
                if (!bookmarkId) return
                syncMutation.mutate(bookmarkId)
              }}
              syncing={syncMutation.isPending}
              onArchive={() => archiveMutation.mutate(!bookmark.archived_at)}
              onRequestDelete={() => setDeleteConfirmOpen(true)}
              mutating={
                archiveMutation.isPending ||
                deleteMutation.isPending ||
                syncMutation.isPending
              }
            />

            <BookmarkDeleteDialog
              open={deleteConfirmOpen}
              onOpenChange={setDeleteConfirmOpen}
              onConfirm={() => deleteMutation.mutate()}
              pending={deleteMutation.isPending}
              title={bookmark.external_id || bookmark.title}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
