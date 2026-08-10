import * as React from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import {
  CaretDownIcon,
  GlobeIcon,
  HashIcon,
  MagnifyingGlassIcon,
  UserIcon,
} from "@phosphor-icons/react"

import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

export type FacetOption = {
  name: string
  usage_count?: number
}

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
  allLabel: string
  searchPlaceholder: string
  loadingLabel: string
  noMatchLabel: string
  variant?: "owner" | "site" | "tag"
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
}: FacetSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [pos, setPos] = React.useState<PanelPos | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)

  const label =
    value == null ? allLabel : variant === "tag" ? `#${value}` : value
  const Icon =
    variant === "site" ? GlobeIcon : variant === "tag" ? HashIcon : UserIcon
  const formatItemName = (name: string) =>
    variant === "tag" ? `#${name}` : name

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "")
    if (!q) return items
    return items.filter((o) => o.name.toLowerCase().includes(q))
  }, [items, query])

  const setOpenSafe = React.useCallback((next: boolean) => {
    setOpen(next)
    if (!next) {
      setQuery("")
      setPos(null)
    }
  }, [])

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
        setQuery("")
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
  }, [open, query, setOpenSafe])

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
            <div className="relative shrink-0 border-b border-border/60 p-1.5">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 border-0 bg-transparent pr-2.5 pl-8 shadow-none focus-visible:ring-0"
                aria-label={searchPlaceholder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault()
                }}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {isLoading ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {loadingLabel}
                </div>
              ) : (
                <>
                  {!query.trim() ? (
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
                  ) : null}

                  {filtered.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      {noMatchLabel}
                    </div>
                  ) : (
                    filtered.map((item) => (
                      <button
                        key={item.name}
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
                        <span className="min-w-0 flex-1 truncate">
                          {formatItemName(item.name)}
                        </span>
                        {typeof item.usage_count === "number" ? (
                          <span className="shrink-0 text-muted-foreground">
                            {item.usage_count}
                          </span>
                        ) : null}
                      </button>
                    ))
                  )}
                </>
              )}
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
