import * as React from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { useTranslation } from "react-i18next"
import { GitMergeIcon } from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { getAppScrollRoot } from "@/lib/scroll-root"

const MAX_MERGE_SOURCES = 100

type ContentAnchor = { left: number; width: number }

/** 对齐主内容滚动区（#app-scroll-root）的水平范围，而非整页视口 */
function useAppScrollContentAnchor(enabled: boolean): ContentAnchor | null {
  const [anchor, setAnchor] = React.useState<ContentAnchor | null>(null)

  React.useEffect(() => {
    if (!enabled) {
      setAnchor(null)
      return
    }

    const root = getAppScrollRoot()
    if (!root) {
      setAnchor(null)
      return
    }

    const sync = () => {
      const rect = root.getBoundingClientRect()
      setAnchor({ left: rect.left, width: rect.width })
    }

    sync()
    const resizeObserver = new ResizeObserver(sync)
    resizeObserver.observe(root)
    window.addEventListener("resize", sync)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", sync)
    }
  }, [enabled])

  return anchor
}

export type TagBatchBarProps = {
  selectedIds: string[]
  /** 当前页可选 id；用于判断是否全选 */
  selectableIds: string[]
  /** 全部标签数；用于判断是否还有可用合并目标 */
  totalTagCount: number
  onSelectAll: () => void
  onClear: () => void
  onMerge: () => void
}

export function TagBatchBar({
  selectedIds,
  selectableIds,
  totalTagCount,
  onSelectAll,
  onClear,
  onMerge,
}: TagBatchBarProps) {
  const { t } = useTranslation("tags")
  const reduceMotion = useReducedMotion()
  const count = selectedIds.length
  const visible = count > 0
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedSet.has(id))
  const anchor = useAppScrollContentAnchor(visible)
  const overLimit = count > MAX_MERGE_SOURCES
  const hasTarget = totalTagCount > count
  const canMerge = count > 0 && !overLimit && hasTarget

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="tag-batch-bar"
          className="pointer-events-none fixed bottom-0 z-40 flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
          style={
            anchor
              ? { left: anchor.left, width: anchor.width }
              : { left: 0, right: 0 }
          }
          initial={reduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }}
          animate={reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }}
          transition={
            reduceMotion
              ? { duration: 0.15 }
              : { type: "spring", stiffness: 420, damping: 34, mass: 0.85 }
          }
        >
          <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-border/80 bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium text-foreground">
                {t("batch.selected", { count })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={selectableIds.length === 0}
                onClick={allSelected ? onClear : onSelectAll}
              >
                {allSelected ? t("batch.deselectAll") : t("batch.selectAll")}
              </Button>
              {!allSelected ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={onClear}
                >
                  {t("batch.clear")}
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={!canMerge}
                title={
                  overLimit
                    ? t("batch.overLimit", { max: MAX_MERGE_SOURCES })
                    : !hasTarget
                      ? t("mergeDialog.noTarget")
                      : undefined
                }
                onClick={onMerge}
              >
                <GitMergeIcon className="size-3.5" />
                {t("batch.merge")}
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
