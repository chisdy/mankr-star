import { CheckIcon, CopyIcon } from "@phosphor-icons/react"

import { cn } from "@workspace/ui/lib/utils"

/** 贴在输入框右侧或字段行尾的复制按钮，复制成功后短暂变勾 */
export function CopyIconButton({
  copied,
  onClick,
  disabled,
  label,
  className,
}: {
  copied: boolean
  onClick: () => void
  disabled?: boolean
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      tabIndex={-1}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" weight="bold" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </button>
  )
}
