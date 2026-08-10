import { useTranslation } from "react-i18next"

import { cn } from "@workspace/ui/lib/utils"
import { useKbPanelOpen } from "@/hooks/use-kb-panel-open"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { KbChatBody } from "./kb-chat-body"

const KB_PANEL_MIN_WIDTH = 300
const KB_PANEL_MAX_WIDTH = 420
const KB_PANEL_DEFAULT_WIDTH = 360
const KB_PANEL_WIDTH_KEY = "mankr_kb_panel_width"

export function KbChatPanel({
  className,
  resizable = false,
}: {
  className?: string
  resizable?: boolean
}) {
  const { t } = useTranslation("kb")
  const { open } = useKbPanelOpen()
  const {
    panelRef,
    panelWidth,
    isResizing,
    minWidth,
    maxWidth,
    handleResizePointerDown,
    handleResizeKeyDown,
  } = useResizablePanel({
    edge: "left",
    storageKey: KB_PANEL_WIDTH_KEY,
    minWidth: KB_PANEL_MIN_WIDTH,
    maxWidth: KB_PANEL_MAX_WIDTH,
    defaultWidth: KB_PANEL_DEFAULT_WIDTH,
    enabled: resizable && open,
  })

  const currentWidth = open ? (resizable ? panelWidth : 360) : 0

  return (
    <aside
      ref={panelRef}
      style={{ width: currentWidth }}
      data-resizing={isResizing ? "" : undefined}
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      className={cn(
        "relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l bg-card/50",
        open
          ? "border-border/50 opacity-100"
          : "border-l-transparent opacity-0 pointer-events-none invisible",
        !isResizing && "transition-[width,opacity,border-color] duration-300 ease-in-out",
        isResizing && "will-change-[width] select-none transition-none",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-full min-h-0 shrink-0 flex-col overflow-hidden",
          isResizing && "pointer-events-none",
        )}
        style={{ width: resizable ? panelWidth : 360 }}
      >
        {/* 桌面端不给收起按钮：顶栏的对话图标本身就是开关 */}
        <KbChatBody />
      </div>

      {resizable && open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("resizeAria")}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
          className="group/resize pointer-events-auto absolute inset-y-0 -left-1.5 z-30 flex w-3 cursor-col-resize touch-none items-stretch justify-center outline-none"
        >
          <span
            aria-hidden
            className={cn(
              "my-0 w-px rounded-full bg-transparent transition-[width,background-color,box-shadow,opacity] duration-150 ease-out",
              "group-hover/resize:w-0.5 group-hover/resize:bg-primary/70 group-hover/resize:shadow-[0_0_0_1px] group-hover/resize:shadow-primary/20",
              "group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-primary",
              isResizing &&
                "w-1 bg-primary shadow-[0_0_0_1px] shadow-primary/30",
            )}
          />
        </div>
      ) : null}
    </aside>
  )
}
