import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"

type BookmarkSelectControlProps = {
  selected?: boolean
  ariaLabel: string
  className?: string
  /** 勾选框背后的软光晕；标签卡等干净场景可关掉 */
  showBackdrop?: boolean
  onSelectedChange: (selected: boolean) => void
}

/**
 * 悬浮多选：不占文档流。勾选框背后用软光晕托住，避免和徽章/标题糊在一起。
 */
export function BookmarkSelectControl({
  selected,
  ariaLabel,
  className,
  showBackdrop = true,
  onSelectedChange,
}: BookmarkSelectControlProps) {
  return (
    <div
      className={cn(
        "absolute z-10 grid size-7 place-items-center",
        "opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100",
        "motion-reduce:transition-none",
        selected && "opacity-100",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {showBackdrop ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-[-2px] rounded-full",
            // 中心实、边缘散开的托底，在浅/深色卡片上都能读出来
            "bg-[radial-gradient(circle_at_center,var(--background)_0%,color-mix(in_oklab,var(--background)_70%,transparent)_55%,transparent_78%)]",
            "shadow-[0_0_10px_4px_color-mix(in_oklab,var(--background)_45%,transparent)]",
            selected &&
              "bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--background)_92%,var(--primary)_8%)_0%,color-mix(in_oklab,var(--background)_55%,transparent)_58%,transparent_80%)]",
          )}
        />
      ) : null}
      <Checkbox
        checked={Boolean(selected)}
        aria-label={ariaLabel}
        className="relative z-[1] cursor-pointer border-foreground/35 bg-card shadow-sm dark:border-foreground/45 dark:bg-card"
        onCheckedChange={(checked) => onSelectedChange(checked === true)}
      />
    </div>
  )
}
