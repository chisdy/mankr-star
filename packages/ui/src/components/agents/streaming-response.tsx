import {
  Check,
  ChevronDown,
  Copy,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"

import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@workspace/ui/lib/ease"
import { cn } from "@workspace/ui/lib/utils"
import { AgentDisclosure } from "./agent-disclosure"
import { type CitationItem, CitationList, CitationStack } from "./citations"

export type StreamingResponseStatus = "streaming" | "complete" | "error"
export type StreamingResponseFeedback = "up" | "down" | null

export interface StreamingResponseLabels {
  copy?: string
  copied?: string
  retry?: string
  helpful?: string
  notHelpful?: string
  /** 来源折叠按钮上的文案，通常由调用方按数量做复数处理 */
  sources?: ReactNode
}

export interface StreamingResponseProps {
  /** 渲染后的回答正文，可传纯文本或 Markdown 渲染结果 */
  children: ReactNode
  status?: StreamingResponseStatus
  /** 内置复制动作写入剪贴板的纯文本 */
  copyText?: string
  /** 覆盖内置的剪贴板行为 */
  onCopy?: () => void | Promise<void>
  onRetry?: () => void
  /** 流式结束后以紧凑折叠区展示的来源 */
  sources?: CitationItem[]
  sourcesOpen?: boolean
  defaultSourcesOpen?: boolean
  onSourcesOpenChange?: (open: boolean) => void
  sourceIdPrefix?: string
  feedback?: StreamingResponseFeedback
  defaultFeedback?: StreamingResponseFeedback
  onFeedbackChange?: (feedback: StreamingResponseFeedback) => void
  /** 外层会话记录已经播报流式文本时传 false，避免重复播报 */
  announce?: boolean
  /** 隐藏内置的完成态操作，但不改变 status */
  showActions?: boolean
  labels?: StreamingResponseLabels
  className?: string
  contentClassName?: string
  actionsClassName?: string
}

function ResponseAction({
  label,
  active = false,
  pressable = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  /** 该动作是开关语义时上报 aria-pressed */
  pressable?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const reduce = useReducedMotion() ?? false

  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressable ? active : undefined}
      onClick={onClick}
      whileTap={reduce ? undefined : { scale: 0.9 }}
      transition={SPRING_PRESS}
      className={cn(
        "grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-muted text-foreground"
      )}
    >
      {children}
    </motion.button>
  )
}

export function StreamingResponse({
  children,
  status = "streaming",
  copyText,
  onCopy,
  onRetry,
  sources = [],
  sourcesOpen,
  defaultSourcesOpen = false,
  onSourcesOpenChange,
  sourceIdPrefix,
  feedback,
  defaultFeedback = null,
  onFeedbackChange,
  announce = true,
  showActions = true,
  labels,
  className,
  contentClassName,
  actionsClassName,
}: StreamingResponseProps) {
  const reduce = useReducedMotion() ?? false
  const baseId = useId()
  const [copied, setCopied] = useState(false)
  const [internalFeedback, setInternalFeedback] =
    useState<StreamingResponseFeedback>(defaultFeedback)
  const [internalSourcesOpen, setInternalSourcesOpen] =
    useState(defaultSourcesOpen)
  const copyTimer = useRef<number | undefined>(undefined)
  const currentFeedback = feedback ?? internalFeedback
  const currentSourcesOpen = sourcesOpen ?? internalSourcesOpen
  const streaming = status === "streaming"
  const complete = status === "complete"
  const canCopy = Boolean(copyText || onCopy)
  const hasSources = sources.length > 0
  const shouldShowActions =
    showActions && !streaming && (canCopy || onRetry || complete || hasSources)
  const sourcesContentId = `${baseId}-sources`
  const resolvedSourcePrefix =
    sourceIdPrefix ?? `response-source-${baseId.replace(/:/g, "")}`

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    []
  )

  const handleCopy = useCallback(async () => {
    if (onCopy) await onCopy()
    else if (copyText) await navigator.clipboard?.writeText(copyText)

    setCopied(true)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
  }, [copyText, onCopy])

  const setFeedback = (next: Exclude<StreamingResponseFeedback, null>) => {
    const value = currentFeedback === next ? null : next
    if (feedback === undefined) setInternalFeedback(value)
    onFeedbackChange?.(value)
  }

  const setSourcesOpen = useCallback(
    (next: boolean) => {
      if (sourcesOpen === undefined) setInternalSourcesOpen(next)
      onSourcesOpenChange?.(next)
    },
    [onSourcesOpenChange, sourcesOpen]
  )

  return (
    <div
      data-state={status}
      aria-busy={streaming}
      className={cn("w-full", className)}
    >
      <div
        aria-live={announce ? "polite" : "off"}
        className={cn(
          "text-sm leading-6 text-foreground/90 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p+p]:mt-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/45 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
          contentClassName
        )}
      >
        {children}
      </div>

      <AnimatePresence initial={false}>
        {shouldShowActions ? (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
            className="mt-3"
          >
            <div className={cn("flex items-center gap-0.5", actionsClassName)}>
              {canCopy ? (
                <ResponseAction
                  label={
                    copied
                      ? (labels?.copied ?? "Copied")
                      : (labels?.copy ?? "Copy response")
                  }
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </ResponseAction>
              ) : null}
              {onRetry ? (
                <ResponseAction
                  label={labels?.retry ?? "Retry response"}
                  onClick={onRetry}
                >
                  <RotateCcw className="size-3.5" />
                </ResponseAction>
              ) : null}
              {complete ? (
                <>
                  <ResponseAction
                    label={labels?.helpful ?? "Helpful"}
                    pressable
                    active={currentFeedback === "up"}
                    onClick={() => setFeedback("up")}
                  >
                    <ThumbsUp className="size-3.5" />
                  </ResponseAction>
                  <ResponseAction
                    label={labels?.notHelpful ?? "Not helpful"}
                    pressable
                    active={currentFeedback === "down"}
                    onClick={() => setFeedback("down")}
                  >
                    <ThumbsDown className="size-3.5" />
                  </ResponseAction>
                </>
              ) : null}
              {hasSources ? (
                <button
                  type="button"
                  aria-expanded={currentSourcesOpen}
                  aria-controls={sourcesContentId}
                  onClick={() => setSourcesOpen(!currentSourcesOpen)}
                  className="group ml-1 inline-flex min-h-7 items-center gap-2 rounded-md px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CitationStack citations={sources} />
                  <span className="tabular-nums">
                    {labels?.sources ??
                      `${sources.length} ${sources.length === 1 ? "source" : "sources"}`}
                  </span>
                  <motion.span
                    aria-hidden="true"
                    animate={{ rotate: currentSourcesOpen ? 180 : 0 }}
                    transition={reduce ? { duration: 0 } : SPRING_SWAP}
                    className="text-muted-foreground/50 group-hover:text-muted-foreground"
                  >
                    <ChevronDown className="size-3" />
                  </motion.span>
                </button>
              ) : null}
            </div>

            {hasSources ? (
              <AgentDisclosure id={sourcesContentId} open={currentSourcesOpen}>
                <CitationList
                  citations={sources}
                  idPrefix={resolvedSourcePrefix}
                  className="mt-2 rounded-xl bg-muted p-2"
                />
              </AgentDisclosure>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
