import { createContext } from "react"

export type MessageSide = "start" | "end"

/** Message 把行方向下传给气泡，让 MessageBubble 默认跟随外层对齐 */
export const MessageSideContext = createContext<MessageSide | undefined>(
  undefined
)
