import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { ChevronDown } from "lucide-react"
import { type HTMLMotionProps, motion, useReducedMotion } from "motion/react"
import {
  type ComponentPropsWithRef,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useState,
} from "react"

import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from "@workspace/ui/lib/ease"
import { cn } from "@workspace/ui/lib/utils"
import { MessageSideContext } from "./message-context"

export type MessageBubbleVariant =
  | "solid"
  | "soft"
  | "tint"
  | "outline"
  | "ghost"
  | "danger"
export type MessageBubbleAlign = "start" | "end"

interface MessageBubbleContextValue {
  align?: MessageBubbleAlign
  animateIn: boolean
  variant: MessageBubbleVariant
}

const MessageBubbleContext = createContext<MessageBubbleContextValue>({
  animateIn: true,
  variant: "soft",
})
const MessageBubbleLayoutContext = createContext<() => void>(() => {})

export interface MessageBubbleProps
  extends Omit<HTMLMotionProps<"div">, "children"> {
  variant?: MessageBubbleVariant
  /** 省略时跟随外层 Message 的对齐方向 */
  align?: MessageBubbleAlign
  /** 挂载时播放一次入场动效 */
  animateIn?: boolean
  children?: ReactNode
}

/** render 用于替换内容元素本身，同时保留气泡样式 */
export type MessageBubbleContentProps = useRender.ComponentProps<"div"> &
  ComponentPropsWithRef<"div">


export interface MessageBubbleGroupProps extends ComponentPropsWithRef<"div"> {
  spacing?: "compact" | "default"
}

export interface MessageBubbleCollapsibleProps
  extends ComponentPropsWithRef<"div"> {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  collapsedLines?: 2 | 3 | 4 | 5 | 6
  moreLabel?: ReactNode
  lessLabel?: ReactNode
  contentClassName?: string
  triggerClassName?: string
  children?: ReactNode
}

const BUBBLE_CONTENT_REVEAL = {
  duration: 0.12,
  ease: EASE_OUT,
  delay: 0.04,
} as const

/** 已发出的气泡快速就位，只允许一次克制的过冲 */
const BUBBLE_POP = {
  type: "spring",
  stiffness: 520,
  damping: 27,
  mass: 0.52,
} as const

