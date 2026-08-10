import { useTranslation } from "react-i18next"
import {
  ClockIcon,
  GitForkIcon,
  HeartIcon,
  StarIcon,
} from "@phosphor-icons/react"

import { Badge } from "@workspace/ui/components/badge"
import { HealthStatusBadge } from "../health-status-badge"
import { PricingFeaturedBadges } from "../pricing-featured-badges"
import type { Bookmark } from "@/lib/types"

/** 详情顶部的一行元信息：站点、语言、热度、近况、推送时间 */
export function BookmarkDetailMeta({ bookmark }: { bookmark: Bookmark }) {
  const { t, i18n } = useTranslation("bookmarks")
  const isGithub = bookmark.source_type === "github"
  const isTwitter = bookmark.source_type === "twitter"

  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-lg border border-border/50 bg-muted/30 p-2.5 text-xs text-muted-foreground">
      {bookmark.favicon_url ? (
        <img
          src={bookmark.favicon_url}
          alt=""
          className="size-4 shrink-0 rounded-sm object-contain"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}
      {(bookmark.site_name || bookmark.owner) && !isGithub ? (
        <span className="truncate text-[11px]">
          {bookmark.site_name || bookmark.owner}
        </span>
      ) : null}
      {bookmark.language ? (
        <span className="flex items-center gap-1 font-mono text-[11px]">
          <span className="size-2 rounded-full bg-primary" />
          {bookmark.language}
        </span>
      ) : null}
      <PricingFeaturedBadges bookmark={bookmark} />
      {(isGithub || isTwitter) && bookmark.stars !== undefined ? (
        <span className="flex items-center gap-1 font-mono text-[11px]">
          {isTwitter ? (
            <HeartIcon
              className="size-3.5 text-rose-500/90 dark:text-rose-400"
              weight="fill"
            />
          ) : (
            <StarIcon className="size-3.5 text-amber-500/90 dark:text-amber-400" />
          )}
          {bookmark.stars}
        </span>
      ) : null}
      {isGithub && bookmark.forks !== undefined ? (
        <span className="flex items-center gap-1 font-mono text-[11px]">
          <GitForkIcon className="size-3.5" />
          {bookmark.forks}
        </span>
      ) : null}
      {isGithub ? <HealthStatusBadge status={bookmark.health_status} /> : null}
      {isGithub && bookmark.track_updates ? (
        <Badge
          variant="outline"
          className="h-4.5 shrink-0 border-sky-500/30 bg-sky-500/10 px-1.5 text-[10px] font-normal text-sky-700 dark:text-sky-400"
        >
          {t("detail.trackUpdatesBadge")}
        </Badge>
      ) : null}
      {bookmark.pushed_at ? (
        <span className="ml-auto flex items-center gap-1 font-mono text-[11px]">
          <ClockIcon className="size-3" />
          {new Date(bookmark.pushed_at).toLocaleDateString(i18n.language)}
        </span>
      ) : null}
    </div>
  )
}
