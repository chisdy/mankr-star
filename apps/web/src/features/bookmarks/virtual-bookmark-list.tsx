import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

import type { Bookmark } from "@/lib/types"

type VirtualBookmarkListProps = {
  items: Bookmark[]
  /** 瀑布流列数；列表视图传 1 */
  columns: number
  /** 列间距与行间距（px） */
  gap: number
  /** 首次渲染前的高度估算，测量完成后由实际高度替换 */
  estimateSize: number
  scrollElement: HTMLElement | null
  renderItem: (bookmark: Bookmark) => React.ReactNode
}

/**
 * 动态测量的虚拟瀑布流：卡片高度不固定，由 measureElement 实测，
 * 只挂载视口附近 + overscan 的节点。
 */
export function VirtualBookmarkList({
  items,
  columns,
  gap,
  estimateSize,
  scrollElement,
  renderItem,
}: VirtualBookmarkListProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const scrollMargin = useScrollMargin(containerRef, scrollElement)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateSize,
    overscan: 8,
    lanes: columns,
    gap,
    scrollMargin,
    // 按实测高度往最短的一列放，卡片高度差异大时不会某一列特别长
    laneAssignmentMode: "measured",
    getItemKey: (index) => items[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      ref={containerRef}
      className="relative w-full min-w-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualItems.map((virtualItem) => {
        const bookmark = items[virtualItem.index]
        if (!bookmark) return null
        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 min-w-0"
            style={{
              // 列宽 w = (100% - (n-1)*gap)/n，第 i 列起点 i*(w+gap) = i*(100%+gap)/n
              left: `calc(${virtualItem.lane} * (100% + ${gap}px) / ${columns})`,
              width: `calc((100% - ${(columns - 1) * gap}px) / ${columns})`,
              transform: `translateY(${virtualItem.start - scrollMargin}px)`,
            }}
          >
            {renderItem(bookmark)}
          </div>
        )
      })}
    </div>
  )
}

/**
 * 虚拟列表不是滚动容器的第一个子元素（上方还有工具栏），
 * 必须把这段偏移告诉虚拟器，否则测算出的可视区会整体错位。
 */
function useScrollMargin(
  containerRef: React.RefObject<HTMLElement | null>,
  scrollElement: HTMLElement | null,
): number {
  const [scrollMargin, setScrollMargin] = React.useState(0)

  React.useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !scrollElement) return

    const measure = () => {
      const offset =
        container.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop
      setScrollMargin((prev) => (Math.abs(prev - offset) < 1 ? prev : offset))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scrollElement)
    if (container.parentElement) observer.observe(container.parentElement)
    return () => observer.disconnect()
  }, [containerRef, scrollElement])

  return scrollMargin
}
