/**
 * 时间线按日期分组后的行模型。虚拟滚动只能挂平铺的行，
 * 所以把「日期标题 + 当天事件」拍平成一维序列，分组视觉靠行内间距还原。
 */

import type { UpdateEvent } from "@/lib/types"

export type FeedRow =
  | { kind: "header"; key: string; date: string }
  | {
      kind: "event"
      key: string
      event: UpdateEvent
      /** 当天最后一条：由它承担与下一组之间的间距 */
      lastOfDay: boolean
    }

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
}

/** 分组标题按用户语言格式化，切换语言后整列一起换 */
export function formatFeedDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, DATE_FORMAT)
}

/**
 * 事件已按 detected_at 倒序到达，这里保持到达顺序：
 * 同一天的连续事件归到同一个标题下，标题按首次出现的顺序排列。
 */
export function flattenFeedRows(
  events: UpdateEvent[],
  locale: string,
): FeedRow[] {
  const groups = new Map<string, UpdateEvent[]>()
  for (const event of events) {
    const date = formatFeedDate(event.detected_at, locale)
    const bucket = groups.get(date)
    if (bucket) bucket.push(event)
    else groups.set(date, [event])
  }

  const rows: FeedRow[] = []
  for (const [date, items] of groups) {
    rows.push({ kind: "header", key: `header:${date}`, date })
    items.forEach((event, index) => {
      rows.push({
        kind: "event",
        key: event.id,
        event,
        lastOfDay: index === items.length - 1,
      })
    })
  }
  return rows
}
