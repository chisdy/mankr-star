"use client"

import * as React from "react"
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react"
import { HexColorPicker } from "react-colorful"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

/** UI 包内通用 fallback；业务侧应传入 FOLDER_COLOR_PRESETS */
const DEFAULT_PRESETS = [
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#84CC16",
  "#10B981",
  "#06B6D4",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
  "#64748B",
  "#0F172A",
] as const

/** 规范化为合法大写 #RRGGBB；非法则返回 null */
export function normalizeHex(input: string): string | null {
  const raw = input.trim()
  const withHash = raw.startsWith("#") ? raw : `#${raw}`
  if (!HEX_RE.test(withHash)) return null
  return withHash.toUpperCase()
}

export type ColorPickerProps = {
  value: string
  onValueChange: (hex: string) => void
  presets?: readonly string[]
  disabled?: boolean
  id?: string
  className?: string
  "aria-label"?: string
}

/**
 * 标签色选择器：预设色板 + HexColorPicker + Hex 输入。
 *
 * 不用 Popover：嵌在 Dialog 里时 Base UI FloatingPortal 会把固定高度面板算进弹窗布局撑高。
 * 与 FolderSelect 同：relative + absolute，浮层脱离文档流。
 */
export function ColorPicker({
  value,
  onValueChange,
  presets = DEFAULT_PRESETS,
  disabled,
  id,
  className,
  "aria-label": ariaLabel = "选择颜色",
}: ColorPickerProps) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [open, setOpen] = React.useState(false)

  const safeValue = normalizeHex(value) ?? "#3B82F6"
  const [draft, setDraft] = React.useState(safeValue.replace("#", ""))

  React.useEffect(() => {
    setDraft(safeValue.replace("#", ""))
  }, [safeValue])

  const commit = React.useCallback(
    (next: string) => {
      const normalized = normalizeHex(next)
      if (!normalized || normalized === safeValue) return
      onValueChange(normalized)
    },
    [onValueChange, safeValue],
  )

  React.useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const handleDraftChange = (raw: string) => {
    const cleaned = raw.replace(/^#/, "").replace(/[^0-9A-Fa-f]/g, "").slice(0, 6)
    setDraft(cleaned)
    if (cleaned.length === 6) {
      commit(`#${cleaned}`)
    }
  }

  return (
    <div ref={rootRef} className={cn("relative w-full max-w-56", className)}>
      <Button
        type="button"
        id={id}
        variant="outline"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="h-9 w-full justify-between gap-2 px-2.5 font-normal"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-sm ring-1 ring-border"
            style={{ backgroundColor: safeValue }}
          />
          <span className="truncate font-mono text-xs uppercase">{safeValue}</span>
        </span>
        <CaretDownIcon className="size-4 shrink-0 opacity-50" />
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label={ariaLabel}
          data-slot="color-picker-content"
          className="absolute top-[calc(100%+4px)] left-0 z-50 flex w-56 flex-col gap-3 rounded-md bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <div
            role="radiogroup"
            aria-label="预设颜色"
            className="grid grid-cols-6 gap-1.5"
          >
            {presets.map((swatch) => {
              const hex = normalizeHex(swatch) ?? swatch
              const selected = hex.toUpperCase() === safeValue
              return (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={hex}
                  className="relative flex size-6 items-center justify-center rounded-md ring-1 ring-border outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ backgroundColor: hex }}
                  onClick={() => commit(hex)}
                >
                  {selected ? (
                    <CheckIcon
                      weight="bold"
                      className="size-3.5 text-white drop-shadow-[0_0_1px_rgba(0,0,0,0.85)]"
                      aria-hidden
                    />
                  ) : null}
                </button>
              )
            })}
          </div>

          <HexColorPicker
            color={safeValue}
            onChange={(c) => commit(c)}
            className="mankr-hex-color-picker"
          />

          <div className="flex h-8 items-center overflow-hidden rounded-md border border-input bg-transparent shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
            <span
              aria-hidden
              className="shrink-0 pl-2.5 font-mono text-xs text-muted-foreground select-none"
            >
              #
            </span>
            <Input
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onBlur={() => {
                if (draft.length === 6) commit(`#${draft}`)
                else setDraft(safeValue.replace("#", ""))
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  if (draft.length === 6) {
                    commit(`#${draft}`)
                    setOpen(false)
                  }
                }
              }}
              maxLength={6}
              spellCheck={false}
              aria-label="十六进制颜色"
              className="h-full border-0 bg-transparent px-1.5 font-mono text-xs uppercase shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
