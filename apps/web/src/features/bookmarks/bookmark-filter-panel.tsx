import { useTranslation } from "react-i18next"

import { cn } from "@workspace/ui/lib/utils"
import { useFilterPanelOpen } from "@/hooks/use-filter-panel-open"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { FilterPanelBody } from "./filter-panel-body"

const FILTER_PANEL_MIN_WIDTH = 240
const FILTER_PANEL_MAX_WIDTH = 360
const FILTER_PANEL_DEFAULT_WIDTH = 280
const FILTER_PANEL_WIDTH_KEY = "mankr_filter_panel_width"

export function BookmarkFilterPanel({
  className,
  resizable = false,
}: {
  className?: string
  resizable?: boolean
}) {
  const { t } = useTranslation("bookmarks")
  const { open, setOpen } = useFilterPanelOpen()
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
    storageKey: FILTER_PANEL_WIDTH_KEY,
    minWidth: FILTER_PANEL_MIN_WIDTH,
    maxWidth: FILTER_PANEL_MAX_WIDTH,
    defaultWidth: FILTER_PANEL_DEFAULT_WIDTH,
    enabled: resizable && open,
  })

  if (!open) return null

  return (
    <aside
      ref={panelRef}
      style={resizable ? { width: panelWidth } : undefined}
      data-resizing={isResizing ? "" : undefined}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-border/50 bg-card/50",
        isResizing && "will-change-[width] select-none",
        !resizable && "w-[280px]",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden",
          isResizing && "pointer-events-none",
        )}
      >
        <FilterPanelBody onCollapse={() => setOpen(false)} />
      </div>

      {resizable ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("list.filterResizeAria")}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
          className={cn(
            "group/resize absolute inset-y-0 -left-1.5 z-30 flex w-3 cursor-col-resize touch-none items-stretch justify-center",
            "pointer-events-auto outline-none",
          )}
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
