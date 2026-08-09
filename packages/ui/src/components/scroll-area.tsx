"use client"

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@workspace/ui/lib/utils"

function ScrollArea({
  className,
  children,
  viewportClassName,
  contentClassName,
  viewportId,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string
  /** 内边距等样式应挂在 Content 上，避免打在 Viewport 上造成假溢出 */
  contentClassName?: string
  /** 挂到实际滚动的 Viewport 上（如虚拟列表 / scrollTo 需要绑定滚动根时） */
  viewportId?: string
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative flex flex-col overflow-hidden", className)}
      {...props}
    >
      {/*
        Root 用 column flex，Viewport 用 min-h-0 flex-1：
        避免 size-full 在 flex/max-height 下被内容撑开导致无法滚动。
        内边距放 Content，不放 Viewport：padding 会计入 scrollable overflow，
        导致内容视觉上已放下仍出现滚动条。
      */}
      <ScrollAreaPrimitive.Viewport
        id={viewportId}
        data-slot="scroll-area-viewport"
        className={cn(
          "min-h-0 w-full min-w-0 flex-1 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
          viewportClassName
        )}
      >
        <ScrollAreaPrimitive.Content
          data-slot="scroll-area-content"
          // 覆盖 Content 默认 minWidth:fit-content，避免竖向滚动区被宽内容撑出横向假溢出
          style={{ minWidth: 0 }}
          className={contentClassName}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "m-px flex touch-none p-px select-none",
        "opacity-0 transition-opacity pointer-events-none",
        // Base UI 无溢出时不挂载 Scrollbar；有溢出时仅悬停 / 滚动显示
        "data-hovering:opacity-100 data-hovering:pointer-events-auto",
        "data-scrolling:opacity-100 data-scrolling:pointer-events-auto data-scrolling:duration-0",
        "data-horizontal:h-2 data-horizontal:flex-col",
        "data-vertical:h-full data-vertical:w-2",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-foreground/15 transition-colors hover:bg-foreground/25"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
