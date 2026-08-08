import { useTranslation } from "react-i18next"
import { Badge } from "@workspace/ui/components/badge"
import type { HealthStatus } from "@mankr/shared"
import { cn } from "@workspace/ui/lib/utils"

const MUTED = new Set<HealthStatus>(["unavailable", "empty", "archived", "stale"])

const LABELED_STATUSES = new Set<HealthStatus>([
  "hot",
  "active",
  "stale",
  "archived",
  "empty",
  "unavailable",
])

export function HealthStatusBadge({
  status,
  className,
}: {
  status?: string | null
  className?: string
}) {
  const { t } = useTranslation("bookmarks")

  if (!status || status === "unknown" || !LABELED_STATUSES.has(status as HealthStatus)) {
    return null
  }

  const label = t(`health.${status as HealthStatus}`)
  const muted = MUTED.has(status as HealthStatus)

  return (
    <Badge
      variant={muted ? "secondary" : "outline"}
      className={cn(
        "text-[10px] h-4.5 px-1.5 font-normal shrink-0",
        status === "unavailable" && "opacity-70",
        status === "hot" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        status === "active" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
      {label}
    </Badge>
  )
}
