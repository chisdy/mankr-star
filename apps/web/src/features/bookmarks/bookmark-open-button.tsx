import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ArrowSquareOutIcon } from "@phosphor-icons/react"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { ExternalLink } from "@/components/external-link"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { toSafeExternalHref } from "@/lib/safe-url"
import type { Bookmark } from "@/lib/types"

interface BookmarkOpenButtonProps {
  bookmark: Bookmark
  className?: string
  /** 列表保留数字；详情底部只保留打开动作，避免与 meta 查看次数重复 */
  showCount?: boolean
}

export function BookmarkOpenButton({
  bookmark,
  className,
  showCount = true,
}: BookmarkOpenButtonProps) {
  const { t } = useTranslation("bookmarks")
  const queryClient = useQueryClient()
  const [clickCount, setClickCount] = React.useState(bookmark.click_count ?? 0)
  const safeHref = toSafeExternalHref(bookmark.canonical_url)

  React.useEffect(() => {
    setClickCount(bookmark.click_count ?? 0)
  }, [bookmark.click_count])

  const openMutation = useMutation({
    mutationFn: () => api.recordBookmarkOpen(bookmark.id),
    onSuccess: (updated) => {
      setClickCount(updated.click_count ?? 0)
      queryClient.setQueryData(
        queryKeys.bookmarks.detail(bookmark.id),
        updated,
      )
      void queryClient.invalidateQueries({
        queryKey: queryKeys.bookmarks.all,
        predicate: (query) => query.queryKey[1] !== "detail",
      })
    },
  })

  if (!safeHref) return null

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // 阻止冒泡到卡片（打开详情），但不 preventDefault，保留浏览器原生新标签行为
    e.stopPropagation()
    if (showCount) setClickCount((n) => n + 1)
    openMutation.mutate()
  }

  const label = t("open.title")

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <ExternalLink
              href={safeHref}
              onClick={handleClick}
              className={cn(
                buttonVariants({ variant: "ghost", size: "xs" }),
                "h-6 gap-1 px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground",
                className
              )}
              aria-label={
                showCount
                  ? t("open.aria", { count: clickCount })
                  : t("open.ariaOpenOnly")
              }
            >
              <ArrowSquareOutIcon
                className="size-3.5"
                data-icon="inline-start"
              />
              {showCount ? (
                <span>{clickCount}</span>
              ) : (
                <span>{t("open.action")}</span>
              )}
            </ExternalLink>
          }
        />
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
