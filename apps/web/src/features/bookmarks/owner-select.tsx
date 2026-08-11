import * as React from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import {
  CaretDownIcon,
  GlobeIcon,
  HashIcon,
  UserIcon,
} from "@phosphor-icons/react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { SearchInput } from "@workspace/ui/components/search-input"
import { cn } from "@workspace/ui/lib/utils"

export type FacetOption = {
  name: string
  usage_count?: number
}

/**
 * 服务端分页接线。传入即代表：搜索由服务端负责，列表滚到底继续追加。
 */
export type FacetPaginationProps = {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** 追加失败时展示重试入口，并暂停自动触发 */
  loadMoreError?: boolean
  onLoadMore: () => void
  /** 搜索词变化（未防抖），由调用方决定防抖与请求时机 */
  onSearchChange: (query: string) => void
}

/** 选项行高估算：px-2 py-1.5 + text-xs 行高 */
const ROW_ESTIMATE_PX = 28
/** 距底部多少像素开始预加载下一页 */
const LOAD_MORE_THRESHOLD_PX = 80

export type FacetSelectProps = {
  items: FacetOption[]
  value?: string | null
  onValueChange: (value: string | null) => void
  isLoading?: boolean
  disabled?: boolean
  className?: string
  contentClassName?: string
  size?: "sm" | "default"
  /** full width trigger for side panel */
  fullWidth?: boolean
  /** 触发器内前缀标签，如「标签」「开发者」 */
  prefixLabel?: string
  /** 未选中时触发器文案；也可作「全部」选项文案（showAllOption 时） */
  allLabel: string
  searchPlaceholder: string
  loadingLabel: string
  noMatchLabel: string
  variant?: "owner" | "site" | "tag"
  /** 是否展示清空为「全部」的选项；合并目标等场景应关闭 */
  showAllOption?: boolean
  /** 只挂载视口附近的选项；长列表（标签等）建议开启 */
  virtualized?: boolean
  /** 传入则改用服务端搜索 + 上拉分页，不再本地过滤 */
  pagination?: FacetPaginationProps
}

type PanelPos = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

/**
 * 可搜索 facet 下拉（开发者 / 站点 / 标签）。
 * 弹层经 Portal 挂到 body，避免侧栏 overflow 裁切。
 */
