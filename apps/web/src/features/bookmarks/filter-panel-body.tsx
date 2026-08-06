import * as React from "react"
import { useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ArrowCounterClockwiseIcon, FunnelIcon } from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { FacetSelect } from "./owner-select"

const PANEL_FILTER_KEYS = [
  "source_type",
  "tag",
  "language",
  "owner",
  "site",
  "health_status",
  "sort",
  "archived",
] as const

type SourceFilter = "" | "github" | "url"

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-[11px] font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function countPanelFilters(searchParams: URLSearchParams): number {
  let n = 0
  for (const key of PANEL_FILTER_KEYS) {
    const value = searchParams.get(key)
    if (!value) continue
    if (key === "sort" && value === "recent") continue
    n += 1
  }
  return n
}

export function FilterPanelBody({
  className,
}: {
  className?: string
}) {
  const { t } = useTranslation("bookmarks")
  const [searchParams, setSearchParams] = useSearchParams()

  const sourceType = (searchParams.get("source_type") || "") as SourceFilter
  const tag = searchParams.get("tag") || ""
  const language = searchParams.get("language") || ""
  const owner = searchParams.get("owner") || ""
  const site = searchParams.get("site") || ""
  const healthStatus = searchParams.get("health_status") || ""
  const sortParam = searchParams.get("sort")
  const sort: "recent" | "updated" | "stars" | "name" =
    sortParam === "stars" || sortParam === "name" || sortParam === "updated"
      ? sortParam
      : "recent"
  const archived = searchParams.get("archived") === "true"

  const showGithubFilters = sourceType === "github"
  const showWebFilters = sourceType === "url" || sourceType === ""
  const showOwner = sourceType === "" || sourceType === "github"
  const showGithubSort = sourceType === "github"

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: queryKeys.tags.all,
    queryFn: () => api.getTags(),
  })

  const { data: owners = [], isLoading: ownersLoading } = useQuery({
    queryKey: queryKeys.bookmarks.owners,
    queryFn: () => api.getOwners(),
    enabled: showOwner,
  })

  const { data: sites = [], isLoading: sitesLoading } = useQuery({
    queryKey: queryKeys.bookmarks.sites,
    queryFn: () => api.getSites(),
    enabled: showWebFilters,
  })

  const tagFacetItems = React.useMemo(
    () =>
      tags.map((tagItem) => ({
        name: tagItem.name,
        usage_count: tagItem.count,
      })),
    [tags],
  )

  const popularLanguages = [
    "TypeScript",
    "JavaScript",
    "Python",
    "Rust",
    "Go",
    "C++",
  ]

  const languageItems = React.useMemo(
    () => [
      { value: null, label: t("list.languageAll") },
      ...popularLanguages.map((lang) => ({ value: lang, label: lang })),
    ],
    [t],
  )

  const healthItems = React.useMemo(
    () => [
      { value: null, label: t("health.all") },
      { value: "hot", label: t("health.hot") },
      { value: "active", label: t("health.active") },
      { value: "stale", label: t("health.stale") },
      { value: "archived", label: t("health.archived") },
      { value: "empty", label: t("health.empty") },
      { value: "unavailable", label: t("health.unavailable") },
    ],
    [t]
  )

  const sortItems = React.useMemo(() => {
    const base = [
      { value: "recent", label: t("list.sortRecent") },
      { value: "name", label: t("list.sortName") },
    ]
    if (!showGithubSort) return base
    return [
      base[0]!,
      { value: "updated", label: t("list.sortUpdated") },
      { value: "stars", label: t("list.sortStars") },
      base[1]!,
    ]
  }, [showGithubSort, t])

  const sourceOptions: { value: SourceFilter; label: string }[] = [
    { value: "", label: t("list.sourceAll") },
    { value: "github", label: t("list.sourceGithub") },
    { value: "url", label: t("list.sourceWeb") },
  ]

  const patchParams = React.useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams)
      mutate(next)
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const updateParam = (key: string, value: string | null | undefined) => {
    patchParams((next) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
  }

  const setSourceType = (nextSource: SourceFilter) => {
    patchParams((next) => {
      if (nextSource) next.set("source_type", nextSource)
      else next.delete("source_type")

      if (nextSource === "url") {
        next.delete("language")
        next.delete("owner")
        next.delete("health_status")
        const sortVal = next.get("sort")
        if (sortVal === "stars" || sortVal === "updated") next.delete("sort")
      } else if (nextSource === "github") {
        next.delete("site")
      } else {
        next.delete("language")
        next.delete("health_status")
        const sortVal = next.get("sort")
        if (sortVal === "stars" || sortVal === "updated") next.delete("sort")
      }
    })
  }

  const clearPanelFilters = () => {
    patchParams((next) => {
      for (const key of PANEL_FILTER_KEYS) next.delete(key)
    })
  }

  const hasPanelFilters = countPanelFilters(searchParams) > 0

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <span className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-muted-foreground">
          <FunnelIcon className="size-4 shrink-0" weight="duotone" />
          {t("list.filterTitle")}
        </span>
        {hasPanelFilters ? (
          <TooltipProvider delay={200}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={clearPanelFilters}
                    aria-label={t("list.filterClear")}
                  >
                    <ArrowCounterClockwiseIcon
                      className="size-4"
                      weight="bold"
                    />
                  </Button>
                }
              />
              <TooltipContent side="bottom">
                {t("list.filterClear")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
        <div className="w-full min-w-0 space-y-4 pt-1">
          <Field label={t("list.sourceLabel")}>
            <div className="grid min-w-0 grid-cols-3 gap-1 rounded-md bg-muted/50 p-0.5">
              {sourceOptions.map((opt) => (
                <button
                  key={opt.value || "all"}
                  type="button"
                  className={cn(
                    "min-w-0 truncate rounded-sm px-1 py-1.5 text-center text-[11px] transition-colors",
                    sourceType === opt.value
                      ? "bg-background font-medium text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setSourceType(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t("list.tagLabel")}>
            <FacetSelect
              items={tagFacetItems}
              value={tag || null}
              onValueChange={(val) => updateParam("tag", val)}
              isLoading={tagsLoading}
              fullWidth
              size="sm"
              variant="tag"
              allLabel={t("list.tagAll")}
              searchPlaceholder={t("list.tagSearch")}
              loadingLabel={t("list.tagLoading")}
              noMatchLabel={t("list.tagNoMatch")}
            />
          </Field>

          {showOwner ? (
            <Field label={t("list.ownerLabel")}>
              <FacetSelect
                items={owners}
                value={owner || null}
                onValueChange={(val) => {
                  patchParams((next) => {
                    if (val) {
                      next.set("owner", val)
                      next.delete("site")
                    } else {
                      next.delete("owner")
                    }
                  })
                }}
                isLoading={ownersLoading}
                fullWidth
                size="sm"
                variant="owner"
                allLabel={t("list.ownerAll")}
                searchPlaceholder={t("list.ownerSearch")}
                loadingLabel={t("list.ownerLoading")}
                noMatchLabel={t("list.ownerNoMatch")}
              />
            </Field>
          ) : null}

          {showWebFilters ? (
            <Field label={t("list.siteLabel")}>
              <FacetSelect
                items={sites}
                value={site || null}
                onValueChange={(val) => {
                  patchParams((next) => {
                    if (val) {
                      next.set("site", val)
                      next.delete("owner")
                    } else {
                      next.delete("site")
                    }
                  })
                }}
                isLoading={sitesLoading}
                fullWidth
                size="sm"
                variant="site"
                allLabel={t("list.siteAll")}
                searchPlaceholder={t("list.siteSearch")}
                loadingLabel={t("list.siteLoading")}
                noMatchLabel={t("list.siteNoMatch")}
              />
            </Field>
          ) : null}

          {showGithubFilters ? (
            <>
              <Field label={t("list.languageLabel")}>
                <Select
                  items={languageItems}
                  value={language || null}
                  onValueChange={(val) => updateParam("language", val || null)}
                >
                  <SelectTrigger size="sm" className="h-8 w-full text-xs">
                    <SelectValue placeholder={t("list.languageAll")} />
                  </SelectTrigger>
                  <SelectContent>
                    {languageItems.map((item) => (
                      <SelectItem key={String(item.value)} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label={t("list.healthLabel")}>
                <Select
                  items={healthItems}
                  value={healthStatus || null}
                  onValueChange={(val) =>
                    updateParam("health_status", val || null)
                  }
                >
                  <SelectTrigger size="sm" className="h-8 w-full text-xs">
                    <SelectValue placeholder={t("list.healthPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {healthItems.map((item) => (
                      <SelectItem key={String(item.value)} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : null}

          <Field label={t("list.sortLabel")}>
            <Select
              items={sortItems}
              value={
                showGithubSort || sort === "recent" || sort === "name"
                  ? sort
                  : "recent"
              }
              onValueChange={(val) =>
                updateParam("sort", !val || val === "recent" ? null : val)
              }
            >
              <SelectTrigger size="sm" className="h-8 w-full text-xs">
                <SelectValue placeholder={t("list.sortRecent")} />
              </SelectTrigger>
              <SelectContent>
                {sortItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("list.archivedLabel")}>
            <div className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-xs shadow-xs transition-[color,box-shadow] dark:bg-input/30 dark:hover:bg-input/50">
              <Label
                id="filter-archived-label"
                htmlFor="filter-archived"
                className="min-w-0 flex-1 cursor-pointer truncate text-xs font-normal text-muted-foreground"
              >
                {t("list.includeArchived")}
              </Label>
              <Switch
                id="filter-archived"
                size="sm"
                className="shrink-0"
                checked={archived}
                onCheckedChange={(checked) =>
                  updateParam("archived", checked ? "true" : null)
                }
                aria-labelledby="filter-archived-label"
              />
            </div>
          </Field>
        </div>
      </div>
    </div>
  )
}
