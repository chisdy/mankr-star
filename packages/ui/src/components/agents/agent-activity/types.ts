import type { ReactNode } from "react"

export type AgentActivityStatus = "working" | "complete"
export type AgentStepStatus = "pending" | "active" | "complete"

export interface AgentActivityStep {
  id: string
  type: "step"
  label: ReactNode
  status?: AgentStepStatus
  meta?: ReactNode
}

export interface AgentActivityText {
  id: string
  type: "text"
  content: ReactNode
}

export interface AgentSearchResult {
  id: string
  title: ReactNode
  domain?: ReactNode
  url?: string
  icon?: ReactNode
}

export interface AgentActivitySearch {
  id: string
  type: "search"
  query: ReactNode
  results?: AgentSearchResult[]
  moreCount?: number
}

export interface AgentActivityTool {
  id: string
  type: "tool"
  action: "read" | "edit" | "run" | (string & {})
  target: ReactNode
  additions?: number
  deletions?: number
}

export type AgentTraceKind =
  | "thinking"
  | "message"
  | "write"
  | "run"
  | "read"
  | (string & {})

export interface AgentActivityTrace {
  id: string
  type: "trace"
  kind: AgentTraceKind
  label: ReactNode
  detail?: ReactNode
  icon?: ReactNode
}

export type AgentActivityItem =
  | AgentActivityStep
  | AgentActivityText
  | AgentActivitySearch
  | AgentActivityTool
  | AgentActivityTrace

export type AgentActivityContentType = AgentActivityItem["type"] | "mixed"

export interface AgentActivityProps {
  /** 按时间顺序的活动条目，随事件流追加或原地更新 */
  items: AgentActivityItem[]
  /** 首个条目到达前预期的活动类型 */
  contentType?: AgentActivityContentType
  /** 当前运行阶段。working 时恒为展开 */
  status?: AgentActivityStatus
  /** 已用时长（秒），仅 step 汇总文案会用到 */
  duration?: number
  /** 运行结束后的受控展开状态 */
  open?: boolean
  /** 运行结束后的初始展开状态 */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** status 由 working 变 complete 时自动收起 */
  collapseOnComplete?: boolean
  /** 运行中显示的文案 */
  activeLabel?: ReactNode
  /** 完成后的汇总文案，缺省时按条目类型推导（英文） */
  summary?: ReactNode
  /** 流式滑动开始前的最大可见高度 */
  maxHeight?: number
  /** 搜索结果里「+N more」的文案，缺省为英文 */
  moreResultsLabel?: (count: number) => ReactNode
  className?: string
  contentClassName?: string
}
