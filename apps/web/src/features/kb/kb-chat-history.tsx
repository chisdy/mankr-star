import {
  ClockCounterClockwiseIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

export function KbChatHistory({
  currentId,
  onOpenConversation,
  onCurrentDeleted,
}: {
  currentId: string | null
  onOpenConversation: (id: string) => void
  onCurrentDeleted: () => void
}) {
  const { t, i18n } = useTranslation("kb")
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)

  const {
    data: items,
    isPending,
    isError,
  } = useQuery({
    queryKey: queryKeys.kb.conversations,
    queryFn: () => api.getKbConversations(),
    // 需要知道有没有历史才能决定是否渲染按钮；会话存档后会 invalidate 刷新
    staleTime: 30_000,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteKbConversation(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.kb.conversations,
      })
      if (id === currentId) onCurrentDeleted()
    },
  })

  const clearAll = useMutation({
    mutationFn: () => api.clearKbConversations(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.kb.conversations,
      })
      onCurrentDeleted()
      setOpen(false)
    },
  })

  const formatTime = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString(i18n.language, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const hasHistory = (items?.length ?? 0) > 0
  // 空历史不占位；加载失败仍展示，方便打开看错误提示
  if (!hasHistory && !isError) return null

  return (
    <TooltipProvider delay={200}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t("history.title")}
                  >
                    <ClockCounterClockwiseIcon className="size-4" />
                  </Button>
                }
              />
            }
          />
          <TooltipContent side="bottom">{t("history.title")}</TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          className="w-80 gap-2 p-2"
          aria-label={t("history.title")}
        >
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t("history.title")}
            </span>
            {items && items.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                disabled={clearAll.isPending}
                onClick={() => clearAll.mutate()}
              >
                {t("history.clearAll")}
              </Button>
            ) : null}
          </div>

          {isPending ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {t("history.loading")}
            </p>
          ) : isError ? (
            // 读取失败与「一条都没有」是两回事，混在一起会把后端故障伪装成空列表
            <p className="flex items-center justify-center gap-1 px-1 py-6 text-center text-xs text-destructive">
              <WarningIcon className="size-3.5 shrink-0" />
              {t("history.loadFailed")}
            </p>
          ) : !items || items.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {t("history.empty")}
            </p>
          ) : (
            <ul className="max-h-80 space-y-0.5 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id} className="group/item relative">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenConversation(item.id)
                      setOpen(false)
                    }}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 rounded-md py-1.5 pr-8 pl-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                      item.id === currentId && "bg-muted"
                    )}
                  >
                    <span className="line-clamp-1 w-full text-xs font-medium text-foreground">
                      {item.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {t("history.messageCount", {
                        count: item.message_count,
                      })}
                      {" · "}
                      {formatTime(item.updated_at)}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("history.delete")}
                    disabled={remove.isPending && remove.variables === item.id}
                    onClick={() => remove.mutate(item.id)}
                    className="absolute top-1.5 right-1 size-6 text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {remove.isError || clearAll.isError ? (
            <p className="flex items-center gap-1 px-1 text-[11px] text-destructive">
              <WarningIcon className="size-3" />
              {t("history.deleteFailed")}
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  )
}
