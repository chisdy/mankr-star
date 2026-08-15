import * as React from "react"

/**
 * 虚拟列表不是滚动容器的第一个子元素（上方还有工具栏、统计卡片等），
 * 必须把这段偏移告诉虚拟器，否则测算出的可视区会整体错位。
 */
export function useScrollMargin(
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
