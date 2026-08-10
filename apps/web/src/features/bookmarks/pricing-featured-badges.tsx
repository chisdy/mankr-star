import { useTranslation } from "react-i18next"
import {
  CurrencyCircleDollarIcon,
  GiftIcon,
  SealCheckIcon,
} from "@phosphor-icons/react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import type { Bookmark, BookmarkPricing } from "@/lib/types"

const BADGE_CLASS =
  "size-4.5 shrink-0 justify-center gap-0 border p-0 font-normal"

const FEATURED_COLOR =
  "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400"

const PRICING_COLORS: Record<BookmarkPricing, string> = {
  free: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  freemium:
    "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  paid: "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-400",
}

function PricingIcon({ pricing }: { pricing: BookmarkPricing }) {
  if (pricing === "free") {
    return <GiftIcon className="size-3" />
  }
  return <CurrencyCircleDollarIcon className="size-3" />
}

function IconBadgeTooltip({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant="outline"
              aria-label={label}
              className={cn(BADGE_CLASS, className)}
            >
              {children}
              <span className="sr-only">{label}</span>
            </Badge>
          }
        />
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** 付费属性徽章：仅图标 + tooltip */
export function PricingBadge({
  pricing,
  className,
}: {
  pricing: Bookmark["pricing"]
  className?: string
}) {
  const { t } = useTranslation("bookmarks")
  if (!pricing) return null

  return (
    <IconBadgeTooltip
      label={t(`pricing.${pricing}`)}
      className={cn(PRICING_COLORS[pricing], className)}
    >
      <PricingIcon pricing={pricing} />
    </IconBadgeTooltip>
  )
}

/** 精选徽章：仅图标 + tooltip */
export function FeaturedBadge({
  featured,
  className,
}: {
  featured?: boolean
  className?: string
}) {
  const { t } = useTranslation("bookmarks")
  if (!featured) return null

  return (
    <IconBadgeTooltip
      label={t("card.featured")}
      className={cn(FEATURED_COLOR, className)}
    >
      <SealCheckIcon className="size-3" weight="fill" />
    </IconBadgeTooltip>
  )
}

export function PricingFeaturedBadges({
  bookmark,
  className,
}: {
  bookmark: Bookmark
  className?: string
}) {
  if (!bookmark.pricing && !bookmark.featured) return null
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <FeaturedBadge featured={bookmark.featured} />
      <PricingBadge pricing={bookmark.pricing} />
    </span>
  )
}
