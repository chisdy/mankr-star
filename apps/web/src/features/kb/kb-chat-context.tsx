import * as React from "react"

import { useAuth } from "@/hooks/use-auth"
import { useKbChat } from "./use-kb-chat"

type KbChatContextValue = ReturnType<typeof useKbChat>

const KbChatContext = React.createContext<KbChatContextValue | null>(null)

/**
 * 会话状态挂在壳层，面板折叠 / 移动端 Sheet 关闭都不会丢失消息，
 * 也不会中断进行中的流式生成。
 */
export function KbChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const chat = useKbChat({
    anysearchConfigured: Boolean(user?.anysearch_configured),
  })

  return <KbChatContext value={chat}>{children}</KbChatContext>
}

export function useKbChatContext(): KbChatContextValue {
  const ctx = React.useContext(KbChatContext)
  if (!ctx) {
    throw new Error("useKbChatContext 必须在 KbChatProvider 内使用")
  }
  return ctx
}
