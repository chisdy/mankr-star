import type { Icon } from "@phosphor-icons/react"

import { cn } from "@workspace/ui/lib/utils"

interface EmptyStateProps {
  /** 通常传所在板块自己的图标，淡化显示即可点明这里本该有什么 */
  icon?: Icon
  className?: string
  children: React.ReactNode
}

/**
 * 无数据占位：虚线容器 + 可选图标。
 * 图表、榜单这类「有框但没内容」的区域统一用它，避免各写一套间距和描边。
 */
export function EmptyState({
  icon: EmptyIcon,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 px-3 py-8 text-center text-xs text-muted-foreground",
        className,
      )}
    >
      {EmptyIcon ? (
        <EmptyIcon className="mb-1.5 size-6 text-muted-foreground/40" />
      ) : null}
      <span>{children}</span>
    </div>
  )
}
