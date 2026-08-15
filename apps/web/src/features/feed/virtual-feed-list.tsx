import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { cn } from "@workspace/ui/lib/utils"
import { useScrollMargin } from "@/hooks/use-scroll-margin"
import type { UpdateEvent } from "@/lib/types"
import type { FeedRow } from "./feed-timeline"

/** 首次渲染前的高度估算，测量完成后由实际高度替换 */
const HEADER_ESTIMATE = 28
const EVENT_ESTIMATE = 96

/**
 * 单列虚拟时间线：只挂视口附近 + overscan 的行。
 * 行没有外层分组容器，日期间距与左侧竖线都由行内样式承担：
 * 竖线包住卡片和组内间距（连续），组间间距放到竖线之外（线到当天最后一条为止）。
 */
export function VirtualFeedList({
  rows,
  scrollElement,
  renderEvent,
}: {
  rows: FeedRow[]
  scrollElement: HTMLElement | null
  renderEvent: (event: UpdateEvent) => React.ReactNode
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const scrollMargin = useScrollMargin(containerRef, scrollElement)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) =>
      rows[index]?.kind === "header" ? HEADER_ESTIMATE : EVENT_ESTIMATE,
    overscan: 8,
    scrollMargin,
    getItemKey: (index) => rows[index]?.key ?? index,
  })

  const lastIndex = rows.length - 1

  return (
    <div
      ref={containerRef}
      className="relative w-full min-w-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const row = rows[virtualItem.index]
        if (!row) return null

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full min-w-0"
            style={{
              transform: `translateY(${virtualItem.start - scrollMargin}px)`,
            }}
          >
            {row.kind === "header" ? (
              <h3 className="pb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {row.date}
              </h3>
            ) : (
              // 整列最后一条不再留组间间距，避免底部多出一段空白
              <div
                className={cn(
                  row.lastOfDay && virtualItem.index !== lastIndex && "pb-8",
                )}
              >
                <div
                  className={cn(
                    "ml-1 border-l-2 border-border/60 pl-3 md:pl-4",
                    !row.lastOfDay && "pb-2",
                  )}
                >
                  {renderEvent(row.event)}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
