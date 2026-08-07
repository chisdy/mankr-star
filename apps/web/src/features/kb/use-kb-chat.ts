import {
  DEFAULT_DEEPSEEK_MODEL,
  findKbChatModel,
  type KbChatModelId,
  type KbChatSource,
  type KbStoredMessage,
  type KbTurnState,
} from "@mankr/shared"
import { useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { api, ApiError } from "@/lib/api"
import { buildKbChatPayload, streamKbChat } from "@/lib/kb-chat"
import { queryKeys } from "@/lib/query-keys"

export type { KbTurnState }

/**
 * 面板里的一条消息。与存档结构同构（直接复用 KbStoredMessage），
 * 这样加载历史与回写都不需要字段映射。
 */
export type KbMessage = KbStoredMessage

function sourceDedupeKey(source: KbChatSource): string {
  return source.type === "bookmark" && source.id
    ? `bookmark:${source.id}`
    : `web:${source.url}`
}

/**
 * 循环路径下来源是逐轮累积出来的，必须追加而不是覆盖，
 * 否则第二轮的 sources_append 会把第一轮的来源冲掉、正文里的 [#n] 全指错。
 */
function mergeSources(
  prev: KbChatSource[] | undefined,
  next: readonly KbChatSource[]
): KbChatSource[] {
  const merged = [...(prev ?? [])]
  const seen = new Set(merged.map(sourceDedupeKey))
  for (const source of next) {
    const key = sourceDedupeKey(source)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(source)
  }
  return merged
}

/**
 * 收束进行中的过程状态。中止或失败后若不做这一步，
 * TodoList 的转圈图标与 activity 的 shimmer 会永久停在运行中。
 */
function settleProgress(
  message: KbMessage,
  unfinished: "completed" | "cancelled"
): KbMessage {
  return {
    ...message,
    plan: message.plan?.map((item) =>
      item.status === "completed" || item.status === "cancelled"
        ? item
        : { ...item, status: unfinished }
    ),
    activity: message.activity?.map((item) =>
      item.type === "step" && item.status === "active"
        ? { ...item, status: "complete" as const }
        : item
    ),
  }
}

export type KbChatStatus = "idle" | "sending" | "streaming"

const WEB_SEARCH_KEY = "mankr_kb_web_search"
const MODEL_KEY = "mankr_kb_chat_model"
const CONVERSATION_KEY = "mankr_kb_conversation_id"

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(key)
}

function writeStored(key: string, value: string | null): void {
  if (typeof window === "undefined") return
  if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, value)
}

function readStoredWebSearch(): boolean {
  return readStored(WEB_SEARCH_KEY) === "true"
}

/**
 * 存量值必须过白名单：模型下线后浏览器里的旧 id 会让每一轮请求都被
 * kbChatRequestSchema 判成 VALIDATION_ERROR，用户无法自愈。
 */
function readStoredModel(): KbChatModelId {
  return findKbChatModel(readStored(MODEL_KEY))?.model ?? DEFAULT_DEEPSEEK_MODEL
}

/**
 * 已落库内容的指纹。会话在每轮收尾时整体回写，
 * 没有它，加载历史与重复渲染都会触发一次无意义的 PUT。
 */
function signature(id: string, messages: readonly KbMessage[]): string {
  const last = messages.at(-1)
  return [
    id,
    messages.length,
    last?.id ?? "",
    last?.state ?? "",
    last?.content.length ?? 0,
  ].join("|")
}

/**
 * 收藏库对话状态机：Idle → Sending → Streaming → Done / Empty / Error / Aborted。
 * 会话落 D1：每轮收尾整体回写一次，提问在发出时先写一次，
 * 这样生成中途刷新页面至少保留提问，可以直接重试。
 */
