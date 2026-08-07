import { BookOpenText, ChevronDown, ExternalLink, Globe2 } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import type { MouseEvent } from "react"
import { type ReactNode, useCallback, useId, useState } from "react"

import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from "@workspace/ui/lib/ease"
import { getFaviconUrl } from "@workspace/ui/lib/favicon"
import { safeHttpHref } from "@workspace/ui/lib/safe-url"
import { cn } from "@workspace/ui/lib/utils"
import { AgentDisclosure } from "./agent-disclosure"

export interface CitationItem {
  id: string
  title: ReactNode
  domain?: ReactNode
  url?: string
  /**
   * 站内链接。存在时行主体链到站内，原始外链降级为行尾的独立图标按钮。
   * 仍然是真 href，右键新标签、复制链接照常可用。
   */
  internalHref?: string
  /** 拦截站内链接的左键点击，交给前端路由原地导航 */
  onInternalClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  /** 行尾外链图标的无障碍标签 */
  externalLabel?: string
}

export interface CitationsProps {
  citations: CitationItem[]
  title?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  idPrefix?: string
  className?: string
}

export interface CitationProps {
  citationId: string
  index: number
  /** 必须与配对的 Citations idPrefix 一致 */
  idPrefix: string
  /** 无障碍标签，默认拼英文；传入以走 i18n */
  label?: string
  className?: string
}

export interface CitationListProps {
  citations: CitationItem[]
  idPrefix?: string
  className?: string
}

export interface CitationStackProps {
  citations: CitationItem[]
  limit?: number
  className?: string
}

function citationTargetId(prefix: string, citationId: string) {
  return `${prefix}-${citationId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

export function Citation({
  citationId,
  index,
  idPrefix,
  label,
  className,
}: CitationProps) {
  return (
    <a
      href={`#${citationTargetId(idPrefix, citationId)}`}
      aria-label={label ?? `View citation ${index}`}
      className={cn(
        "mx-0.5 inline-flex min-w-4 -translate-y-0.5 items-center justify-center rounded-md bg-muted/60 px-1 py-0.5 text-[10px] leading-none font-semibold text-muted-foreground no-underline outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {index}
    </a>
  )
}

export function CitationFavicon({
  url,
  className,
}: {
  url?: string
  className?: string
}) {
  const favicon = url ? getFaviconUrl(url) : null
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-5 shrink-0 place-items-center text-muted-foreground",
        className
      )}
    >
      {favicon && failedUrl !== favicon ? (
        <img
          src={favicon}
          alt=""
          width={16}
          height={16}
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(favicon)}
          className="size-4 rounded-sm object-contain"
        />
      ) : (
        <Globe2 className="size-3.5" />
      )}
    </span>
  )
}

export function CitationStack({
  citations,
  limit = 3,
  className,
}: CitationStackProps) {
  return (
    <span aria-hidden="true" className={cn("flex -space-x-1.5", className)}>
      {citations.slice(0, limit).map((citation) => (
        <CitationFavicon
          key={citation.id}
          url={citation.url}
          className="size-6 rounded-full bg-background ring-2 ring-background"
        />
      ))}
    </span>
  )
}

function CitationRow({
  citation,
  index,
  idPrefix,
}: {
  citation: CitationItem
  index: number
  idPrefix: string
}) {
  const href = safeHttpHref(citation.url)
  const externalLabel = citation.externalLabel ?? "Open original in new tab"
  // favicon 始终按原始外链的域名取，站内路径算不出图标
  const label = (
    <>
      <span className="flex shrink-0 items-start gap-1.5 pt-0.5">
        <span className="grid size-5 place-items-center rounded-md bg-foreground/[0.05] text-[10px] font-semibold tabular-nums text-muted-foreground">
          {index}
        </span>
        <CitationFavicon url={citation.url} />
      </span>
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="block truncate text-sm font-medium text-foreground/80 transition-colors group-hover/citation:text-foreground">
          {citation.title}
        </span>
        {citation.domain ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground/60">
            {citation.domain}
          </span>
        ) : null}
      </span>
    </>
  )
  const content = (
    <>
      {label}
      {href ? (
        <span
          aria-hidden="true"
          className="grid size-5 shrink-0 place-items-center pt-0.5 text-muted-foreground/40 transition-colors group-hover/citation:text-muted-foreground"
        >
          <ExternalLink className="size-3.5" />
        </span>
      ) : null}
    </>
  )
  const className =
    "group/citation flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
  const id = citationTargetId(idPrefix, citation.id)

  // 站内来源：行主体进站内，原始外链退到行尾。两个 <a> 必须并列，不能嵌套。
  if (citation.internalHref) {
    return (
      <div id={id} className={className}>
        <a
          href={citation.internalHref}
          onClick={citation.onInternalClick}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </a>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            referrerPolicy="no-referrer"
            aria-label={externalLabel}
            className="grid size-5 shrink-0 place-items-center rounded-md pt-0.5 text-muted-foreground/40 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
    )
  }

  return href ? (
    <a
      id={id}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      referrerPolicy="no-referrer"
      className={className}
    >
      {content}
    </a>
  ) : (
    <div id={id} className={className}>
      {content}
    </div>
  )
}

export function CitationList({
  citations,
  idPrefix,
  className,
}: CitationListProps) {
  const reduce = useReducedMotion() ?? false
  const baseId = useId()
  const resolvedPrefix = idPrefix ?? `citation-list-${baseId.replace(/:/g, "")}`

  // 不用依赖父级显式高度的 ScrollArea：嵌在 AgentDisclosure / 对话滚动区里时
  // viewport 的 h-full 算不出上限。max-h + overflow-y-auto 才能又收缩又滚动。
  return (
    <div
      className={cn(
        "max-h-60 min-w-0 overflow-y-auto overscroll-contain",
        className
      )}
    >
      <div className="grid min-w-0 gap-0.5">
        <AnimatePresence mode="popLayout">
          {citations.map((citation, index) => (
            <motion.div
              layout="position"
              key={citation.id}
              className="min-w-0"
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : {
                      opacity: { duration: 0.18, ease: EASE_OUT },
                      y: SPRING_LAYOUT,
                      layout: SPRING_LAYOUT,
                    }
              }
            >
              <CitationRow
                citation={citation}
                index={index + 1}
                idPrefix={resolvedPrefix}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function Citations({
  citations,
  title = "Sources",
  open,
  defaultOpen = false,
  onOpenChange,
  idPrefix,
  className,
}: CitationsProps) {
  const reduce = useReducedMotion() ?? false
  const baseId = useId()
  const contentId = `${baseId}-content`
  const resolvedPrefix = idPrefix ?? `citation-${baseId.replace(/:/g, "")}`
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const currentOpen = open ?? internalOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange, open]
  )

  return (
    <div className={cn("w-full text-sm", className)}>
      <button
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group -ml-1 flex min-h-8 items-center gap-2 rounded-lg px-1 text-left text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpenText className="size-4" />
        <span className="font-medium">{title}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
          {citations.length}
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="text-muted-foreground/60"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure id={contentId} open={currentOpen}>
        <CitationList
          citations={citations}
          idPrefix={resolvedPrefix}
          className="mt-1"
        />
      </AgentDisclosure>
    </div>
  )
}
