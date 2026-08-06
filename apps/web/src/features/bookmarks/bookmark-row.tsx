import { useTranslation } from "react-i18next"
import { StarIcon, GitForkIcon, ClockIcon } from "@phosphor-icons/react"
import { Badge } from "@workspace/ui/components/badge"
import { Skeleton } from "@workspace/ui/components/skeleton"
import type { Bookmark } from "@/lib/types"
import { HealthStatusBadge } from "./health-status-badge"
import { BookmarkOpenButton } from "./bookmark-open-button"

interface BookmarkRowProps {
  bookmark: Bookmark
  onClick?: () => void
}

export function BookmarkRow({ bookmark, onClick }: BookmarkRowProps) {
  const { t, i18n } = useTranslation("bookmarks")
  const isGithub = bookmark.source_type === "github"
  const isPending = bookmark.ai_status === "pending"
  const maxTagsShow = 3
  const tags = bookmark.tags || []
  const visibleTags = tags.slice(0, maxTagsShow)
  const hiddenTagsCount = tags.length - maxTagsShow
  const displayTitle = isGithub
    ? bookmark.external_id || bookmark.title
    : bookmark.title

  const formattedStars =
    isGithub && bookmark.stars !== undefined
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
      className="group relative flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-3.5 md:p-4 text-card-foreground shadow-2xs transition-all hover:border-border hover:bg-accent/30 cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {bookmark.favicon_url ? (
            <img
              src={bookmark.favicon_url}
              alt=""
              className="size-4 shrink-0 rounded-sm"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <h3 className="font-semibold text-sm md:text-base text-foreground truncate group-hover:text-primary transition-colors">
            {displayTitle}
          </h3>

          {bookmark.folder_name && (
            <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 font-normal text-muted-foreground border-border/80">
              {bookmark.folder_name}
            </Badge>
          )}

          {!isGithub && siteLabel ? (
            <span className="hidden sm:inline text-[10px] text-muted-foreground truncate max-w-[8rem]">
              {siteLabel}
            </span>
          ) : null}

          {bookmark.archived_at && (
            <Badge variant="secondary" className="text-[10px] h-4.5 px-1.5 font-normal">
              {t("card.archived")}
            </Badge>
          )}
          {isGithub ? <HealthStatusBadge status={bookmark.health_status} /> : null}
        </div>

        <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          {bookmark.language && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px]">
              <span className="size-2 rounded-full bg-primary/80" />
              {bookmark.language}
            </span>
          )}

          {formattedStars !== null && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px]">
              <StarIcon className="size-3.5 text-amber-500" />
              {formattedStars}
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

      <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
        {isPending ? (
          bookmark.description ? (
            <div className="space-y-0.5">
              <p className="line-clamp-1">{bookmark.description}</p>
              <p className="text-[10px] text-muted-foreground/80">{t("card.aiPending")}</p>
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
              className="text-[10px] h-4 px-1.5 font-normal bg-muted/60 hover:bg-muted text-muted-foreground"
            >
              #{tag}
            </Badge>
          ))}
          {hiddenTagsCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              +{hiddenTagsCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {formattedDate && (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/80">
              <ClockIcon className="size-3" />
              {formattedDate}
            </span>
          )}
          <BookmarkOpenButton bookmark={bookmark} className="-mr-1" />
        </div>
      </div>
    </div>
  )
}

export function BookmarkRowSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-card/60 p-4">
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
  )
}
