import * as React from "react"
import { useTranslation } from "react-i18next"
import { CaretDownIcon, MagnifyingGlassIcon, UserIcon } from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import type { BookmarkOwner } from "@/lib/types"

export type OwnerSelectProps = {
  owners: BookmarkOwner[]
  value?: string | null
  onValueChange: (value: string | null) => void
  isLoading?: boolean
  disabled?: boolean
  className?: string
  contentClassName?: string
  /** Compact toolbar trigger (h-8) */
  size?: "sm" | "default"
}

/**
 * 开发者（owner）可搜索下拉，交互对齐 FolderSelect。
 */
export function OwnerSelect({
  owners,
  value = null,
  onValueChange,
  isLoading,
  disabled,
  className,
  contentClassName,
  size = "default",
}: OwnerSelectProps) {
  const { t } = useTranslation("bookmarks")
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const rootRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)

  const label = value || t("list.ownerAll")

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return owners
    return owners.filter((o) => o.name.toLowerCase().includes(q))
  }, [owners, query])

  const setOpenSafe = React.useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setQuery("")
  }, [])

  React.useEffect(() => {
    if (!open) return
    const frameId = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => window.cancelAnimationFrame(frameId)
  }, [open])

  React.useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
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

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open, query, setOpenSafe])

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        size={size === "sm" ? "sm" : "default"}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "min-w-28 justify-between gap-1.5 px-2.5 font-normal",
          size === "sm" && "h-8 text-xs",
          !value && "text-muted-foreground",
        )}
        onClick={() => setOpenSafe(!open)}
      >
        <span className="truncate">{label}</span>
        <CaretDownIcon className="size-3.5 shrink-0 opacity-50" />
      </Button>

      {open ? (
        <div
          role="listbox"
          className={cn(
            "absolute top-[calc(100%+4px)] left-0 z-50 flex max-h-64 w-56 flex-col overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
            contentClassName,
          )}
        >
          <div className="relative shrink-0 border-b border-border/60 p-1.5">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("list.ownerSearch")}
              className="h-8 border-0 bg-transparent pr-2.5 pl-8 shadow-none focus-visible:ring-0"
              aria-label={t("list.ownerSearch")}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault()
              }}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {isLoading ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                {t("list.ownerLoading")}
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
                    {t("list.ownerAll")}
                  </button>
                ) : null}

                {filtered.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground">
                    {t("list.ownerNoMatch")}
                  </div>
                ) : (
                  filtered.map((owner) => (
                    <button
                      key={owner.name}
                      type="button"
                      role="option"
                      aria-selected={value === owner.name}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent",
                        value === owner.name && "bg-accent",
                      )}
                      onClick={() => {
                        onValueChange(owner.name)
                        setOpenSafe(false)
                      }}
                    >
                      <UserIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{owner.name}</span>
                      {typeof owner.usage_count === "number" ? (
                        <span className="shrink-0 text-muted-foreground">
                          {owner.usage_count}
                        </span>
                      ) : null}
                    </button>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
