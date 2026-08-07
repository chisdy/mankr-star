import type { KbChatActivityItem } from "@mankr/shared"
import * as React from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { WarningIcon } from "@phosphor-icons/react"

import {
  AgentActivity,
  type AgentActivityItem,
} from "@workspace/ui/components/agents/agent-activity"
import { ThinkingShimmer } from "@workspace/ui/components/agents/loading-states/thinking-shimmer"
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
} from "@workspace/ui/components/agents/message"
import { StreamingResponse } from "@workspace/ui/components/agents/streaming-response"
import { TodoList } from "@workspace/ui/components/agents/todo-list"
import { KbAnswerText, toCitationItems } from "./kb-citations"
import type { KbMessage } from "./use-kb-chat"
import { useBookmarkDetail } from "@/hooks/use-bookmark-detail"

/**
 * 服务端只发 stage 与数量，措辞在这里本地化；未知 stage 回落到服务端 label。
 * 返回的对象结构与 AgentActivityItem 一致，可直接交给 AgentActivity。
 */
function localizeActivity(
  items: readonly KbChatActivityItem[],
  t: TFunction<"kb">
): AgentActivityItem[] {
  return items.map((item) => {
    if (item.type !== "step" || !item.stage) return item
    return {
      ...item,
      label: t(`activity.stage.${item.stage}.label`, {
        defaultValue: item.label,
      }),
      meta:
        item.count === undefined
          ? item.meta
          : t(`activity.stage.${item.stage}.meta`, {
              count: item.count,
              defaultValue: item.meta ?? "",
            }),
    }
  })
}

export function KbChatTurn({
  message,
  onRetry,
}: {
  message: KbMessage
  onRetry: () => void
}) {
  return message.role === "user" ? (
    <KbUserTurn content={message.content} />
  ) : (
    <KbAssistantTurn message={message} onRetry={onRetry} />
  )
}

function KbUserTurn({ content }: { content: string }) {
  const { t } = useTranslation("kb")

  return (
    <Message from="user" animateIn aria-label={t("a11y.userMessage")}>
      <MessageContent>
        <MessageBubble variant="soft" animateIn>
          <MessageBubbleContent className="whitespace-pre-wrap">
            {content}
          </MessageBubbleContent>
        </MessageBubble>
      </MessageContent>
    </Message>
  )
}

function KbAssistantTurn({
  message,
  onRetry,
}: {
  message: KbMessage
  onRetry: () => void
}) {
  const { t } = useTranslation("kb")
  const { openDetail } = useBookmarkDetail()
  const externalLabel = t("sources.openOriginal")
  const citations = React.useMemo(
    () =>
      toCitationItems(message.sources, {
        onOpenBookmark: openDetail,
        externalLabel,
      }),
    [message.sources, openDetail, externalLabel]
  )
  // 同一 transcript 里多条回答各有来源，prefix 必须带 message id 才不会撞 DOM id
  const idPrefix = `kb-src-${message.id}`
  const streaming = message.state === "streaming"
  const failedWeb = message.warnings?.includes("ANYSEARCH_FAILED")
  const running = message.state === "pending" || streaming
  const plan = message.plan ?? []
  const activity = message.activity ?? []
  const localizedActivity = React.useMemo(
    () => localizeActivity(activity, t),
    [activity, t]
  )

  return (
    <Message from="assistant" aria-label={t("a11y.assistantMessage")}>
      <MessageContent className="gap-2">
        {/*
          纯占位：一旦有了任务清单或检索步骤，进度就由 TodoList / AgentActivity
          自己表达，这里再显示一行就是两处进度提示打架。
        */}
        {message.state === "pending" &&
        plan.length === 0 &&
        activity.length === 0 ? (
          <ThinkingShimmer className="text-sm">
            {t("states.thinking")}
          </ThinkingShimmer>
        ) : null}

        {plan.length > 0 ? (
          <TodoList
            items={plan}
            title={t("plan.title")}
            sectionLabel={t("plan.title")}
            emptyLabel={t("plan.empty")}
            progressLabel={(done, total) =>
              t("plan.progress", { done, total })
            }
            statusLabels={{
              pending: t("plan.status.pending"),
              "in-progress": t("plan.status.in-progress"),
              completed: t("plan.status.completed"),
              cancelled: t("plan.status.cancelled"),
            }}
          />
        ) : null}

        {activity.length > 0 ? (
          <AgentActivity
            items={localizedActivity}
            status={running ? "working" : "complete"}
            activeLabel={t("activity.active")}
            summary={t("activity.summary", { count: activity.length })}
            moreResultsLabel={(count) => t("activity.more", { count })}
          />
        ) : null}

        {message.state === "empty" ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("states.empty")}
          </p>
        ) : null}

        {message.content ? (
          <StreamingResponse
            status={streaming ? "streaming" : "complete"}
            copyText={message.content}
            onRetry={streaming ? undefined : onRetry}
            sources={citations}
            sourceIdPrefix={idPrefix}
            // transcript 层已是唯一 live region，这里再播报会重复读
            announce={false}
            labels={{
              copy: t("actions.copy"),
              copied: t("actions.copied"),
              retry: t("actions.retry"),
              helpful: t("actions.helpful"),
              notHelpful: t("actions.notHelpful"),
              sources: t("sources.count", { count: citations.length }),
            }}
          >
            <KbAnswerText
              text={message.content}
              sources={message.sources}
              idPrefix={idPrefix}
              streaming={streaming}
            />
          </StreamingResponse>
        ) : null}

        {message.state === "aborted" ? (
          <p className="text-xs text-muted-foreground">{t("states.stopped")}</p>
        ) : null}

        {message.state === "error" ? (
          <KbTurnError
            code={message.errorCode}
            onRetry={onRetry}
            hasContent={Boolean(message.content)}
          />
        ) : null}

        {failedWeb ? (
          <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
            <WarningIcon className="size-3.5 shrink-0" />
            {t("states.webUnavailable")}
          </p>
        ) : null}
      </MessageContent>
    </Message>
  )
}

function KbTurnError({
  code,
  onRetry,
  hasContent,
}: {
  code?: string
  onRetry: () => void
  hasContent: boolean
}) {
  const { t } = useTranslation("kb")

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs text-destructive">
        {t(`errors.${code ?? "UNKNOWN"}`, {
          defaultValue: t("errors.UNKNOWN"),
        })}
      </p>
      {/* 有正文时重试入口已在 StreamingResponse 的操作条里 */}
      {hasContent ? null : (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground underline underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("actions.retry")}
        </button>
      )}
    </div>
  )
}
