import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { getAppScrollRoot } from "@/lib/scroll-root"

export type SectionNavItem = {
  id: string
  label: string
}

type SectionNavProps = {
  items: SectionNavItem[]
  children: React.ReactNode
  /** 无障碍：导航区域名称 */
  ariaLabel: string
  className?: string
  /**
   * 锚点滚动顶部留白（px），用于躲开 sticky 顶栏。
   * 移动端顶栏约 44px，默认给足一点余量。
   */
  scrollOffset?: number
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function replaceHash(id: string | null) {
  const url = new URL(window.location.href)
  const next = id ? `#${id}` : ""
  if (url.hash === next) return
  url.hash = next
  // replaceState 避免污染浏览器历史；hash 为空时清掉 `#`
  const href = id ? `${url.pathname}${url.search}#${id}` : `${url.pathname}${url.search}`
  window.history.replaceState(null, "", href)
}

function scrollToSection(id: string, offset: number) {
  const el = document.getElementById(id)
  const root = getAppScrollRoot()
  if (!el || !root) return

  const rootRect = root.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const top = root.scrollTop + (elRect.top - rootRect.top) - offset

  root.scrollTo({
    top: Math.max(0, top),
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  })
}

/**
 * 可复用分区锚点导航：
 * - lg+：左侧 sticky 竖列
 * - &lt;lg：顶部横向滚动标签
 * - IntersectionObserver scroll spy + URL hash 同步
 *
 * 滚动容器绑定 `APP_SCROLL_ROOT_ID`（AppShell 主内容区），而非 window。
 */
export function SectionNav({
  items,
  children,
  ariaLabel,
  className,
  scrollOffset = 56,
}: SectionNavProps) {
  const [activeId, setActiveId] = React.useState<string>(
    () => items[0]?.id ?? "",
  )
  const lockRef = React.useRef(false)
  const lockTimerRef = React.useRef<number | null>(null)
  const mobileListRef = React.useRef<HTMLDivElement>(null)

  const itemIdsKey = items.map((item) => item.id).join("|")

  const setActive = React.useEffectEvent((id: string, syncHash: boolean) => {
    setActiveId(id)
    if (syncHash) replaceHash(id)
  })

  // 初始 / 外部 hash 变化时定位
  React.useEffect(() => {
    const itemIds = itemIdsKey ? itemIdsKey.split("|") : []

    const applyHash = (smooth: boolean) => {
      const raw = window.location.hash.replace(/^#/, "")
      if (!raw || !itemIds.includes(raw)) return
      setActiveId(raw)
      lockRef.current = true
      if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current)
      // 等布局稳定后再滚；hash 直达用 auto，避免首屏晃动
      requestAnimationFrame(() => {
        const root = getAppScrollRoot()
        const el = document.getElementById(raw)
        if (!root || !el) {
          lockRef.current = false
          return
        }
        const rootRect = root.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        const top = root.scrollTop + (elRect.top - rootRect.top) - scrollOffset
        root.scrollTo({
          top: Math.max(0, top),
          behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
        })
        lockTimerRef.current = window.setTimeout(() => {
          lockRef.current = false
        }, smooth ? 700 : 100)
      })
    }

    applyHash(false)
    const onHashChange = () => applyHash(true)
    window.addEventListener("hashchange", onHashChange)
    return () => {
      window.removeEventListener("hashchange", onHashChange)
      if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current)
    }
  }, [itemIdsKey, scrollOffset])

  // Scroll spy
  React.useEffect(() => {
    const itemIds = itemIdsKey ? itemIdsKey.split("|") : []
    const root = getAppScrollRoot()
    if (!root || itemIds.length === 0) return

    const elements = itemIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el))

    if (elements.length === 0) return

    const ratios = new Map<string, number>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target.id, entry.intersectionRatio)
        }
        if (lockRef.current) return

        // 取可见比例最高的区块；并列时取更靠上的
        let bestId = ""
        let bestRatio = 0
        for (const id of itemIds) {
          const ratio = ratios.get(id) ?? 0
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestId = id
          }
        }
        if (!bestId || bestRatio <= 0) {
          // 贴近顶部时：找第一个顶边已越过观察带的区块
          const rootTop = root.getBoundingClientRect().top + scrollOffset
          let current = itemIds[0] ?? ""
          for (const id of itemIds) {
            const el = document.getElementById(id)
            if (!el) continue
            if (el.getBoundingClientRect().top <= rootTop + 8) current = id
          }
          bestId = current
        }
        if (bestId) setActive(bestId, true)
      },
      {
        root,
        // 偏向上半屏，避免底部大块抢占 active
        rootMargin: `-${scrollOffset}px 0px -55% 0px`,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    )

    for (const el of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [itemIdsKey, scrollOffset, setActive])

  // 移动端：active 项滚入横向可视区
  React.useEffect(() => {
    const list = mobileListRef.current
    if (!list || !activeId) return
    const btn = list.querySelector<HTMLElement>(`[data-section-id="${activeId}"]`)
    if (!btn) return
    const listRect = list.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    if (btnRect.left < listRect.left || btnRect.right > listRect.right) {
      btn.scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      })
    }
  }, [activeId])

  const handleSelect = (id: string) => {
    lockRef.current = true
    if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current)
    setActiveId(id)
    replaceHash(id)
    scrollToSection(id, scrollOffset)
    lockTimerRef.current = window.setTimeout(() => {
      lockRef.current = false
    }, 700)
  }

  return (
    <div className={cn("relative", className)}>
      {/* 移动 / 平板：顶部横向标签 */}
      <nav
        aria-label={ariaLabel}
        className="sticky top-0 z-20 -mx-4 mb-6 border-b border-border/50 bg-card/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-card/65 lg:hidden"
      >
        <div
          ref={mobileListRef}
          className="flex gap-1.5 overflow-x-auto py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => {
            const active = activeId === item.id
            return (
              <button
                key={item.id}
                type="button"
                data-section-id={item.id}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium whitespace-nowrap transition-[color,background-color,transform] duration-200 ease-out",
                  "active:scale-[0.97]",
                  active
                    ? "bg-foreground text-background shadow-sm"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => handleSelect(item.id)}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,48rem)] lg:items-start lg:justify-center lg:gap-10">
        {/* 桌面：左侧 sticky 竖列 — 与 AppSidebar 同一套 accent 激活语义 */}
        <nav
          aria-label={ariaLabel}
          className="sticky top-4 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto lg:block"
        >
          <ul className="space-y-1">
            {items.map((item) => {
              const active = activeId === item.id
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    data-section-id={item.id}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "group relative flex w-full items-center rounded-md px-3 py-2 text-left text-[13px] leading-snug transition-[color,background-color,transform] duration-200 ease-out",
                      "active:scale-[0.98]",
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                    onClick={() => handleSelect(item.id)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-full transition-opacity duration-200",
                        active
                          ? "bg-foreground opacity-100"
                          : "bg-transparent opacity-0 group-hover:bg-border group-hover:opacity-100",
                      )}
                    />
                    <span className="min-w-0 truncate">{item.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
