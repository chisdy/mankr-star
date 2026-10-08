/**
 * 热点来源筛选
 * @description 按已发布条目的来源证据筛选，保留跨平台证据与榜单顺序。
 */
import type { DiscoveryItem, DiscoverySource } from "@mankr/shared"

export type DiscoverySourceFilter = "all" | DiscoverySource

export const DISCOVERY_SOURCE_FILTERS = [
  "all",
  "github",
  "hn",
  "rss",
] as const satisfies readonly DiscoverySourceFilter[]

export function resolveDiscoverySource(
  value: string | null
): DiscoverySourceFilter {
  return value === "github" || value === "hn" || value === "rss" ? value : "all"
}

export function filterDiscoveryItems(
  items: readonly DiscoveryItem[],
  source: DiscoverySourceFilter
): DiscoveryItem[] {
  return items.filter(
    (item) =>
      source === "all" || item.evidence.some((entry) => entry.source === source)
  )
}
