import * as React from "react"
import { useTranslation } from "react-i18next"
import { ArrowDownIcon } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "framer-motion"

import {
  MessageGroup,
  MessageScroller,
} from "@workspace/ui/components/agents/message"
import { Button } from "@workspace/ui/components/button"
import { KbChatTurn } from "./kb-chat-turn"
import type { KbMessage } from "./use-kb-chat"

export function KbChatTranscript({
  messages,
  busy,
  onRetry,
  emptyState,
}: {
  messages: KbMessage[]
  busy: boolean
  onRetry: () => void
  emptyState: React.ReactNode
}) {
  const { t } = useTranslation("kb")
  const viewportRef = React.useRef<HTMLElement | null>(null)
  const [following, setFollowing] = React.useState(true)

  const scrollToLatest = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
    setFollowing(true)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <MessageScroller
        className="h-full"
        label={t("title")}
        busy={busy}
        onFollowChange={setFollowing}
        viewportRef={viewportRef}
        viewportClassName="px-4 py-2"
        contentClassName="flex flex-col gap-4"
      >
        {messages.length === 0 ? (
          emptyState
        ) : (
          <MessageGroup spacing="default">
            {messages.map((message) => (
              <KbChatTurn
                key={message.id}
                message={message}
                onRetry={onRetry}
              />
            ))}
          </MessageGroup>
        )}
      </MessageScroller>

      <AnimatePresence>
        {!following && messages.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
          >
            <Button
              type="button"
              size="xs"
              variant="secondary"
              className="pointer-events-auto gap-1 rounded-full shadow-sm"
              onClick={scrollToLatest}
            >
              <ArrowDownIcon className="size-3" weight="bold" />
              {t("actions.scrollToLatest")}
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
