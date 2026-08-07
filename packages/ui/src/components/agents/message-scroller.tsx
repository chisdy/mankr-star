import { useReducedMotion } from "motion/react"
import {
  type ComponentPropsWithRef,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react"

import { assignRef } from "@workspace/ui/lib/refs"
import { cn } from "@workspace/ui/lib/utils"

export interface MessageScrollerProps extends ComponentPropsWithRef<"div"> {
  /** 读者仍停在末尾附近时，把流式输出钉在底部 */
  followOutput?: boolean
  /** 距末尾多少像素内仍算作「跟随中」 */
  followThreshold?: number
  /** 平滑跟随增长的内容 */
  smooth?: boolean
  /** 读者离开或回到最新位置时回调 */
  onFollowChange?: (following: boolean) => void
  /** 可滚动记录区的无障碍名称 */
  label?: string
  /** 标记记录区正在等待后续流式内容 */
  busy?: boolean
  viewportClassName?: string
  contentClassName?: string
  viewportRef?: Ref<HTMLElement>
  viewportProps?: Omit<
    ComponentPropsWithRef<"section">,
    "children" | "className" | "ref"
  >
  contentProps?: Omit<
    ComponentPropsWithRef<"div">,
    "children" | "className" | "ref"
  >
}

export function MessageScroller({
  followOutput = true,
  followThreshold = 56,
  smooth = true,
  onFollowChange,
  label = "Conversation",
  busy,
  viewportClassName,
  contentClassName,
  viewportRef: externalViewportRef,
  viewportProps,
  contentProps,
  className,
  children,
  ...props
}: MessageScrollerProps) {
  const reduce = useReducedMotion() ?? false
  const viewportRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(followOutput)
  const programmaticScrollRef = useRef(false)
  const scrollTimerRef = useRef<number | undefined>(undefined)
  const frameRef = useRef<number | undefined>(undefined)
  const {
    onScroll: onViewportScroll,
    onWheel: onViewportWheel,
    onTouchStart: onViewportTouchStart,
    onKeyDown: onViewportKeyDown,
    ...restViewportProps
  } = viewportProps ?? {}

  const setViewportRef = useCallback(
    (node: HTMLElement | null) => {
      viewportRef.current = node
      assignRef(externalViewportRef, node)
    },
    [externalViewportRef]
  )

  const setFollowing = useCallback(
    (next: boolean) => {
      if (followingRef.current === next) return
      followingRef.current = next
      onFollowChange?.(next)
    },
    [onFollowChange]
  )

  const scrollToEnd = useCallback((behavior: ScrollBehavior) => {
    const viewport = viewportRef.current
    if (!viewport) return

    programmaticScrollRef.current = true
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    } else {
      viewport.scrollTop = viewport.scrollHeight
    }
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = window.setTimeout(
      () => {
        programmaticScrollRef.current = false
      },
      behavior === "smooth" ? 320 : 0
    )
  }, [])

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || programmaticScrollRef.current) return

    const distance =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    setFollowing(distance <= followThreshold)
  }, [followThreshold, setFollowing])

  const leaveLiveEdge = useCallback(() => {
    programmaticScrollRef.current = false
  }, [])

  useLayoutEffect(() => {
    followingRef.current = followOutput
    if (!followOutput) return

    frameRef.current = requestAnimationFrame(() => scrollToEnd("auto"))
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [followOutput, scrollToEnd])

  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(() => {
      if (!followOutput || !followingRef.current) return
      scrollToEnd(reduce || !smooth ? "auto" : "smooth")
    })
    observer.observe(content)

    return () => observer.disconnect()
  }, [followOutput, reduce, scrollToEnd, smooth])

  useEffect(
    () => () => {
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current)
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    },
    []
  )

  return (
    <div
      data-slot="message-scroller"
      className={cn("min-h-0", className)}
      {...props}
    >
      <section
        ref={setViewportRef}
        aria-label={label}
        {...restViewportProps}
        onScroll={(event) => {
          handleScroll()
          onViewportScroll?.(event)
        }}
        onWheel={(event) => {
          leaveLiveEdge()
          onViewportWheel?.(event)
        }}
        onTouchStart={(event) => {
          leaveLiveEdge()
          onViewportTouchStart?.(event)
        }}
        onKeyDown={(event) => {
          if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
            leaveLiveEdge()
          }
          onViewportKeyDown?.(event)
        }}
        className={cn(
          "h-full overflow-y-auto overscroll-contain outline-none [overflow-anchor:none] [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          viewportClassName
        )}
      >
        <div
          ref={contentRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={busy}
          className={contentClassName}
          {...contentProps}
        >
          {children}
        </div>
      </section>
    </div>
  )
}
