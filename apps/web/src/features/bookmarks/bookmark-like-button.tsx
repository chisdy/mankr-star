import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ThumbsUpIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { Bookmark } from "@/lib/types"

interface BookmarkLikeButtonProps {
  bookmark: Bookmark
  className?: string
}

/**
 * 本站点赞，与 X 同步进 stars 的原帖赞数是两回事，所以用手势图标而非红心。
 * 后端按 IP+UA 指纹去重，公开浏览的访客也能点。
 */
export function BookmarkLikeButton({
  bookmark,
  className,
}: BookmarkLikeButtonProps) {
  const { t } = useTranslation(["bookmarks", "errors"])
  const queryClient = useQueryClient()
  const [likeCount, setLikeCount] = React.useState(bookmark.like_count ?? 0)

  React.useEffect(() => {
    setLikeCount(bookmark.like_count ?? 0)
  }, [bookmark.like_count])

  const { data: likedIds } = useQuery({
    queryKey: queryKeys.bookmarkLikes.mine,
    queryFn: () => api.getMyLikes(),
    staleTime: 60_000,
  })
  const liked = likedIds?.includes(bookmark.id) ?? false

  const setLikedInCache = React.useCallback(
    (next: boolean) => {
      queryClient.setQueryData<string[]>(
        queryKeys.bookmarkLikes.mine,
        (prev = []) =>
          next
            ? prev.includes(bookmark.id)
              ? prev
              : [...prev, bookmark.id]
            : prev.filter((id) => id !== bookmark.id),
      )
    },
    [bookmark.id, queryClient],
  )

  const toggleMutation = useMutation({
    mutationFn: (next: boolean) =>
      next ? api.likeBookmark(bookmark.id) : api.unlikeBookmark(bookmark.id),
    onMutate: (next) => {
      const prevCount = likeCount
      // 已赞态存在 query 缓存里，乐观更新缓存本身，组件重挂载也不会闪回
      setLikedInCache(next)
      setLikeCount((n) => Math.max(0, n + (next ? 1 : -1)))
      return { prevCount, prevLiked: !next }
    },
    onSuccess: (result) => {
      setLikeCount(result.like_count)
      setLikedInCache(result.liked)
      // 列表里变的只有这一个数字，全量 invalidate 会让整页闪烁
      void queryClient.invalidateQueries({
        queryKey: queryKeys.bookmarks.rankings,
      })
      queryClient.setQueryData<Bookmark>(
        queryKeys.bookmarks.detail(bookmark.id),
        (prev) => (prev ? { ...prev, like_count: result.like_count } : prev),
      )
    },
    onError: (err: Error, _next, context) => {
      if (context) {
        setLikeCount(context.prevCount)
        setLikedInCache(context.prevLiked)
      }
      toast.error(formatApiError(err, t) || t("bookmarks:like.failed"))
    },
  })

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // 卡片整体可点开详情，不拦住就会连带记一次「查看」，把排行榜刷歪
    e.stopPropagation()
    // 连点会并发出赞和取消赞两个请求，谁后返回谁说了算，UI 可能停在与服务端相反的状态
    if (toggleMutation.isPending) return
    toggleMutation.mutate(!liked)
  }

  // 按钮上只有一个数字，鼠标看 tooltip，读屏看 aria——后者带上计数才完整
  const label = liked ? t("bookmarks:like.undo") : t("bookmarks:like.action")
  const ariaLabel = t(
    liked ? "bookmarks:like.ariaUndo" : "bookmarks:like.aria",
    { count: likeCount },
  )

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={handleClick}
              aria-pressed={liked}
              aria-label={ariaLabel}
              className={cn(
                buttonVariants({ variant: "ghost", size: "xs" }),
                "h-6.5 gap-1 px-2 font-mono text-xs text-muted-foreground hover:text-foreground",
                liked && "text-primary hover:text-primary",
                className,
              )}
            >
              <ThumbsUpIcon
                className="size-3.5"
                weight={liked ? "fill" : "regular"}
                data-icon="inline-start"
              />
              {likeCount > 0 || liked ? (
                <span>{likeCount}</span>
              ) : null}
            </button>
          }
        />
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
