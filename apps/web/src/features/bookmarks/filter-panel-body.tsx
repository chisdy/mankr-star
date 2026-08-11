import * as React from "react"
import { useReadableSearchParams } from "@/lib/search-params"
import { useTranslation } from "react-i18next"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import type { BookmarkPricingFilter } from "@mankr/shared"

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
import { cn } from "@workspace/ui/lib/utils"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { BOOKMARK_PAGE_PARAM } from "./bookmark-pagination"
import { FacetSelect } from "./owner-select"
import { parsePricingFilterParam } from "./pricing-filter"
import { useFacetInfinite } from "./use-facet-infinite"

const PANEL_FILTER_KEYS = [
  "source_type",
  "tag",
  "language",
  "owner",
  "site",
  "health_status",
  "has_account",
  "pricing",
  "featured",
  "sort",
  "archived",
] as const

/** Non-default filter control: primary border + tinted background.
 *  `bg-…!` beats SelectTrigger's built-in `dark:bg-input/30` without adding dark: variants. */
const ACTIVE_FILTER_CLASS =
  "border-primary/65 bg-primary/5! hover:bg-primary/10! text-foreground!"

const CONTROL_WIDTH = "w-[11rem]"

type SourceFilter = "" | "github" | "twitter" | "url"
type PricingFilter = "" | BookmarkPricingFilter

