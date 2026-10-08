import {
  ArrowSquareOutIcon,
  BookmarkSimpleIcon,
  CheckIcon,
  GithubLogoIcon,
  ChatCircleIcon,
  RssIcon,
  StarIcon,
} from "@phosphor-icons/react"
import { useTranslation } from "react-i18next"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { ExternalLink } from "@/components/external-link"
import type { DiscoveryEvidence, DiscoveryItem } from "@/lib/types"
import { formatDiscoveryTime } from "./format-discovery-time"

function EvidenceMetrics({ evidence }: { evidence: DiscoveryEvidence }) {
  const { t, i18n } = useTranslation("discovery")
  const numbers = new Intl.NumberFormat(i18n.language)
  if (evidence.source === "github") {
    const growth = evidence.growth
    const sampleTimes = `${t("previousSample")}: ${formatDiscoveryTime(evidence.previousObservedAt, i18n.language)} · ${t("currentSample")}: ${formatDiscoveryTime(evidence.observedAt, i18n.language)} (UTC+8)`
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {evidence.stars !== undefined ? (
          <span className="inline-flex items-center gap-1">
            <StarIcon className="size-3.5" />
            {t("stars", {
              count: evidence.stars,
              value: numbers.format(evidence.stars),
            })}
          </span>
        ) : null}
        <span
          title={sampleTimes}
          className={
            typeof growth === "number" && growth > 0
              ? "text-primary"
              : undefined
          }
        >
          {typeof growth === "number"
            ? t("growth", {
                value: `${growth > 0 ? "+" : ""}${numbers.format(growth)}`,
              })
            : t("newDiscovery")}
        </span>
      </div>
    )
  }
  if (evidence.source === "hn") {
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {evidence.score !== undefined ? (
          <span>{t("hnScore", { value: numbers.format(evidence.score) })}</span>
        ) : null}
        {evidence.comments !== undefined ? (
          <ExternalLink
            href={evidence.url}
            className="hover:text-foreground hover:underline"
          >
            {t("comments", { value: numbers.format(evidence.comments) })}
          </ExternalLink>
        ) : null}
      </div>
    )
  }
  return (
    <span className="text-xs text-muted-foreground">{t("latestUpdate")}</span>
  )
}

export function DiscoveryCard({
  item,
  onSave,
  saving,
}: {
  item: DiscoveryItem
  onSave: () => void
  saving: boolean
}) {
  const { t, i18n } = useTranslation("discovery")
  const saved = Boolean(item.savedBookmarkId)
  return (
    <article className="min-w-0 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-border sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
          {String(item.rank).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1.5">
            <h2 className="text-base leading-snug font-semibold tracking-tight break-words">
              <ExternalLink href={item.url} className="hover:text-primary">
                {item.title}
              </ExternalLink>
            </h2>
            {item.summary ? (
              <p className="line-clamp-3 text-sm leading-relaxed break-words text-muted-foreground">
                {item.summary}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            {item.evidence.map((evidence) => {
              const Icon =
                evidence.source === "github"
                  ? GithubLogoIcon
                  : evidence.source === "hn"
                    ? ChatCircleIcon
                    : RssIcon
              return (
                <div
                  key={`${evidence.source}:${evidence.sourceId}:${evidence.url}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
                >
                  <Badge
                    variant="secondary"
                    className="gap-1 text-[11px] font-normal"
                  >
                    <Icon className="size-3" />
                    {t(`source.${evidence.source}`)}
                  </Badge>
                  <EvidenceMetrics evidence={evidence} />
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="min-w-0 text-xs text-muted-foreground">
              {item.publishedAt ? (
                <time dateTime={item.publishedAt}>
                  {formatDiscoveryTime(item.publishedAt, i18n.language)}{" "}
                  <span className="text-[10px]">UTC+8</span>
                </time>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <ExternalLink
                href={item.url}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("original")}
                <ArrowSquareOutIcon className="size-3.5" />
              </ExternalLink>
              <Button
                variant={saved ? "secondary" : "outline"}
                size="sm"
                disabled={saved || saving}
                onClick={onSave}
                aria-label={t(saved ? "savedAria" : "saveAria", {
                  title: item.title,
                })}
                className="h-8 gap-1.5 text-xs"
              >
                {saved ? (
                  <CheckIcon className="size-3.5" />
                ) : (
                  <BookmarkSimpleIcon className="size-3.5" />
                )}
                {t(saved ? "saved" : saving ? "saving" : "save")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
