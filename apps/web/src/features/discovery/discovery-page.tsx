import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  FireIcon,
  ArrowClockwiseIcon,
  CircleNotchIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { DISCOVERY_CHANNEL_IDS } from "@mankr/shared"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { useReadableSearchParams } from "@/lib/search-params"
import { useRequireAuthAction } from "@/hooks/use-auth"
import { DiscoveryCard } from "./discovery-card"
import { formatDiscoveryTime } from "./format-discovery-time"
import {
  DISCOVERY_SOURCE_FILTERS,
  filterDiscoveryItems,
  resolveDiscoverySource,
  type DiscoverySourceFilter,
} from "./discovery-source-filter"
import {
  resolveDiscoveryChannel,
  useDiscovery,
  useSaveDiscovery,
} from "./use-discovery"

export function DiscoveryPage() {
  const { t, i18n } = useTranslation("discovery")
  const [searchParams, setSearchParams] = useReadableSearchParams()
  const channel = resolveDiscoveryChannel(searchParams.get("channel"))
  const sourceFilter = resolveDiscoverySource(searchParams.get("source"))
  const query = useDiscovery(channel)
  const save = useSaveDiscovery()
  const requireAuth = useRequireAuthAction()
  const data = query.data
  const busy = query.isFetching
  const state = data?.state
  const hasItems = Boolean(data?.items.length)
  const visibleItems = filterDiscoveryItems(data?.items ?? [], sourceFilter)
  const tabsList = React.useRef<HTMLDivElement>(null)

  const selectSource = (source: DiscoverySourceFilter) => {
    const next = new URLSearchParams(searchParams)
    if (source === "all") next.delete("source")
    else next.set("source", source)
    setSearchParams(next)
  }

  React.useEffect(() => {
    tabsList.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [channel])

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-12">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
              <FireIcon className="size-4.5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5 text-xs"
          disabled={busy || !query.canRead}
          onClick={() => void query.refetch()}
          aria-label={t("refreshAria")}
        >
          {busy ? (
            <CircleNotchIcon className="size-4 motion-safe:animate-spin" />
          ) : (
            <ArrowClockwiseIcon className="size-4" />
          )}
          <span className="hidden sm:inline">{t("refresh")}</span>
        </Button>
      </div>

      <Tabs
        value={channel}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          next.set("channel", resolveDiscoveryChannel(String(value)))
          setSearchParams(next)
        }}
        className="min-w-0 gap-5"
      >
        <div className="min-w-0 overflow-x-auto pb-1">
          <TabsList
            ref={tabsList}
            aria-label={t("channelAria")}
            className="w-max min-w-full sm:min-w-0"
          >
            {DISCOVERY_CHANNEL_IDS.map((id) => (
              <TabsTrigger
                key={id}
                value={id}
                className="px-3 text-xs sm:text-sm"
                onFocus={(event) =>
                  event.currentTarget.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                  })
                }
              >
                {t(`channels.${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {DISCOVERY_CHANNEL_IDS.map((id) => (
          <TabsContent key={id} value={id} className="min-w-0 space-y-4">
            {id === channel ? (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("sourceFilter.label")}
                  </p>
                  <div
                    role="group"
                    aria-label={t("sourceFilter.label")}
                    className="flex flex-wrap gap-2"
                  >
                    {DISCOVERY_SOURCE_FILTERS.map((source) => (
                      <Button
                        key={source}
                        variant={
                          sourceFilter === source ? "secondary" : "outline"
                        }
                        size="sm"
                        className="text-xs"
                        aria-pressed={sourceFilter === source}
                        onClick={() => selectSource(source)}
                      >
                        {source === "all"
                          ? t("sourceFilter.all")
                          : t(`source.${source}`)}
                      </Button>
                    ))}
                  </div>
                  {data?.edition ? (
                    <p role="status" className="text-xs text-muted-foreground">
                      {t("sourceFilter.count", {
                        count: visibleItems.length,
                        total: data.items.length,
                      })}
                    </p>
                  ) : null}
                </div>
                {data?.edition ? (
                  <p className="text-xs text-muted-foreground">
                    {t("updatedAt", {
                      value: formatDiscoveryTime(
                        data.edition.publishedAt,
                        i18n.language
                      ),
                    })}{" "}
                    <span className="text-[10px]">UTC+8</span>
                  </p>
                ) : null}

                {query.isLoading || !query.canRead ? (
                  <div className="space-y-3" aria-label={t("loading")}>
                    {[1, 2, 3].map((key) => (
                      <div
                        key={key}
                        className="space-y-3 rounded-xl border border-border/60 p-5"
                      >
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    ))}
                  </div>
                ) : null}

                {query.isError ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm"
                  >
                    <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <p>{t("loadFailed")}</p>
                  </div>
                ) : null}

                {state && state !== "ready" && query.canRead ? (
                  <div
                    role="status"
                    className="rounded-lg border border-border/60 bg-muted/30 p-4"
                  >
                    <p className="text-sm font-medium">
                      {t(`state.${state}.title`)}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t(
                        `state.${state}.${state === "failed" && hasItems ? "withItems" : "description"}`
                      )}
                    </p>
                  </div>
                ) : null}

                {data?.sources.length ? (
                  <div
                    className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground"
                    aria-label={t("sourceStatusAria")}
                  >
                    {data.sources.map((source) => (
                      <span
                        key={`${source.source}:${source.sourceId}`}
                        className={
                          source.state === "stale" || source.state === "failed"
                            ? "text-amber-700 dark:text-amber-400"
                            : undefined
                        }
                      >
                        {t(`source.${source.source}`)}
                        {source.source === "rss"
                          ? ` · ${t(`feeds.${source.sourceId}`, { defaultValue: source.sourceId })}`
                          : ""}{" "}
                        · {t(`sourceState.${source.state}`)}
                        {source.lastSuccessAt
                          ? ` · ${t("lastSuccess", { value: formatDiscoveryTime(source.lastSuccessAt, i18n.language) })}`
                          : ""}
                      </span>
                    ))}
                  </div>
                ) : null}

                {visibleItems.length ? (
                  <div className="space-y-3">
                    {visibleItems.map((item) => (
                      <DiscoveryCard
                        key={item.id}
                        item={item}
                        saving={
                          save.isPending && save.variables?.item.id === item.id
                        }
                        onSave={() => requireAuth(() => save.save(item))}
                      />
                    ))}
                  </div>
                ) : null}
                {hasItems && !visibleItems.length ? (
                  <div className="space-y-3 rounded-xl border border-dashed border-border/60 px-4 py-10 text-center">
                    <p className="text-sm font-medium">
                      {t("sourceFilter.emptyTitle", {
                        source: t(`source.${sourceFilter}`),
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("sourceFilter.emptyDescription")}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectSource("all")}
                    >
                      {t("sourceFilter.showAll")}
                    </Button>
                  </div>
                ) : null}
                {data?.state === "ready" && !hasItems ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {t("state.empty.description")}
                  </p>
                ) : null}
                {data?.items.length ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {t("rankingNote")}
                  </p>
                ) : null}
              </>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
