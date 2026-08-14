import { useTranslation } from "react-i18next"
import { isLikelySiteIconUrl } from "@mankr/shared"
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
import { PricingFeaturedBadges } from "./pricing-featured-badges"
import { HealthStatusBadge } from "./health-status-badge"
import { BookmarkAccountCopyButton } from "./bookmark-account-copy-button"
import { BookmarkLikeButton } from "./bookmark-like-button"
import { BookmarkOpenButton } from "./bookmark-open-button"
import { BookmarkSelectControl } from "./bookmark-select-control"

interface BookmarkRowProps {
  bookmark: Bookmark
  onClick?: () => void
  selectable?: boolean
  selected?: boolean
  onSelectedChange?: (id: string, selected: boolean) => void
}

export function BookmarkRow({
  bookmark,
  onClick,
  selectable,
  selected,
  onSelectedChange,
}: BookmarkRowProps) {
  const { t, i18n } = useTranslation("bookmarks")
  const isGithub = bookmark.source_type === "github"
  const isTwitter = bookmark.source_type === "twitter"
  const isPending = bookmark.ai_status === "pending"
  const maxTagsShow = 2
  const tags = bookmark.tags || []
  const visibleTags = tags.slice(0, maxTagsShow)
  const hiddenTagsCount = tags.length - maxTagsShow
  const displayTitle = isGithub
    ? bookmark.external_id || bookmark.title
    : bookmark.title
  const hasCover =
    Boolean(bookmark.image_url) &&
    bookmark.image_url !== bookmark.favicon_url &&
    !isLikelySiteIconUrl(bookmark.image_url!)

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
        "group relative flex w-full max-w-full min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-card p-3 text-card-foreground shadow-2xs sm:gap-4 sm:p-3.5",
        "transition-[translate,box-shadow,border-color,background-color] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:border-border hover:bg-accent/30 hover:shadow-md",
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

      {hasCover ? (
        <div className="h-16 w-20 shrink-0 overflow-hidden rounded-md bg-muted sm:h-20 sm:w-24">
          <img
            src={bookmark.image_url!}
            alt=""
            className="size-full object-cover transition-[scale] duration-300 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* 第一行：标题与关键微标 */}
        <div className="flex min-w-0 items-center justify-between gap-2">
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
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground transition-colors duration-200 group-hover:text-primary sm:text-base">
              {displayTitle}
            </h3>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {bookmark.archived_at && (
              <Badge
                variant="secondary"
                className="shrink-0 text-xs h-5 px-1.5 font-normal"
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

        {/* 第二行：摘要描述 */}
        <div className="min-w-0 text-xs text-muted-foreground/90 line-clamp-1 sm:line-clamp-2 leading-relaxed break-words">
          {isPending ? (
            bookmark.description ? (
              <div className="space-y-0.5">
                <p className="line-clamp-1">{bookmark.description}</p>
                <p className="text-xs text-muted-foreground/75">
                  {t("card.aiPending")}
                </p>
              </div>
            ) : (
              <div className="space-y-1 py-0.5">
                <Skeleton className="h-3.5 w-4/5" />
              </div>
            )
          ) : (
            bookmark.summary_ai || bookmark.description || t("card.noSummary")
          )}
        </div>

        {/* 第三行：元数据流（左侧）与 操作区（右侧） */}
        <div className="flex items-center justify-between gap-2 pt-0.5 min-w-0 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
            {bookmark.folder_name && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <FolderIcon className="size-3.5" />
                <span className="truncate max-w-[100px]">
                  {bookmark.folder_name}
                </span>
              </span>
            )}

            {showOwner && (
              <>
                {bookmark.folder_name ? (
                  <span className="text-muted-foreground/30">·</span>
                ) : null}
                <span className="hidden max-w-[100px] shrink-0 truncate text-xs text-muted-foreground sm:inline">
                  {ownerDisplay}
                </span>
              </>
            )}

            {bookmark.language && (
              <>
                {(bookmark.folder_name || showOwner) && (
                  <span className="text-muted-foreground/30">·</span>
                )}
                <span className="inline-flex items-center gap-1 font-mono text-xs">
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
                <span className="inline-flex items-center gap-1 font-mono text-xs">
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
                <span className="hidden sm:inline-flex items-center gap-1 font-mono text-xs">
                  <GitForkIcon className="size-3.5" />
                  {bookmark.forks}
                </span>
              </>
            )}

            {tags.length > 0 && (
              <div className="hidden sm:flex min-w-0 flex-wrap items-center gap-1">
                <span className="text-muted-foreground/30">·</span>
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

            {formattedDate && (
              <span className="hidden md:inline-flex items-center gap-1 font-mono text-xs text-muted-foreground/75">
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

          <div className="flex shrink-0 items-center gap-0.5 opacity-85 transition-opacity duration-200 group-hover:opacity-100">
            <BookmarkAccountCopyButton bookmark={bookmark} />
            <BookmarkLikeButton bookmark={bookmark} />
            <BookmarkOpenButton
              bookmark={bookmark}
              className="-mr-1 transition-[translate] duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function BookmarkRowSkeleton() {
  return (
    <div className="flex gap-3 rounded-lg border border-border/40 bg-card/60 p-3 sm:p-3.5">
      <Skeleton className="h-16 w-20 shrink-0 rounded-md sm:h-20 sm:w-24" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4.5 w-48" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-3.5 w-full" />
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-1.5">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  )
}
