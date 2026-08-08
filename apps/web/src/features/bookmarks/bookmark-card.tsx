import { useTranslation } from "react-i18next"
import { StarIcon, GitForkIcon, ClockIcon, HeartIcon } from "@phosphor-icons/react"
import { Badge } from "@workspace/ui/components/badge"
import { Skeleton } from "@workspace/ui/components/skeleton"
import type { Bookmark } from "@/lib/types"
import { HealthStatusBadge } from "./health-status-badge"
import { BookmarkAccountCopyButton } from "./bookmark-account-copy-button"
import { BookmarkOpenButton } from "./bookmark-open-button"

interface BookmarkCardProps {
  bookmark: Bookmark
  onClick?: () => void
}

export function BookmarkCard({ bookmark, onClick }: BookmarkCardProps) {
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
      className={
        isGithub && bookmark.health_status === "unavailable"
          ? "group relative flex flex-col justify-between rounded-xl border border-border/60 bg-card p-4 text-card-foreground shadow-2xs transition-all hover:border-border hover:bg-accent/30 hover:shadow-xs cursor-pointer opacity-75"
          : "group relative flex flex-col justify-between rounded-xl border border-border/60 bg-card p-4 text-card-foreground shadow-2xs transition-all hover:border-border hover:bg-accent/30 hover:shadow-xs cursor-pointer"
      }
    >
      <div className="space-y-3 min-w-0">
        {isTwitter && bookmark.image_url ? (
          <div className="-mx-4 -mt-4 overflow-hidden rounded-t-xl">
            <img
              src={bookmark.image_url}
              alt=""
              className="aspect-[16/9] w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : null}
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {bookmark.favicon_url ? (
                <img
                  src={bookmark.favicon_url}
                  alt=""
                  className="size-4 shrink-0 rounded-sm"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <h3
                className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors flex-1"
                title={displayTitle}
              >
                {displayTitle}
              </h3>
            </div>
            {bookmark.archived_at && (
              <Badge variant="secondary" className="text-[10px] h-4.5 px-1.5 shrink-0 font-normal">
                {t("card.archived")}
              </Badge>
            )}
            {isGithub ? (
              <HealthStatusBadge status={bookmark.health_status} />
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {bookmark.folder_name && (
              <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 font-normal text-muted-foreground border-border/80">
                {bookmark.folder_name}
              </Badge>
            )}
            {!isGithub && siteLabel ? (
              <span className="truncate text-xs text-muted-foreground">
                {isTwitter && bookmark.owner
                  ? `@${bookmark.owner}`
                  : siteLabel}
              </span>
            ) : null}
            {bookmark.language && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-primary/80" />
                {bookmark.language}
              </span>
            )}
          </div>
        </div>

        <div className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
          {isPending ? (
            bookmark.description ? (
              <div className="space-y-1">
                <p className="line-clamp-2">{bookmark.description}</p>
                <p className="text-[10px] text-muted-foreground/80">{t("card.aiPending")}</p>
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
      </div>

      <div className="space-y-2.5 pt-3 mt-3 border-t border-border/40 min-w-0">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
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

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2.5">
            {popularity !== null && (
              <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                {isTwitter ? (
                  <HeartIcon className="size-3.5 text-rose-500/90 dark:text-rose-400" weight="fill" />
                ) : (
                  <StarIcon className="size-3.5 text-amber-500/90 dark:text-amber-400" />
                )}
                {popularity}
              </span>
            )}

            {isGithub && bookmark.forks !== undefined && (
              <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                <GitForkIcon className="size-3.5" />
                {bookmark.forks}
              </span>
            )}

            {formattedDate && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground/80">
                <ClockIcon className="size-3" />
                {formattedDate}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            <BookmarkAccountCopyButton bookmark={bookmark} />
            <BookmarkOpenButton bookmark={bookmark} className="-mr-1" />
          </div>
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
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3.5 w-full mt-2" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
      <div className="pt-2 border-t border-border/30 space-y-2">
        <div className="flex gap-1">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
        </div>
        <div className="flex justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    </div>
  )
}
