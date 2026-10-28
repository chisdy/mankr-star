import { CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

export function FolderSlugSuggestButton({
  pending,
  disabled,
  label,
  pendingLabel,
  preserveFocus = true,
  onClick,
  className,
}: {
  pending: boolean
  disabled?: boolean
  label: string
  pendingLabel?: string
  /** 为 true 时点击不转移焦点，避免旁边的输入框先失焦提交旧值 */
  preserveFocus?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={pending ? (pendingLabel ?? label) : label}
            aria-busy={pending}
            disabled={disabled || pending}
            onMouseDown={(event) => {
              if (preserveFocus) event.preventDefault()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onClick()
            }}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-[min(var(--radius-md),8px)] text-primary/80 transition-[color,background-color,transform,opacity] duration-150 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 motion-reduce:active:scale-100",
              className
            )}
          >
            {pending ? (
              <CircleNotchIcon className="size-3.5 motion-safe:animate-spin" />
            ) : (
              <SparkleIcon className="size-3.5" weight="fill" />
            )}
          </button>
        }
      />
      <TooltipContent className="z-[80]">
        {pending ? (pendingLabel ?? label) : label}
      </TooltipContent>
    </Tooltip>
  )
}
