import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { Bookmark } from "@/lib/types"

export interface BookmarkFormValues {
  summaryAi: string
  folderId: string
  tagsInput: string
  notes: string
  trackUpdates: boolean
  accountRegistered: boolean
  accountUsername: string
  accountPassword: string
  /** 只有用户动过密码框才提交 account_password，避免误清空已存密码 */
  passwordDirty: boolean
}

const EMPTY_VALUES: BookmarkFormValues = {
  summaryAi: "",
  folderId: "",
  tagsInput: "",
  notes: "",
  trackUpdates: true,
  accountRegistered: false,
  accountUsername: "",
  accountPassword: "",
  passwordDirty: false,
}

function fromBookmark(bookmark: Bookmark): BookmarkFormValues {
  return {
    summaryAi: bookmark.summary_ai || "",
    folderId: bookmark.folder_id || "",
    tagsInput: bookmark.tags ? bookmark.tags.join(", ") : "",
    notes: bookmark.notes || "",
    trackUpdates: bookmark.track_updates ?? true,
    accountRegistered: Boolean(bookmark.account_registered),
    accountUsername: bookmark.account_username || "",
    accountPassword: "",
    passwordDirty: false,
  }
}

function parseTags(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean)
}

/**
 * 编辑态的表单状态与保存。草稿只在编辑态存在：退出编辑就丢弃，
 * 下次进入重新以服务端数据为准，这样展示态永远是真相。
 */
export function useBookmarkDetailForm({
  bookmark,
  bookmarkId,
  editing,
  onSaved,
}: {
  bookmark: Bookmark | undefined
  bookmarkId: string | null
  editing: boolean
  onSaved: () => void
}) {
  const { t } = useTranslation(["bookmarks", "common", "errors"])
  const queryClient = useQueryClient()

  const [values, setValues] = React.useState<BookmarkFormValues>(EMPTY_VALUES)
  const dirty = React.useRef(false)
  const hydratedFor = React.useRef<string | null>(null)
  const lastAiStatus = React.useRef<string | undefined>(undefined)

  const patch = React.useCallback((next: Partial<BookmarkFormValues>) => {
    dirty.current = true
    setValues((prev) => ({ ...prev, ...next }))
  }, [])

  React.useEffect(() => {
    if (editing) return
    hydratedFor.current = null
    dirty.current = false
  }, [editing])

  React.useEffect(() => {
    if (!editing || !bookmark || !bookmarkId) return
    if (hydratedFor.current === bookmarkId) return
    setValues(fromBookmark(bookmark))
    dirty.current = false
    hydratedFor.current = bookmarkId
  }, [editing, bookmark, bookmarkId])

  // 编辑期间点了「重新生成」，AI 落地后把新摘要接进来——除非用户已经自己改过
  React.useEffect(() => {
    const status = bookmark?.ai_status
    const justFinished =
      lastAiStatus.current === "pending" && !!status && status !== "pending"
    if (justFinished && editing && bookmark && !dirty.current) {
      setValues(fromBookmark(bookmark))
    }
    lastAiStatus.current = status
  }, [bookmark, editing])

  const updateMutation = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof api.updateBookmark>[1] = {
        summary_ai: values.summaryAi.trim() || null,
        folder_id: values.folderId || null,
        tags: parseTags(values.tagsInput),
        notes: values.notes.trim() || null,
        track_updates: values.trackUpdates,
      }

      if (bookmark?.source_type === "url") {
        payload.account_registered = values.accountRegistered
        payload.account_username = values.accountUsername.trim() || null
        if (values.passwordDirty) {
          payload.account_password = values.accountPassword
        }
      }

      return api.updateBookmark(bookmarkId!, payload)
    },
    onSuccess: () => {
      dirty.current = false
      setValues((prev) => ({
        ...prev,
        accountPassword: "",
        passwordDirty: false,
      }))
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      toast.success(t("detail.saved"))
      onSaved()
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("detail.saveFailed"))
    },
  })

  return { values, patch, updateMutation }
}
