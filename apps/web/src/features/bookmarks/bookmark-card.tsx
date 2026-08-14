import { useTranslation } from "react-i18next"
import {
  StarIcon,
  GitForkIcon,
  ClockIcon,
  EyeIcon,
  HeartIcon,
  FolderIcon,
} from "@phosphor-icons/react"
import { Badge } from "@workspace/ui/components/badge"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import type { Bookmark } from "@/lib/types"
import { HealthStatusBadge } from "./health-status-badge"
import { PricingFeaturedBadges } from "./pricing-featured-badges"
import { BookmarkAccountCopyButton } from "./bookmark-account-copy-button"
import { BookmarkLikeButton } from "./bookmark-like-button"
import { BookmarkOpenButton } from "./bookmark-open-button"
import { BookmarkSelectControl } from "./bookmark-select-control"

interface BookmarkCardProps {
  bookmark: Bookmark
  onClick?: () => void
  selectable?: boolean
  selected?: boolean
  onSelectedChange?: (id: string, selected: boolean) => void
}

export function BookmarkCard({
  bookmark,
  onClick,
  selectable,
  selected,
  onSelectedChange,
}: BookmarkCardProps) {
  const { t, i18n } = useTranslation("bookmarks")
  const isGithub = bookmark.source_type === "github"
  const isTwitter = bookmark.source_type === "twitter"
  const isPending = bookmark.ai_status === "pending"
  const maxTagsShow = 3
  const tags = bookmark.tags || []
  const visibleTags = tags.slice(0, maxTagsShow)
  const hiddenTagsCount = tags.length - maxTagsShow
  const displayTitle = isGithub
    ? bookmark.external_id || bookmark.title
    : bookmark.title

  const formatCount = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  const popularity =
    (isGithub || isTwitter) && bookmark.stars !== undefined
      ? formatCount(bookmark.stars)
      : null

  const viewCount = bookmark.view_count ?? 0

  const formattedDate = bookmark.pushed_at
    ? new Date(bookmark.pushed_at).toLocaleDateString(i18n.language, {
        month: "numeric",
        day: "numeric",
      })
    : null

  const rawOwner = bookmark.owner?.trim()
  const siteLabel = bookmark.site_name || rawOwner
  // 标题中已包含作者名（如推文标题带 @handle，或 GitHub 仓库本身就是 owner/repo）时，元信息行不再重复展示
  const isOwnerInTitle = Boolean(
    rawOwner &&
      (displayTitle.toLowerCase().includes(rawOwner.toLowerCase()) ||
        displayTitle.toLowerCase().includes(`@${rawOwner.toLowerCase()}`)),
  )
  const showOwner =
    !isGithub && Boolean(siteLabel) && (!rawOwner || !isOwnerInTitle)
  const ownerDisplay = isTwitter && rawOwner ? `@${rawOwner}` : siteLabel

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex cursor-pointer flex-col justify-between rounded-xl border border-border/60 bg-card p-4 text-card-foreground shadow-2xs",
        // 保持流畅硬件加速交互
        "transition-[translate,box-shadow,border-color,background-color] duration-200 ease-out",
        "hover:-translate-y-1 hover:border-border hover:bg-accent/30 hover:shadow-md",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        isGithub && bookmark.health_status === "unavailable" && "opacity-75",
        selected && "border-primary/60 bg-primary/5",
      )}
    >
      {selectable ? (
        <BookmarkSelectControl
          selected={selected}
          ariaLabel={t("batch.selectAria")}
          className="top-1.5 right-1.5"
          onSelectedChange={(next) => onSelectedChange?.(bookmark.id, next)}
        />
      ) : null}

      <div className="min-w-0 space-y-2.5">
        {isTwitter && bookmark.image_url ? (
          <div className="-mx-4 -mt-4 overflow-hidden rounded-t-xl">
            <img
              src={bookmark.image_url}
              alt=""
              className="aspect-[16/9] w-full object-cover transition-[scale] duration-300 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : null}

        {/* 头部：标题与关键微标 */}
        <div className="space-y-1.5 min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {bookmark.favicon_url ? (
                <img
                  src={bookmark.favicon_url}
                  alt=""
                  className="size-4 shrink-0 rounded-sm transition-[scale] duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <h3
                className="flex-1 truncate text-sm font-semibold tracking-tight text-foreground transition-colors duration-200 group-hover:text-primary"
                title={displayTitle}
              >
                {displayTitle}
              </h3>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {bookmark.archived_at && (
                <Badge
                  variant="secondary"
                  className="text-xs h-5 px-1.5 font-normal"
                >
                  {t("card.archived")}
                </Badge>
              )}
              {isGithub ? (
                <HealthStatusBadge status={bookmark.health_status} />
              ) : null}
              <PricingFeaturedBadges bookmark={bookmark} />
            </div>
          </div>

          {/* 元信息行：去重并流式对齐 */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
            {bookmark.folder_name && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <FolderIcon className="size-3.5" />
                <span className="truncate max-w-[120px]">
                  {bookmark.folder_name}
                </span>
              </span>
            )}

            {showOwner && (
              <>
                {bookmark.folder_name ? (
                  <span className="text-muted-foreground/30">·</span>
                ) : null}
                <span className="truncate max-w-[120px] text-xs text-muted-foreground">
                  {ownerDisplay}
                </span>
              </>
            )}

            {bookmark.language && (
              <>
                {(bookmark.folder_name || showOwner) && (
                  <span className="text-muted-foreground/30">·</span>
                )}
                <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-primary/80" />
                  {bookmark.language}
                </span>
              </>
            )}

            {popularity !== null && (
              <>
                {(bookmark.folder_name || showOwner || bookmark.language) && (
                  <span className="text-muted-foreground/30">·</span>
                )}
                <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  {isTwitter ? (
                    <HeartIcon
                      className="size-3.5 text-rose-500/90 dark:text-rose-400"
                      weight="fill"
                    />
                  ) : (
                    <StarIcon className="size-3.5 text-amber-500/90 dark:text-amber-400" />
                  )}
                  {popularity}
                </span>
              </>
            )}

            {isGithub && bookmark.forks !== undefined && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  <GitForkIcon className="size-3.5" />
                  {bookmark.forks}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 摘要描述区 */}
        <div className="text-xs text-muted-foreground/90 line-clamp-3 leading-relaxed break-words">
          {isPending ? (
            bookmark.description ? (
              <div className="space-y-1">
                <p className="line-clamp-2">{bookmark.description}</p>
                <p className="text-xs text-muted-foreground/75">
                  {t("card.aiPending")}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 py-0.5">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            )
          ) : (
            bookmark.summary_ai || bookmark.description || t("card.noSummary")
          )}
        </div>

        {/* 标签区：融入卡片内容主体 */}
        {tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap min-w-0 pt-0.5">
            {visibleTags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="h-5 px-1.5 text-xs font-normal bg-muted/50 text-muted-foreground/80 hover:bg-muted hover:text-foreground border-transparent"
              >
                #{tag}
              </Badge>
            ))}
            {hiddenTagsCount > 0 && (
              <span className="text-xs text-muted-foreground/70">
                +{hiddenTagsCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 底部条：贯穿左右外边框的独立操作底栏 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground -mx-4 -mb-4 mt-3 px-4 py-2 border-t border-border/50 rounded-b-xl min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {formattedDate && (
            <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground/75">
              <ClockIcon className="size-3.5" />
              {formattedDate}
            </span>
          )}

          {viewCount > 0 && (
            <span
              className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground/75"
              title={t("card.viewCount")}
            >
              <EyeIcon className="size-3.5" />
              {viewCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 opacity-85 transition-opacity duration-200 group-hover:opacity-100">
          <BookmarkAccountCopyButton bookmark={bookmark} />
          <BookmarkLikeButton bookmark={bookmark} />
          <BookmarkOpenButton
            bookmark={bookmark}
            className="-mr-1 transition-[translate] duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
          />
        </div>
      </div>
    </div>
  )
}

export function BookmarkCardSkeleton() {
  return (
    <div className="flex flex-col justify-between h-48 rounded-xl border border-border/40 bg-card/60 p-4 space-y-3">
      <div className="space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3.5 w-full mt-2" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
      <div className="-mx-4 -mb-4 mt-3 flex items-center justify-between border-t border-border/30 px-4 py-2.5 rounded-b-xl">
        <Skeleton className="h-3 w-16" />
        <div className="flex gap-1">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-10" />
        </div>
      </div>
    </div>
  )
}
