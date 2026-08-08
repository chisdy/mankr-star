import { useTranslation } from "react-i18next"
import { IdentificationCardIcon } from "@phosphor-icons/react"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import type { Bookmark } from "@/lib/types"

/** 仅网页来源、且已注册账号或已设置密码时露出的细节徽标 */
export function AccountStatusBadge({
  bookmark,
  className,
}: {
  bookmark: Bookmark
  className?: string
}) {
  const { t } = useTranslation("bookmarks")

  if (bookmark.source_type !== "url") return null
  if (!bookmark.account_registered && !bookmark.account_password_set) return null

  const label = bookmark.account_password_set
    ? t("card.accountBadgeTitleWithPassword")
    : t("card.accountBadgeTitle")

  return (
    <Badge
      variant="outline"
      title={label}
      className={cn(
        "h-4.5 shrink-0 gap-1 px-1.5 text-[10px] font-normal text-muted-foreground border-border/80",
        className,
      )}
    >
      <IdentificationCardIcon className="size-3" />
      <span className="sr-only">{label}</span>
    </Badge>
  )
}
