import * as React from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { CaretRightIcon, PlusIcon, SparkleIcon } from "@phosphor-icons/react"

import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { KbChatComposer } from "./kb-chat-composer"
import { useKbChatContext } from "./kb-chat-context"
import { KbChatHistory } from "./kb-chat-history"
import { KbChatTranscript } from "./kb-chat-transcript"
import { KbChatWelcome } from "./kb-chat-welcome"

export function KbChatBody({
  className,
  /** 只有移动端全屏 Sheet 需要：那里顶栏被完全遮住，没有别的关闭入口 */
  onCollapse,
}: {
  className?: string
  onCollapse?: () => void
}) {
  const { t } = useTranslation("kb")
  const navigate = useNavigate()
  const { user } = useAuth()

  const anysearchConfigured = Boolean(user?.anysearch_configured)
  const deepseekConfigured = Boolean(user?.deepseek_configured)

  const chat = useKbChatContext()
  const [input, setInput] = React.useState("")

  const { data: library } = useQuery({
    queryKey: queryKeys.bookmarks.list({ limit: 1 }),
    queryFn: () => api.getBookmarks({ limit: 1 }),
    enabled: deepseekConfigured,
    staleTime: 60_000,
  })
  const libraryEmpty = library?.total === 0

  const submit = (value: string) => {
    if (chat.isBusy) return
    chat.send(value)
    setInput("")
  }

  const openConversation = (id: string) => {
    void chat.openConversation(id).catch(() => {
      toast.error(t("history.openFailed"))
    })
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <span className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-muted-foreground">
          <SparkleIcon className="size-4 shrink-0" weight="duotone" />
          {t("title")}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {deepseekConfigured ? (
            <>
              <KbChatHistory
                currentId={chat.conversationId}
                onOpenConversation={openConversation}
                onCurrentDeleted={chat.startNew}
              />
              <TooltipProvider delay={200}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      // disabled 按钮不接收悬停，用 span 包住才能显示 tooltip
                      <span className="inline-flex">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="size-7 text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={chat.startNew}
                          disabled={!chat.conversationId}
                          aria-label={t("actions.newChat")}
                        >
                          <PlusIcon className="size-4" weight="bold" />
                        </Button>
                      </span>
                    }
                  />
                  <TooltipContent side="bottom">
                    {t("actions.newChat")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          ) : null}
          {onCollapse ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-7 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onCollapse}
              aria-label={t("actions.collapse")}
              title={t("actions.collapse")}
            >
              <CaretRightIcon className="size-4" weight="bold" />
            </Button>
          ) : null}
        </div>
      </div>

      {!deepseekConfigured ? (
        <GateNotice
          message={t("gate.deepseek")}
          actionLabel={t("gate.goSettings")}
          onAction={() => navigate("/settings")}
        />
      ) : (
        <>
          <KbChatTranscript
            messages={chat.messages}
            busy={chat.isBusy}
            onRetry={chat.retry}
            emptyState={
              <KbChatWelcome
                onPick={setInput}
                libraryEmpty={Boolean(libraryEmpty)}
                webSearch={chat.webSearch}
              />
            }
          />

          <KbChatComposer
            value={input}
            onValueChange={setInput}
            onSubmit={submit}
            busy={chat.isBusy}
            onStop={chat.stop}
            model={chat.model}
            onModelChange={chat.setModel}
            webSearch={chat.webSearch}
            onWebSearchChange={chat.setWebSearch}
            anysearchConfigured={anysearchConfigured}
            onGoSettings={() => navigate("/settings")}
          />
        </>
      )}
    </div>
  )
}

function GateNotice({
  message,
  actionLabel,
  onAction,
}: {
  message: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
      <Button
        size="sm"
        variant="outline"
        className="text-xs"
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </div>
  )
}
