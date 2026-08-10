import {
  BOOKMARK_PRICING_FILTER_VALUES,
  type BookmarkPricingFilter,
} from "@mankr/shared"

const PRICING_FILTER_SET = new Set<string>(BOOKMARK_PRICING_FILTER_VALUES)

/** URL `pricing` → 合法筛选值；非法/空 → undefined（等同「全部」） */
export function parsePricingFilterParam(
  value: string | null | undefined,
): BookmarkPricingFilter | undefined {
  if (!value) return undefined
  return PRICING_FILTER_SET.has(value)
    ? (value as BookmarkPricingFilter)
    : undefined
}
