import * as React from "react"
import { createPortal } from "react-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { useTranslation } from "react-i18next"
import {
  ArchiveIcon,
  CaretUpIcon,
  CurrencyCircleDollarIcon,
  SealCheckIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"
import type { BookmarkPricing } from "@mankr/shared"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import { getAppScrollRoot } from "@/lib/scroll-root"

type BatchAction =
  | { type: "archive" }
  | { type: "unarchive" }
  | { type: "delete" }
  | { type: "setFeatured"; featured: boolean }
  | { type: "setPricing"; pricing: BookmarkPricing | null }
  | { type: "regenerateAi" }

const PRICING_OPTIONS: Array<BookmarkPricing | null> = [
  "free",
  "freemium",
  "paid",
  null,
]

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

export type BookmarkBatchBarProps = {
  selectedIds: string[]
  /** 当前列表中可选的全部 id（已加载项）；用于判断是否全选 */
  selectableIds: string[]
  onSelectAll: () => void
  onClear: () => void
}

export function BookmarkBatchBar({
  selectedIds,
  selectableIds,
  onSelectAll,
  onClear,
}: BookmarkBatchBarProps) {
  const { t } = useTranslation(["bookmarks", "common", "errors"])
  const queryClient = useQueryClient()
  const reduceMotion = useReducedMotion()
  const count = selectedIds.length
  const visible = count > 0
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedSet.has(id))
  const anchor = useAppScrollContentAnchor(visible)

  const mutation = useMutation({
    mutationFn: (action: BatchAction) => api.batchBookmarks(selectedIds, action),
    onSuccess: (result, action) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.insights.all })
      if (result.failed.length > 0) {
        toast.error(
          t("batch.partialToast", {
            processed: result.processed,
            failed: result.failed.length,
          }),
        )
      } else {
        toast.success(
          t(`batch.success.${action.type}` as const, {
            count: result.processed,
          }),
        )
      }
      onClear()
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("batch.errorToast"))
    },
  })

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="bookmark-batch-bar"
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
                disabled={mutation.isPending || selectableIds.length === 0}
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
                  disabled={mutation.isPending}
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
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ type: "archive" })}
              >
                <ArchiveIcon className="size-3.5" />
                {t("batch.archive")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({ type: "setFeatured", featured: true })
                }
              >
                <SealCheckIcon className="size-3.5" weight="fill" />
                {t("batch.feature")}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      disabled={mutation.isPending}
                    />
                  }
                >
                  <CurrencyCircleDollarIcon className="size-3.5" />
                  {t("batch.pricing")}
                  <CaretUpIcon className="size-3 opacity-60" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top" sideOffset={8}>
                  {PRICING_OPTIONS.map((value) => (
                    <DropdownMenuItem
                      key={value ?? "unset"}
                      onClick={() =>
                        mutation.mutate({ type: "setPricing", pricing: value })
                      }
                    >
                      {value == null
                        ? t("detail.pricingUnset")
                        : t(`pricing.${value}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ type: "regenerateAi" })}
              >
                {t("batch.regenerateAi")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-8 gap-1.5 text-xs"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ type: "delete" })}
              >
                <TrashIcon className="size-3.5" />
                {t("batch.delete")}
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
