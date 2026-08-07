import type { KbChatSource } from "@mankr/shared"

import { bookmarkDetailHref } from "../bookmarks/bookmark-detail-params"

/**
 * 命中的收藏可以直接在站内打开详情；网页来源只有外链，没有站内位置。
 */
export function bookmarkInternalHref(source: KbChatSource): string | null {
  if (source.type !== "bookmark") return null
  const id = source.id?.trim()
  if (!id) return null
  return bookmarkDetailHref(id)
}