export function FacetSelect({
  items,
  value = null,
  onValueChange,
  isLoading,
  disabled,
  className,
  contentClassName,
  size = "default",
  fullWidth = false,
  prefixLabel,
  allLabel,
  searchPlaceholder,
  loadingLabel,
  noMatchLabel,
  variant = "owner",
  showAllOption = true,
  virtualized = false,
  pagination,
}: FacetSelectProps) {
  const { t } = useTranslation(["common", "bookmarks"])
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [pos, setPos] = React.useState<PanelPos | null>(null)
  const [listEl, setListEl] = React.useState<HTMLDivElement | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)

  /** 服务端已按 q 过滤并分页，本地不再二次过滤 */
  const serverDriven = pagination != null

  const label =
    value == null ? allLabel : variant === "tag" ? `#${value}` : value
  const Icon =
    variant === "site" ? GlobeIcon : variant === "tag" ? HashIcon : UserIcon
  const formatItemName = (name: string) =>
    variant === "tag" ? `#${name}` : name

  /** tag 选项显示为 #name，用户常连 # 一起输入；本地过滤与服务端搜索按同一规则归一 */
  const toSearchTerm = (raw: string) =>
    variant === "tag" ? raw.trim().replace(/^#/, "") : raw.trim()

  const filtered = React.useMemo(() => {
    if (serverDriven) return items
    const q = toSearchTerm(query).toLowerCase()
    if (!q) return items
    return items.filter((o) => o.name.toLowerCase().includes(q))
  }, [items, query, serverDriven, variant])

  const emitSearch = React.useEffectEvent((raw: string) => {
    pagination?.onSearchChange(toSearchTerm(raw))
  })

  const applyQuery = React.useCallback((next: string) => {
    setQuery(next)
    emitSearch(next)
  }, [])

  const setOpenSafe = React.useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next) {
        applyQuery("")
        setPos(null)
      }
    },
    [applyQuery],
  )

  const virtualizer = useVirtualizer({
    count: virtualized ? filtered.length : 0,
    getScrollElement: () => listEl,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 8,
    getItemKey: (index) => filtered[index]?.name ?? index,
  })

  // 换关键词后结果整体替换，停在原滚动位置会看到列表中段，并可能立刻触发追加
  React.useEffect(() => {
    if (!listEl) return
    listEl.scrollTop = 0
  }, [query, listEl])

  const requestNextPage = React.useEffectEvent(() => {
    if (!pagination) return
    if (!pagination.hasNextPage) return
    if (pagination.isFetchingNextPage || pagination.loadMoreError) return
    pagination.onLoadMore()
  })

  const handleListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceToBottom > LOAD_MORE_THRESHOLD_PX) return
    requestNextPage()
  }

  const renderOption = (item: FacetOption) => (
    <button
      type="button"
      role="option"
      aria-selected={value === item.name}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent",
        value === item.name && "bg-accent",
      )}
      onClick={() => {
        onValueChange(item.name)
        setOpenSafe(false)
      }}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{formatItemName(item.name)}</span>
      {typeof item.usage_count === "number" ? (
        <span className="shrink-0 text-muted-foreground">{item.usage_count}</span>
      ) : null}
    </button>
  )

  const updatePosition = React.useEffectEvent(() => {
    const trigger = rootRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const gap = 4
    const preferredMax = 256
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8
    const spaceAbove = rect.top - gap - 8
    const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow
    const maxHeight = Math.max(
      120,
      Math.min(preferredMax, placeAbove ? spaceAbove : spaceBelow),
    )
    const width = fullWidth ? rect.width : Math.max(rect.width, 224)
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - width - 8,
    )
    setPos(
      placeAbove
        ? {
            bottom: window.innerHeight - rect.top + gap,
            left,
            width,
            maxHeight,
          }
        : {
            top: rect.bottom + gap,
            left,
            width,
            maxHeight,
          },
    )
  })

  React.useEffect(() => {
    if (!open) return
    updatePosition()
    const frameId = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => window.cancelAnimationFrame(frameId)
  }, [open])

  React.useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpenSafe(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      if (query) {
        applyQuery("")
        searchRef.current?.focus()
        return
      }
      setOpenSafe(false)
    }

    const onReposition = () => updatePosition()

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [open, query, applyQuery, setOpenSafe])

  const panel =
    open && pos
      ? createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className={cn(
              "z-50 flex flex-col overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
              contentClassName,
            )}
          >
            <div className="shrink-0 border-b border-border/60 p-1.5">
              <SearchInput
                ref={searchRef}
                value={query}
                onChange={(e) => applyQuery(e.target.value)}
                onClear={() => applyQuery("")}
                clearAriaLabel={t("common:accessibility.clearSearch")}
                placeholder={searchPlaceholder}
                className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
                aria-label={searchPlaceholder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault()
                }}
              />
            </div>

            {/* 「全部」固定在滚动区外，长列表滚动时不会被推走，也不参与虚拟化 */}
            {showAllOption && !query.trim() ? (
              <div
                role="presentation"
                className="shrink-0 border-b border-border/60 p-1"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent",
                    !value && "bg-accent",
                  )}
                  onClick={() => {
                    onValueChange(null)
                    setOpenSafe(false)
                  }}
                >
                  {allLabel}
                </button>
              </div>
            ) : null}

            <div
              ref={setListEl}
              onScroll={serverDriven ? handleListScroll : undefined}
              className="min-h-0 flex-1 overflow-y-auto p-1"
            >
              {isLoading ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {loadingLabel}
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {noMatchLabel}
                </div>
              ) : virtualized ? (
                <div
                  role="presentation"
                  className="relative w-full"
                  style={{ height: virtualizer.getTotalSize() }}
                >
                  {virtualizer.getVirtualItems().map((virtualItem) => {
                    const item = filtered[virtualItem.index]
                    if (!item) return null
                    return (
                      <div
                        key={virtualItem.key}
                        role="presentation"
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        className="absolute top-0 left-0 w-full"
                        style={{
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                      >
                        {renderOption(item)}
                      </div>
                    )
                  })}
                </div>
              ) : (
                filtered.map((item) => (
                  <React.Fragment key={item.name}>
                    {renderOption(item)}
                  </React.Fragment>
                ))
              )}

              {pagination?.loadMoreError ? (
                <div className="flex items-center justify-between gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <span>{t("bookmarks:pagination.loadMoreError")}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-sm px-1.5 py-0.5 text-foreground underline-offset-2 outline-none hover:underline"
                    onClick={() => pagination.onLoadMore()}
                  >
                    {t("bookmarks:pagination.retry")}
                  </button>
                </div>
              ) : pagination?.isFetchingNextPage ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {t("bookmarks:pagination.loadingMore")}
                </div>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div
      ref={rootRef}
      className={cn("relative", fullWidth && "w-full", className)}
    >
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "inline-flex items-center justify-between gap-1.5 rounded-md border border-input bg-transparent px-2.5 font-normal shadow-xs transition-[color,box-shadow] outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          fullWidth ? "h-8 w-full text-xs" : "h-9 min-w-28 text-sm",
          size === "sm" && !fullWidth && "h-8 text-xs",
          !value && "text-muted-foreground",
          value && "border-primary/50 bg-primary/10 hover:bg-primary/10",
        )}
        onClick={() => setOpenSafe(!open)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {prefixLabel ? (
            <span className="shrink-0 text-muted-foreground/55">{prefixLabel}</span>
          ) : null}
          <span className="truncate">{label}</span>
        </span>
        <CaretDownIcon className="size-3.5 shrink-0 opacity-50" />
      </button>
      {panel}
    </div>
  )
}

/** @deprecated Prefer FacetSelect; kept for call-site compatibility */
export type OwnerSelectProps = {
  owners: FacetOption[]
  value?: string | null
  onValueChange: (value: string | null) => void
  isLoading?: boolean
  disabled?: boolean
  className?: string
  contentClassName?: string
  size?: "sm" | "default"
}

export function OwnerSelect({ owners, ...rest }: OwnerSelectProps) {
  const { t } = useTranslation("bookmarks")
  return (
    <FacetSelect
      items={owners}
      variant="owner"
      allLabel={t("list.ownerAll")}
      searchPlaceholder={t("list.ownerSearch")}
      loadingLabel={t("list.ownerLoading")}
      noMatchLabel={t("list.ownerNoMatch")}
      {...rest}
    />
  )
}
