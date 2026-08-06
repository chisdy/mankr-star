import * as React from "react"

export type ResizablePanelEdge = "left" | "right"

export type UseResizablePanelOptions = {
  edge: ResizablePanelEdge
  storageKey: string
  minWidth: number
  maxWidth: number
  defaultWidth: number
  enabled?: boolean
}

function clampWidth(width: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(width)))
}

function readStoredWidth(
  storageKey: string,
  min: number,
  max: number,
  fallback: number,
) {
  if (typeof window === "undefined") return fallback
  const raw = localStorage.getItem(storageKey)
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return clampWidth(parsed, min, max)
}

/**
 * 左右可拉伸侧栏：edge=right 向右拖加宽；edge=left 向左拖加宽。
 */
export function useResizablePanel({
  edge,
  storageKey,
  minWidth,
  maxWidth,
  defaultWidth,
  enabled = true,
}: UseResizablePanelOptions) {
  const [panelWidth, setPanelWidth] = React.useState(() =>
    enabled
      ? readStoredWidth(storageKey, minWidth, maxWidth, defaultWidth)
      : defaultWidth,
  )
  const [isResizing, setIsResizing] = React.useState(false)
  const panelRef = React.useRef<HTMLElement>(null)
  const widthRef = React.useRef(panelWidth)
  const dragStartX = React.useRef(0)
  const dragStartWidth = React.useRef(defaultWidth)
  const rafId = React.useRef(0)
  const pendingWidth = React.useRef<number | null>(null)

  React.useEffect(() => {
    widthRef.current = panelWidth
  }, [panelWidth])

  const applyWidth = React.useEffectEvent((width: number) => {
    const next = clampWidth(width, minWidth, maxWidth)
    widthRef.current = next
    const el = panelRef.current
    if (el) el.style.width = `${next}px`
  })

  const commitWidth = React.useEffectEvent((width: number) => {
    const next = clampWidth(width, minWidth, maxWidth)
    widthRef.current = next
    setPanelWidth(next)
    localStorage.setItem(storageKey, String(next))
  })

  const stopResize = React.useEffectEvent(() => {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current)
      rafId.current = 0
    }
    pendingWidth.current = null
    setIsResizing(false)
    commitWidth(widthRef.current)
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
  })

  React.useEffect(() => {
    if (!isResizing) return

    const onPointerMove = (event: PointerEvent) => {
      const rawDelta = event.clientX - dragStartX.current
      const delta = edge === "left" ? -rawDelta : rawDelta
      pendingWidth.current = dragStartWidth.current + delta
      if (rafId.current) return
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0
        if (pendingWidth.current == null) return
        applyWidth(pendingWidth.current)
      })
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true })
    window.addEventListener("pointerup", stopResize)
    window.addEventListener("pointercancel", stopResize)

    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", stopResize)
      window.removeEventListener("pointercancel", stopResize)
      if (rafId.current) {
        cancelAnimationFrame(rafId.current)
        rafId.current = 0
      }
    }
  }, [edge, isResizing])

  const handleResizePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!enabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragStartX.current = event.clientX
    dragStartWidth.current =
      panelRef.current?.getBoundingClientRect().width ?? widthRef.current
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    setIsResizing(true)
  }

  const handleResizeKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (!enabled) return
    const shrinkKey = edge === "left" ? "ArrowRight" : "ArrowLeft"
    const growKey = edge === "left" ? "ArrowLeft" : "ArrowRight"
    if (event.key === shrinkKey) {
      event.preventDefault()
      commitWidth(widthRef.current - 8)
    } else if (event.key === growKey) {
      event.preventDefault()
      commitWidth(widthRef.current + 8)
    } else if (event.key === "Home") {
      event.preventDefault()
      commitWidth(minWidth)
    } else if (event.key === "End") {
      event.preventDefault()
      commitWidth(maxWidth)
    }
  }

  return {
    panelRef,
    panelWidth,
    isResizing,
    minWidth,
    maxWidth,
    handleResizePointerDown,
    handleResizeKeyDown,
  }
}
