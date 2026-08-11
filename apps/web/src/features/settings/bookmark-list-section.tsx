import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  BOOKMARK_PAGINATION_MODES,
  DEFAULT_BOOKMARK_PAGE_SIZE,
  DEFAULT_BOOKMARK_PAGINATION_MODE,
  MAX_BOOKMARK_PAGE_SIZE,
  MIN_BOOKMARK_PAGE_SIZE,
} from "@mankr/shared"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { patchAuthStatus } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { BookmarkPaginationMode, User } from "@/lib/types"

const MODE_LABEL_KEYS: Record<BookmarkPaginationMode, string> = {
  auto: "bookmarkList.modeAuto",
  manual: "bookmarkList.modeManual",
  pagination: "bookmarkList.modePagination",
}

/** 实例级收藏列表分页设置：登录用户与公开访客读到同一份值 */
export function BookmarkListSection({ user }: { user: User | undefined }) {
  const { t } = useTranslation(["settings", "common"])
  const queryClient = useQueryClient()

  const [mode, setMode] = React.useState<BookmarkPaginationMode>(
    DEFAULT_BOOKMARK_PAGINATION_MODE,
  )
  const [pageSize, setPageSize] = React.useState(
    String(DEFAULT_BOOKMARK_PAGE_SIZE),
  )

  React.useEffect(() => {
    if (user?.bookmark_pagination_mode) setMode(user.bookmark_pagination_mode)
    if (user?.bookmark_page_size != null) {
      setPageSize(String(user.bookmark_page_size))
    }
  }, [user])

  const save = useMutation({
    mutationFn: () =>
      api.updateBookmarkPagination({
        bookmark_pagination_mode: mode,
        bookmark_page_size: Number(pageSize),
      }),
    onSuccess: (res) => {
      setMode(res.bookmark_pagination_mode)
      setPageSize(String(res.bookmark_page_size))
      // 收藏页从 auth.status 读实例设置，两处缓存都要跟上才能不刷新即生效
      queryClient.setQueryData(queryKeys.auth.me, (prev: User | undefined) =>
        prev ? { ...prev, ...res } : prev,
      )
      patchAuthStatus(queryClient, res)
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.status })
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("toasts.bookmarkPaginationSaved"))
    },
    onError: (err: Error) => toast.error(formatApiError(err, t)),
  })

  // 原生 min/max/step 已挡下越界与小数，这里补的是原生放行的空值
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const size = Number(pageSize)
    if (
      !pageSize.trim() ||
      !Number.isInteger(size) ||
      size < MIN_BOOKMARK_PAGE_SIZE ||
      size > MAX_BOOKMARK_PAGE_SIZE
    ) {
      toast.error(t("bookmarkList.pageSizeInvalid"))
      return
    }
    save.mutate()
  }

  const modeItems = BOOKMARK_PAGINATION_MODES.map((value) => ({
    value,
    label: t(MODE_LABEL_KEYS[value]),
  }))

  return (
    <section id="bookmark-list" className="scroll-mt-16 space-y-4 border-t border-border pt-6 lg:scroll-mt-6">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("bookmarkList.section")}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("bookmarkList.description")}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 bg-card p-4 rounded-xl border border-border/60"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="paginationMode" className="text-xs font-medium">
              {t("bookmarkList.modeLabel")}
            </Label>
            <Select
              items={modeItems}
              value={mode}
              onValueChange={(val) =>
                setMode(
                  (val as BookmarkPaginationMode | null) ??
                    DEFAULT_BOOKMARK_PAGINATION_MODE,
                )
              }
            >
              <SelectTrigger id="paginationMode" className="h-9 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {t("bookmarkList.modeHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bookmarkPageSize" className="text-xs font-medium">
              {t("bookmarkList.pageSizeLabel")}
            </Label>
            <Input
              id="bookmarkPageSize"
              type="number"
              inputMode="numeric"
              min={MIN_BOOKMARK_PAGE_SIZE}
              max={MAX_BOOKMARK_PAGE_SIZE}
              step={1}
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value)}
              className="h-9 text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("bookmarkList.pageSizeHint")}
            </p>
          </div>
        </div>

        <Button
          type="submit"
          size="sm"
          disabled={save.isPending}
          className="text-xs font-medium"
        >
          {save.isPending ? t("common:actions.wait") : t("bookmarkList.save")}
        </Button>
      </form>
    </section>
  )
}