export function MessageBubble({
  variant = "soft",
  align,
  animateIn = false,
  className,
  children,
  initial,
  animate,
  exit,
  transition,
  layout,
  ...props
}: MessageBubbleProps) {
  const reduce = useReducedMotion() ?? false
  const messageSide = useContext(MessageSideContext)
  const resolvedAlign = align ?? messageSide ?? "start"

  return (
    <MessageBubbleContext.Provider
      value={{ align: resolvedAlign, animateIn, variant }}
    >
      <motion.div
        data-slot="message-bubble"
        data-align={resolvedAlign}
        data-variant={variant}
        layout={layout}
        initial={initial ?? false}
        animate={animate}
        exit={
          exit ?? (reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.99 })
        }
        transition={transition ?? (reduce ? { duration: 0.12 } : SPRING_LAYOUT)}
        className={cn(
          "group/bubble flex w-full flex-col",
          resolvedAlign === "end" ? "items-end" : "items-start",
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    </MessageBubbleContext.Provider>
  )
}

function bubbleContentClass(
  variant: MessageBubbleVariant,
  interactive: boolean
) {
  return cn(
    "relative z-0 min-w-9 max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 text-foreground",
    "[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-background/60 [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
    variant === "solid" && "text-background",
    variant === "ghost" && "w-full max-w-none rounded-none px-0 py-0",
    variant === "danger" && "text-destructive",
    interactive &&
      "cursor-pointer text-left outline-none transition-[background-color,color,transform] duration-150 hover:brightness-[0.98] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
  )
}

function bubbleSurfaceClass(
  variant: MessageBubbleVariant,
  align: MessageBubbleAlign
) {
  return cn(
    "pointer-events-none absolute inset-0 -z-10 rounded-[inherit]",
    align === "end" ? "origin-bottom-right" : "origin-bottom-left",
    variant === "solid" && "bg-foreground",
    variant === "soft" && "bg-muted",
    variant === "tint" && "bg-primary/10",
    variant === "outline" && "border border-border/70 bg-background",
    variant === "danger" && "bg-destructive/10"
  )
}

export function MessageBubbleContent({
  render,
  className,
  children,
  ...props
}: MessageBubbleContentProps) {
  const reduce = useReducedMotion() ?? false
  const {
    align = "start",
    animateIn,
    variant,
  } = useContext(MessageBubbleContext)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const notifyLayout = useCallback(
    () => setLayoutVersion((version) => version + 1),
    []
  )
  // 换成按钮/链接时补上可点击的交互态；render 为函数时无从判断，按非交互处理
  const renderedTag =
    render && typeof render !== "function" ? render.type : undefined
  const interactive = renderedTag === "button" || renderedTag === "a"
  const classes = cn(bubbleContentClass(variant, interactive), className)
  const composedChildren = (
    <>
      {variant !== "ghost" ? (
        <motion.span
          aria-hidden="true"
          layout={reduce ? false : "size"}
          layoutDependency={layoutVersion}
          initial={animateIn && !reduce ? { opacity: 0, scale: 0.92 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={
            reduce
              ? { duration: 0 }
              : {
                  opacity: { duration: 0.12, ease: EASE_OUT },
                  scale: BUBBLE_POP,
                  layout: SPRING_LAYOUT,
                }
          }
          className={bubbleSurfaceClass(variant, align)}
        />
      ) : null}
      <MessageBubbleLayoutContext.Provider value={notifyLayout}>
        <motion.div
          initial={animateIn ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={
            reduce ? { duration: 0.12, ease: EASE_OUT } : BUBBLE_CONTENT_REVEAL
          }
          className="relative"
        >
          {children}
        </motion.div>
      </MessageBubbleLayoutContext.Provider>
    </>
  )

  // 走 Base UI 的 useRender：render 元素的 props 与 ref 由它负责合并
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      { className: classes, children: composedChildren },
      props
    ),
    render,
    state: { slot: "message-bubble-content" },
  })
}

export function MessageBubbleGroup({
  spacing = "compact",
  className,
  ...props
}: MessageBubbleGroupProps) {
  return (
    <div
      data-slot="message-bubble-group"
      className={cn(
        "flex w-full flex-col",
        spacing === "compact" ? "gap-1.5" : "gap-3",
        className
      )}
      {...props}
    />
  )
}

const LINE_CLAMP_CLASS = {
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
} as const

export function MessageBubbleCollapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  collapsedLines = 4,
  moreLabel = "展开",
  lessLabel = "收起",
  contentClassName,
  triggerClassName,
  className,
  children,
  ...props
}: MessageBubbleCollapsibleProps) {
  const reduce = useReducedMotion() ?? false
  const contentId = useId()
  const notifyLayout = useContext(MessageBubbleLayoutContext)
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const currentOpen = open ?? internalOpen

  const setOpen = useCallback(
    (next: boolean) => {
      notifyLayout()
      if (open === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [notifyLayout, onOpenChange, open]
  )

  return (
    <div
      data-slot="message-bubble-collapsible"
      data-state={currentOpen ? "open" : "closed"}
      className={cn("w-full", className)}
      {...props}
    >
      <div
        id={contentId}
        className={cn(
          "transition-[mask-image] duration-200",
          !currentOpen && LINE_CLAMP_CLASS[collapsedLines],
          !currentOpen &&
            "[mask-image:linear-gradient(to_bottom,#000_68%,transparent_100%)]",
          contentClassName
        )}
      >
        {children}
      </div>
      <button
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className={cn(
          "mt-2 inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          triggerClassName
        )}
      >
        <span>{currentOpen ? lessLabel : moreLabel}</span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>
    </div>
  )
}
