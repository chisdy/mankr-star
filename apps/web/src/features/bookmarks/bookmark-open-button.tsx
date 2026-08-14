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
}

export function BookmarkOpenButton({
  bookmark,
  className,
}: BookmarkOpenButtonProps) {
  const { t } = useTranslation("bookmarks")
  const queryClient = useQueryClient()
  const [openCount, setOpenCount] = React.useState(bookmark.open_count ?? 0)
  const safeHref = toSafeExternalHref(bookmark.canonical_url)

  React.useEffect(() => {
    setOpenCount(bookmark.open_count ?? 0)
  }, [bookmark.open_count])

  const openMutation = useMutation({
    mutationFn: () => api.recordBookmarkOpen(bookmark.id, "external"),
    onSuccess: (updated) => {
      setOpenCount(updated.open_count ?? 0)
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
    setOpenCount((n) => n + 1)
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
                "h-6.5 gap-1 px-2 font-mono text-xs text-muted-foreground hover:text-foreground",
                className
              )}
              aria-label={t("open.aria", { count: openCount })}
            >
              <ArrowSquareOutIcon
                className="size-3.5"
                data-icon="inline-start"
              />
              {openCount > 0 ? <span>{openCount}</span> : null}
            </ExternalLink>
          }
        />
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
