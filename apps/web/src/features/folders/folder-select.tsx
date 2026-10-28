import * as React from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { CaretDownIcon, FolderIcon } from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { SearchInput } from "@workspace/ui/components/search-input"
import { cn } from "@workspace/ui/lib/utils"
import { filterFoldersByName, folderPathLabel } from "@/lib/folder-utils"
import type { Folder } from "@/lib/types"
import { FolderTree } from "./folder-tree"

export type FolderSelectProps = {
  folders: Folder[]
  value?: string | null
  onValueChange: (value: string | null) => void
  /** 空值选项文案，如「自动智能推荐文件夹」；不传则不允许清空 */
  noneLabel?: string
  placeholder?: string
  isLoading?: boolean
  disabled?: boolean
  id?: string
  className?: string
  /** 弹出层额外 class */
  contentClassName?: string
  excludeIds?: Set<string>
  showCount?: boolean
  portaled?: boolean
}

/**
 * 文件夹下拉选择器（支持按名称搜索）。
 *
 * 不用 Popover：嵌在 Dialog 里时，Base UI FloatingPortal 会挂到 Dialog portal，
 * 固定高度的树面板会被算进弹窗布局，把 Dialog「撑高」。
 * 这里用 relative + absolute，浮层脱离文档流，高度不会影响父级。
 */
export function FolderSelect({
  folders,
  value = null,
  onValueChange,
  noneLabel,
  placeholder,
  isLoading,
  disabled,
  id,
  className,
  contentClassName,
  excludeIds,
  showCount,
  portaled = false,
}: FolderSelectProps) {
  const { t } = useTranslation("folders")
  const resolvedPlaceholder = placeholder ?? t("select.placeholder")
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const rootRef = React.useRef<HTMLDivElement>(null)
  const popoverRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const [coords, setCoords] = React.useState<{
    top: number
    left: number
    width: number
  }>({
    top: 0,
    left: 0,
    width: 256,
  })

  const selected = React.useMemo(
    () => (value ? (folders.find((f) => f.id === value) ?? null) : null),
    [folders, value]
  )

  const label = selected
    ? folderPathLabel(selected, folders)
    : noneLabel || resolvedPlaceholder

  const { folders: filteredFolders, expandIds } = React.useMemo(
    () => filterFoldersByName(folders, query),
    [folders, query]
  )

  const setOpenSafe = React.useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setQuery("")
  }, [])

  const updateCoords = React.useCallback(() => {
    if (!rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const width = Math.max(256, rect.width)
    let left = rect.left
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8)
    }
    const next = {
      top: rect.bottom + 4,
      left: Math.max(8, left),
      width,
    }
    setCoords((prev) =>
      prev.top === next.top &&
      prev.left === next.left &&
      prev.width === next.width
        ? prev
        : next
    )
  }, [])

  React.useEffect(() => {
    if (!open || !portaled) return
    updateCoords()
    window.addEventListener("resize", updateCoords)
    return () => window.removeEventListener("resize", updateCoords)
  }, [open, portaled, updateCoords])

  React.useEffect(() => {
    if (!open) return
    const frameId = window.requestAnimationFrame(() =>
      searchRef.current?.focus()
    )
    return () => window.cancelAnimationFrame(frameId)
  }, [open])

  React.useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
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

    let frame = 0
    const scheduleCoords = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateCoords()
      })
    }

    const onScroll = (event: Event) => {
      if (!portaled) return
      const target = event.target
      // 弹层内部（文件夹树）滚动不应关闭；否则列表一滚就收起
      if (
        target instanceof Node &&
        (popoverRef.current?.contains(target) ||
          rootRef.current?.contains(target))
      ) {
        return
      }
      const anchor = rootRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const visible =
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth
      if (!visible) {
        if (frame) {
          window.cancelAnimationFrame(frame)
          frame = 0
        }
        setOpenSafe(false)
        return
      }
      scheduleCoords()
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("scroll", onScroll, { capture: true })
    }
  }, [open, portaled, query, setOpenSafe, updateCoords])

  const popoverContent = open ? (
    <div
      ref={popoverRef}
      role="listbox"
      data-slot="folder-select-content"
      style={
        portaled
          ? {
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
            }
          : undefined
      }
      className={cn(
        "z-50 flex h-72 min-w-64 flex-col overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
        !portaled && "absolute top-[calc(100%+4px)] left-0 w-full",
        contentClassName
      )}
    >
      <div className="shrink-0 border-b border-border/60 p-1.5">
        <SearchInput
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          clearAriaLabel={t("common:accessibility.clearSearch")}
          placeholder={t("select.searchPlaceholder")}
          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
          aria-label={t("select.searchAria")}
          onKeyDown={(e) => {
            // 避免在 Dialog 内按 Enter 误提交外层表单
            if (e.key === "Enter") e.preventDefault()
          }}
        />
      </div>

      <FolderTree
        folders={filteredFolders}
        value={value}
        noneLabel={query.trim() ? undefined : noneLabel}
        isLoading={isLoading}
        showCount={showCount}
        excludeIds={excludeIds}
        forcedOpenIds={expandIds}
        emptyLabel={query.trim() ? t("select.noMatch") : t("select.empty")}
        className="min-h-0 flex-1"
        onSelect={(nextId) => {
          onValueChange(nextId)
          setOpenSafe(false)
        }}
      />
    </div>
  ) : null

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <Button
        type="button"
        id={id}
        variant="outline"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "h-9 w-full justify-between gap-2 px-2.5 font-normal",
          !selected && "text-muted-foreground"
        )}
        onClick={() => setOpenSafe(!open)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs md:text-sm">
          {selected?.color ? (
            <FolderIcon
              className="size-4 shrink-0"
              weight="fill"
              style={{ color: selected.color }}
            />
          ) : (
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{label}</span>
        </span>
        <CaretDownIcon className="size-4 shrink-0 opacity-50" />
      </Button>

      {portaled && typeof document !== "undefined"
        ? createPortal(popoverContent, document.body)
        : popoverContent}
    </div>
  )
}
