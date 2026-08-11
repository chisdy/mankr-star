import { useTranslation } from "react-i18next"
import { isLikelySiteIconUrl } from "@mankr/shared"
import { StarIcon, GitForkIcon, ClockIcon, HeartIcon } from "@phosphor-icons/react"
import { Badge } from "@workspace/ui/components/badge"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import type { Bookmark } from "@/lib/types"
import { PricingFeaturedBadges } from "./pricing-featured-badges"
import { HealthStatusBadge } from "./health-status-badge"
import { BookmarkAccountCopyButton } from "./bookmark-account-copy-button"
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
  const maxTagsShow = 3
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

  const popularity =
    (isGithub || isTwitter) && bookmark.stars !== undefined
      ? bookmark.stars >= 1000
        ? `${(bookmark.stars / 1000).toFixed(1)}k`
        : bookmark.stars
      : null

  const formattedDate = bookmark.pushed_at
    ? new Date(bookmark.pushed_at).toLocaleDateString(i18n.language, {
        month: "numeric",
        day: "numeric",
      })
    : null

  const siteLabel = bookmark.site_name || bookmark.owner

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex w-full max-w-full min-w-0 cursor-pointer gap-3 rounded-lg border border-border/60 bg-card p-3.5 text-card-foreground shadow-2xs md:gap-4 md:p-4",
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
      {hasCover ? (
        <div className="size-20 shrink-0 overflow-hidden rounded-md bg-muted sm:size-24">
          <img
            src={bookmark.image_url!}
            alt=""
            className="size-full object-cover transition-[scale] duration-300 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {isTwitter && bookmark.favicon_url ? (
              <img
                src={bookmark.favicon_url}
                alt=""
                className="size-5 shrink-0 rounded-full object-cover transition-[scale] duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground transition-colors duration-200 group-hover:text-primary md:text-base">
              {displayTitle}
            </h3>

            {bookmark.folder_name && (
              <Badge
                variant="outline"
                className="max-w-[8rem] shrink-0 truncate text-[10px] h-4.5 px-1.5 font-normal text-muted-foreground border-border/80"
              >
                {bookmark.folder_name}
              </Badge>
            )}

            {!isGithub && siteLabel ? (
              <span className="hidden max-w-[8rem] shrink-0 truncate text-xs text-muted-foreground sm:inline">
                {isTwitter && bookmark.owner ? `@${bookmark.owner}` : siteLabel}
              </span>
            ) : null}

            {bookmark.archived_at && (
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] h-4.5 px-1.5 font-normal"
              >
                {t("card.archived")}
              </Badge>
            )}
            {isGithub ? (
              <HealthStatusBadge status={bookmark.health_status} />
            ) : null}
            <PricingFeaturedBadges bookmark={bookmark} />
          </div>

          <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
            {bookmark.language && (
              <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                <span className="size-2 rounded-full bg-primary/80" />
                {bookmark.language}
              </span>
            )}

            {popularity !== null && (
              <span className="inline-flex items-center gap-1 font-mono text-[11px]">
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
            )}

            {isGithub && bookmark.forks !== undefined && (
              <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[11px]">
                <GitForkIcon className="size-3.5" />
                {bookmark.forks}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0 text-xs text-muted-foreground line-clamp-2 leading-relaxed break-words">
          {isPending ? (
            bookmark.description ? (
              <div className="space-y-0.5">
                <p className="line-clamp-1">{bookmark.description}</p>
                <p className="text-[10px] text-muted-foreground/80">
                  {t("card.aiPending")}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 py-0.5">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            )
          ) : (
            bookmark.summary_ai || bookmark.description || t("card.noSummary")
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1 min-w-0 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {visibleTags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="h-5 px-1.5 text-xs font-normal bg-muted/60 text-muted-foreground hover:bg-muted"
              >
                #{tag}
              </Badge>
            ))}
            {hiddenTagsCount > 0 && (
              <span className="text-xs text-muted-foreground">
                +{hiddenTagsCount}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity duration-200 group-hover:opacity-100">
            {formattedDate && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground/80">
                <ClockIcon className="size-3" />
                {formattedDate}
              </span>
            )}
            <BookmarkAccountCopyButton bookmark={bookmark} />
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
    <div className="flex gap-3 rounded-lg border border-border/40 bg-card/60 p-4">
      <Skeleton className="size-20 shrink-0 rounded-md sm:size-24" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
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
