import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"
import { TextShimmer } from "./text-shimmer"

export interface ThinkingShimmerProps {
  /** 展示给用户的等待文案 */
  children?: ReactNode
  /** 一轮扫光耗时，单位秒 */
  duration?: number
  className?: string
}

export function ThinkingShimmer({
  children = "Thinking…",
  duration = 1.8,
  className,
}: ThinkingShimmerProps) {
  return (
    <TextShimmer
      as="span"
      duration={duration}
      className={cn("font-medium", className)}
    >
      {children}
    </TextShimmer>
  )
}