function SelectPrefix({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 text-muted-foreground/55">{children}</span>
}

function Field({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn("shrink-0", className)}>{children}</div>
}

export function countPanelFilters(searchParams: URLSearchParams): number {
  let n = 0
  for (const key of PANEL_FILTER_KEYS) {
    const value = searchParams.get(key)
    if (!value) continue
    if (key === "sort" && value === "recent") continue
    if (key === "pricing" && !parsePricingFilterParam(value)) continue
    if (key === "featured" && value !== "true") continue
    n += 1
  }
  return n
}

export function FilterPanelBody({ className }: { className?: string }) {
  const { t } = useTranslation("bookmarks")
  const [searchParams, setSearchParams] = useReadableSearchParams()

  const sourceType = (searchParams.get("source_type") || "") as SourceFilter
  const tag = searchParams.get("tag") || ""
  const language = searchParams.get("language") || ""
  const owner = searchParams.get("owner") || ""
  const site = searchParams.get("site") || ""
  const healthStatus = searchParams.get("health_status") || ""
  const hasAccountParam = searchParams.get("has_account")
  const hasAccount = hasAccountParam === "true"
  const pricing = (parsePricingFilterParam(searchParams.get("pricing")) ??
    "") as PricingFilter
  const featured = searchParams.get("featured") === "true"
  const sortParam = searchParams.get("sort")
  const sort: "recent" | "updated" | "stars" | "name" =
    sortParam === "stars" || sortParam === "name" || sortParam === "updated"
      ? sortParam
      : "recent"
  const archived = searchParams.get("archived") === "true"

  const showGithubFilters = sourceType === "github"
  const showWebFilters = sourceType === "url" || sourceType === ""
  /** 是否有账号：严格仅网页模式 */
  const showAccountFilter = sourceType === "url"
  const showOwner =
    sourceType === "" || sourceType === "github" || sourceType === "twitter"
  const showStarsSort = sourceType === "github" || sourceType === "twitter"
  const showUpdatedSort = sourceType === "github"
  const ownersSourceType: "github" | "twitter" =
    sourceType === "twitter" ? "twitter" : "github"

  const tagFacet = useFacetInfinite({
    keyFor: (q) => queryKeys.tags.infinite(q),
    fetchPage: (params) => api.getTagsPage(params),
  })

  const ownerFacet = useFacetInfinite({
    keyFor: (q) => queryKeys.bookmarks.ownersInfinite(ownersSourceType, q),
    fetchPage: (params) =>
      api.getOwnersPage({ ...params, sourceType: ownersSourceType }),
    enabled: showOwner,
  })

  const siteFacet = useFacetInfinite({
    keyFor: (q) => queryKeys.bookmarks.sitesInfinite(q),
    fetchPage: (params) => api.getSitesPage(params),
    enabled: showWebFilters,
  })

  const tagFacetItems = React.useMemo(
    () =>
      tagFacet.items.map((tagItem) => ({
        name: tagItem.name,
        usage_count: tagItem.count,
      })),
    [tagFacet.items]
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
    [t]
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
    if (!showStarsSort) return base
    const starsLabel =
      sourceType === "twitter" ? t("list.sortLikes") : t("list.sortStars")
    if (showUpdatedSort) {
      return [
        base[0]!,
        { value: "updated", label: t("list.sortUpdated") },
        { value: "stars", label: starsLabel },
        base[1]!,
      ]
    }
    return [base[0]!, { value: "stars", label: starsLabel }, base[1]!]
  }, [showStarsSort, showUpdatedSort, sourceType, t])

  const sourceOptions: { value: SourceFilter; label: string }[] = [
    { value: "", label: t("list.sourceAll") },
    { value: "github", label: t("list.sourceGithub") },
    { value: "twitter", label: t("list.sourceX") },
    { value: "url", label: t("list.sourceWeb") },
  ]

  const pricingOptions: { value: PricingFilter; label: string }[] = [
    { value: "", label: t("list.pricingAll") },
    { value: "unset", label: t("list.pricingUnset") },
    { value: "free", label: t("pricing.free") },
    { value: "freemium", label: t("pricing.freemium") },
    { value: "paid", label: t("pricing.paid") },
  ]

  const patchParams = React.useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams)
      mutate(next)
      // 任何筛选/排序变化都会换掉结果集，页码必须回到第一页
      next.delete(BOOKMARK_PAGE_PARAM)
      setSearchParams(next)
    },
    [searchParams, setSearchParams]
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
        next.delete("has_account")
      } else if (nextSource === "twitter") {
        next.delete("language")
        next.delete("health_status")
        next.delete("site")
        next.delete("has_account")
        const sortVal = next.get("sort")
        if (sortVal === "updated") next.delete("sort")
      } else {
        next.delete("language")
        next.delete("health_status")
        next.delete("has_account")
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
        "flex min-w-0 flex-nowrap items-center gap-3 pb-0.5",
        className
      )}
    >
      <Field className={CONTROL_WIDTH}>
        <Select
          items={sourceOptions.map((opt) => ({
            value: opt.value || null,
            label: opt.label,
          }))}
          value={sourceType || null}
          onValueChange={(val) => setSourceType((val || "") as SourceFilter)}
        >
          <SelectTrigger
            size="sm"
            className={cn(
              "h-8 w-full text-xs",
              sourceType && ACTIVE_FILTER_CLASS
            )}
          >
            <SelectPrefix>{t("list.sourceLabel")}</SelectPrefix>
            <SelectValue placeholder={t("list.sourceAll")} />
          </SelectTrigger>
          <SelectContent>
            {sourceOptions.map((opt) => (
              <SelectItem key={opt.value || "all"} value={opt.value || null}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field className={CONTROL_WIDTH}>
        <FacetSelect
          items={tagFacetItems}
          value={tag || null}
          onValueChange={(val) => updateParam("tag", val)}
          isLoading={tagFacet.isLoading}
          virtualized
          pagination={{
            hasNextPage: tagFacet.hasNextPage,
            isFetchingNextPage: tagFacet.isFetchingNextPage,
            loadMoreError: tagFacet.loadMoreError,
            onLoadMore: tagFacet.fetchNextPage,
            onSearchChange: tagFacet.setSearch,
          }}
          fullWidth
          size="sm"
          variant="tag"
          prefixLabel={t("list.tagLabel")}
          allLabel={t("list.tagAll")}
          searchPlaceholder={t("list.tagSearch")}
          loadingLabel={t("list.tagLoading")}
          noMatchLabel={t("list.tagNoMatch")}
        />
      </Field>

      {showOwner ? (
        <Field className={CONTROL_WIDTH}>
          <FacetSelect
            items={ownerFacet.items}
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
            isLoading={ownerFacet.isLoading}
            virtualized
            pagination={{
              hasNextPage: ownerFacet.hasNextPage,
              isFetchingNextPage: ownerFacet.isFetchingNextPage,
              loadMoreError: ownerFacet.loadMoreError,
              onLoadMore: ownerFacet.fetchNextPage,
              onSearchChange: ownerFacet.setSearch,
            }}
            fullWidth
            size="sm"
            variant="owner"
            prefixLabel={t("list.ownerLabel")}
            allLabel={t("list.ownerAll")}
            searchPlaceholder={t("list.ownerSearch")}
            loadingLabel={t("list.ownerLoading")}
            noMatchLabel={t("list.ownerNoMatch")}
          />
        </Field>
      ) : null}

      {showWebFilters ? (
        <Field className={CONTROL_WIDTH}>
          <FacetSelect
            items={siteFacet.items}
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
            isLoading={siteFacet.isLoading}
            virtualized
            pagination={{
              hasNextPage: siteFacet.hasNextPage,
              isFetchingNextPage: siteFacet.isFetchingNextPage,
              loadMoreError: siteFacet.loadMoreError,
              onLoadMore: siteFacet.fetchNextPage,
              onSearchChange: siteFacet.setSearch,
            }}
            fullWidth
            size="sm"
            variant="site"
            prefixLabel={t("list.siteLabel")}
            allLabel={t("list.siteAll")}
            searchPlaceholder={t("list.siteSearch")}
            loadingLabel={t("list.siteLoading")}
            noMatchLabel={t("list.siteNoMatch")}
          />
        </Field>
      ) : null}

      {showAccountFilter ? (
        <Field className="w-auto">
          <div
            className={cn(
              "flex h-8 min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 shadow-xs transition-[color,box-shadow]",
              hasAccount && ACTIVE_FILTER_CLASS
            )}
          >
            <Label
              id="filter-has-account-label"
              htmlFor="filter-has-account"
              className="cursor-pointer text-xs font-normal whitespace-nowrap text-muted-foreground"
            >
              {t("list.hasAccountHint")}
            </Label>
            <Switch
              id="filter-has-account"
              size="sm"
              className="shrink-0"
              checked={hasAccount}
              onCheckedChange={(checked) =>
                updateParam("has_account", checked ? "true" : null)
              }
              aria-labelledby="filter-has-account-label"
            />
          </div>
        </Field>
      ) : null}

      <Field className={CONTROL_WIDTH}>
        <Select
          items={pricingOptions.map((opt) => ({
            value: opt.value || null,
            label: opt.label,
          }))}
          value={pricing || null}
          onValueChange={(val) =>
            updateParam("pricing", (val as PricingFilter) || null)
          }
        >
          <SelectTrigger
            size="sm"
            className={cn(
              "h-8 w-full text-xs",
              pricing && ACTIVE_FILTER_CLASS
            )}
          >
            <SelectPrefix>{t("list.pricingLabel")}</SelectPrefix>
            <SelectValue placeholder={t("list.pricingAll")} />
          </SelectTrigger>
          <SelectContent>
            {pricingOptions.map((opt) => (
              <SelectItem key={opt.value || "all"} value={opt.value || null}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field className="w-auto">
        <div
          className={cn(
            "flex h-8 min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 shadow-xs transition-[color,box-shadow]",
            featured && ACTIVE_FILTER_CLASS
          )}
        >
          <Label
            id="filter-featured-label"
            htmlFor="filter-featured"
            className="cursor-pointer text-xs font-normal whitespace-nowrap text-muted-foreground"
          >
            {t("list.featuredHint")}
          </Label>
          <Switch
            id="filter-featured"
            size="sm"
            className="shrink-0"
            checked={featured}
            onCheckedChange={(checked) =>
              updateParam("featured", checked ? "true" : null)
            }
            aria-labelledby="filter-featured-label"
          />
        </div>
      </Field>

      {showGithubFilters ? (
        <>
          <Field className={CONTROL_WIDTH}>
            <Select
              items={languageItems}
              value={language || null}
              onValueChange={(val) => updateParam("language", val || null)}
            >
              <SelectTrigger
                size="sm"
                className={cn(
                  "h-8 w-full text-xs",
                  language && ACTIVE_FILTER_CLASS
                )}
              >
                <SelectPrefix>{t("list.languageLabel")}</SelectPrefix>
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

          <Field className={CONTROL_WIDTH}>
            <Select
              items={healthItems}
              value={healthStatus || null}
              onValueChange={(val) => updateParam("health_status", val || null)}
            >
              <SelectTrigger
                size="sm"
                className={cn(
                  "h-8 w-full text-xs",
                  healthStatus && ACTIVE_FILTER_CLASS
                )}
              >
                <SelectPrefix>{t("list.healthLabel")}</SelectPrefix>
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

      <Field className="w-auto">
        <div
          className={cn(
            "flex h-8 min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 shadow-xs transition-[color,box-shadow]",
            archived && ACTIVE_FILTER_CLASS
          )}
        >
          <Label
            id="filter-archived-label"
            htmlFor="filter-archived"
            className="cursor-pointer text-xs font-normal whitespace-nowrap text-muted-foreground"
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

      <Field className={CONTROL_WIDTH}>
        <Select
          items={sortItems}
          value={
            showStarsSort || sort === "recent" || sort === "name"
              ? sort
              : "recent"
          }
          onValueChange={(val) =>
            updateParam("sort", !val || val === "recent" ? null : val)
          }
        >
          <SelectTrigger
            size="sm"
            className={cn(
              "h-8 w-full text-xs",
              sort !== "recent" && ACTIVE_FILTER_CLASS
            )}
          >
            <SelectPrefix>{t("list.sortLabel")}</SelectPrefix>
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

      {hasPanelFilters ? (
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-xs"
          onClick={clearPanelFilters}
        >
          <ArrowCounterClockwiseIcon className="size-3.5" weight="bold" />
          {t("list.filterClear")}
        </Button>
      ) : null}
    </div>
  )
}