export function useKbChat(options: { anysearchConfigured: boolean }) {
  const { anysearchConfigured } = options
  const queryClient = useQueryClient()

  const [messages, setMessages] = React.useState<KbMessage[]>([])
  const [status, setStatus] = React.useState<KbChatStatus>("idle")
  /**
   * 恢复完成前恒为 null。若一开始就填上 localStorage 里的 id，
   * 在恢复请求返回之前提问会把那条旧会话整体覆盖成只剩新提问。
   */
  const [conversationId, setConversationId] = React.useState<string | null>(null)
  const [wantsWebSearch, setWantsWebSearch] = React.useState(readStoredWebSearch)
  const [model, setModelState] = React.useState<KbChatModelId>(readStoredModel)

  const abortRef = React.useRef<AbortController | null>(null)
  const persistedRef = React.useRef<string>("")
  /** 每次切换当前会话都自增，用于丢弃已经过期的加载结果 */
  const loadTokenRef = React.useRef(0)
  /**
   * 滚动摘要覆盖到的最后一条消息 id，只用来省下一轮请求的上传量
   * （服务端会拿同一个 id 自行对齐，这里过期不影响正确性）。
   *
   * 用 ref 而不是 state：它只在发请求时读，不参与渲染，
   * 而且必须在同一轮里立刻生效（state 要等下次渲染才更新）。
   */
  const coversRef = React.useRef<string | null>(null)

  // 设置页清除 Key 后强制回落到关闭，避免带 webSearch:true 打到 400
  const webSearch = wantsWebSearch && anysearchConfigured

  const setWebSearch = React.useCallback((next: boolean) => {
    writeStored(WEB_SEARCH_KEY, String(next))
    setWantsWebSearch(next)
  }, [])

  const setModel = React.useCallback((next: string) => {
    const resolved = findKbChatModel(next)?.model
    if (!resolved) return
    writeStored(MODEL_KEY, resolved)
    setModelState(resolved)
  }, [])

  React.useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  /** 存档失败不该打断对话：只记日志，界面照常 */
  const persist = React.useCallback(
    (id: string, next: readonly KbMessage[]) => {
      if (next.length === 0) return
      persistedRef.current = signature(id, next)
      void api
        .saveKbConversation(id, [...next])
        .then((saved) => {
          // 存档响应顺带回传摘要水位：压缩在后台跑，流里没法通告
          coversRef.current = saved.summary_covers_through_id
          void queryClient.invalidateQueries({
            queryKey: queryKeys.kb.conversations,
          })
        })
        .catch((err) => {
          console.error("[kb] 会话存档失败", err)
          // 让下一次收尾重试同一份内容
          persistedRef.current = ""
        })
    },
    [queryClient]
  )

  // 每轮收尾（done / empty / error / aborted）整体回写一次
  React.useEffect(() => {
    if (status !== "idle" || !conversationId || messages.length === 0) return
    if (persistedRef.current === signature(conversationId, messages)) return
    persist(conversationId, messages)
  }, [conversationId, messages, persist, status])

  const run = React.useCallback(
    async (
      history: KbMessage[],
      useWeb: boolean,
      useModel: KbChatModelId,
      convId: string
    ) => {
      const assistantId = crypto.randomUUID()
      setMessages([
        ...history,
        { id: assistantId, role: "assistant", content: "", state: "pending" },
      ])
      setStatus("sending")

      const controller = new AbortController()
      abortRef.current = controller

      const patch = (updater: (prev: KbMessage) => KbMessage) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? updater(m) : m)),
        )
      }

      const payload = buildKbChatPayload(history, coversRef.current)

      try {
        await streamKbChat(
          {
            messages: payload,
            webSearch: useWeb,
            model: useModel,
            conversationId: convId,
          },
          {
            onMeta: (sources, warnings) => {
              patch((m) => ({ ...m, sources, warnings }))
            },
            onSourcesAppend: (sources) => {
              patch((m) => ({ ...m, sources: mergeSources(m.sources, sources) }))
            },
            onPlan: (items) => {
              patch((m) => ({ ...m, plan: items }))
            },
            onPlanUpdate: (id, planStatus) => {
              patch((m) => ({
                ...m,
                plan: m.plan?.map((item) =>
                  item.id === id ? { ...item, status: planStatus } : item
                ),
              }))
            },
            onActivity: (item) => {
              patch((m) => {
                const activity = m.activity ?? []
                const at = activity.findIndex((prev) => prev.id === item.id)
                if (at < 0) return { ...m, activity: [...activity, item] }
                const next = [...activity]
                next[at] = item
                return { ...m, activity: next }
              })
            },
            onDelta: (text) => {
              setStatus("streaming")
              patch((m) => ({
                ...m,
                content: m.content + text,
                state: "streaming",
              }))
            },
            onEmpty: () => {
              patch((m) => ({ ...m, state: "empty" }))
            },
          },
          controller.signal,
        )
        patch((m) =>
          m.state === "empty" ? m : { ...settleProgress(m, "completed"), state: "done" },
        )
      } catch (err) {
        if (controller.signal.aborted) {
          // 已产出的内容保留，标记为用户主动停止
          patch((m) => ({
            ...settleProgress(m, "cancelled"),
            state: m.content ? "aborted" : "error",
            ...(m.content ? {} : { errorCode: "ABORTED" }),
          }))
        } else {
          patch((m) => ({
            ...settleProgress(m, "cancelled"),
            state: "error",
            errorCode:
              err instanceof ApiError ? (err.code ?? "UNKNOWN") : "UNKNOWN",
          }))
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setStatus("idle")
      }
    },
    [],
  )

  /**
   * 首轮提问才需要开会话；id 由客户端生成，首次 PUT 即建库。
   * 必须同步返回 id：setConversationId 要等下次渲染才生效，
   * 而紧随其后的 run 就要把 id 发给服务端去读写滚动摘要，
   * 读 state 会让首轮永远发不出 conversationId。
   */
  const ensureConversation = React.useCallback(
    (history: KbMessage[]): string => {
      const id = conversationId ?? crypto.randomUUID()
      if (!conversationId) {
        // 提问即接管当前会话，作废仍在路上的恢复／切换请求
        loadTokenRef.current += 1
        coversRef.current = null
        setConversationId(id)
        writeStored(CONVERSATION_KEY, id)
      }
      // 提问先落库：生成期间刷新页面也还能看到问题并重试
      persist(id, history)
      return id
    },
    [conversationId, persist]
  )

  const send = React.useCallback(
    (text: string) => {
      const content = text.trim()
      if (!content || status !== "idle") return
      const history: KbMessage[] = [
        ...messages.filter((m) => m.state !== "error"),
        { id: crypto.randomUUID(), role: "user", content },
      ]
      const id = ensureConversation(history)
      void run(history, webSearch, model, id)
    },
    [ensureConversation, messages, model, run, status, webSearch],
  )

  const retry = React.useCallback(() => {
    if (status !== "idle") return
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUser) return
    const upToUser = messages.slice(0, messages.indexOf(lastUser) + 1)
    const id = ensureConversation(upToUser)
    void run(upToUser, webSearch, model, id)
  }, [ensureConversation, messages, model, run, status, webSearch])

  const stop = React.useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /** 开新一轮：只切走当前会话，已存档的历史保持不动 */
  const startNew = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    loadTokenRef.current += 1
    persistedRef.current = ""
    coversRef.current = null
    setConversationId(null)
    writeStored(CONVERSATION_KEY, null)
    setMessages([])
    setStatus("idle")
  }, [])

  const openConversation = React.useCallback(async (id: string) => {
    abortRef.current?.abort()
    abortRef.current = null
    loadTokenRef.current += 1
    const token = loadTokenRef.current
    const detail = await api.getKbConversation(id)
    // 期间用户又提问或切了别的会话，这份结果已经过期
    if (loadTokenRef.current !== token) return
    setConversationId(id)
    writeStored(CONVERSATION_KEY, id)
    setMessages(detail.messages)
    // 摘要水位的权威值在服务端，切会话时一律以库里的为准
    coversRef.current = detail.summary_covers_through_id
    // 刚从库里读出来的内容不需要再写回去
    persistedRef.current = signature(id, detail.messages)
    setStatus("idle")
  }, [])

  // 刷新后恢复上次打开的会话；已被删除或读不出来就当作新对话
  React.useEffect(() => {
    const stored = readStored(CONVERSATION_KEY)
    if (!stored) return
    void openConversation(stored).catch(() => {
      // 期间已经开了新会话就别动，那条 id 是有效的
      if (readStored(CONVERSATION_KEY) === stored) {
        writeStored(CONVERSATION_KEY, null)
      }
    })
  }, [openConversation])

  return {
    messages,
    status,
    isBusy: status !== "idle",
    conversationId,
    webSearch,
    wantsWebSearch,
    setWebSearch,
    model,
    setModel,
    send,
    retry,
    stop,
    startNew,
    openConversation,
  }
}
