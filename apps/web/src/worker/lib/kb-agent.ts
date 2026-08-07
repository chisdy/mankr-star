import type { Db } from "@mankr/db"
import {
  ANYSEARCH_MAX_RESULTS,
  KB_AGENT_MAX_TOOL_ROUNDS,
  KB_AGENT_MAX_TOTAL_TOKENS,
  KB_AGENT_TIME_BUDGET_MS,
  KB_AGENT_TOOL_RESULT_MAX_CHARS,
  KB_CHAT_TOP_K,
  type KbChatActivityItem,
  type KbChatMessage,
  type KbChatPlanItem,
  type KbChatSource,
  type KbChatStreamEvent,
  type KbChatWarning,
} from "@mankr/shared"
import { searchWeb } from "./anysearch"
import {
  callDeepSeekJson,
  streamDeepSeekChat,
  type DeepSeekChatMessage,
  type DeepSeekToolCall,
} from "./deepseek"
import {
  addLlmUsage,
  emptyLlmUsage,
  hasLlmUsage,
  type LlmTokenUsage,
} from "./llm-provider"
import {
  EMPTY_FOLDER_DIGEST,
  formatFolderDigest,
  loadFolderDigest,
} from "./kb-folders"
import { buildLoopMessages, buildMessages } from "./kb-prompts"
import { searchBookmarks, truncate, type KbBookmarkHit } from "./kb-search"
import {
  createKbSourceRegistry,
  createKbToolkit,
  registerFastPathSources,
  type KbSourceRegistry,
} from "./kb-tools"

/** 工具连续失败到这个次数就停止取资料，直接用已有资料收尾 */
const MAX_CONSECUTIVE_TOOL_FAILURES = 2

export type KbAgentInput = {
  db: Db
  /** 已按 KB_CHAT_QUERY_MAX_CHARS 截断的本轮提问 */
  query: string
  /** 送进模型的历史尾部；已滑出近窗的旧轮次由 contextSummary 代表 */
  messages: KbChatMessage[]
  /** 滚动摘要文本，没有压缩过时为空串 */
  contextSummary?: string
  apiKey: string
  model: string
  /** 该模型是否支持 function calling；不支持时只走快路径 */
  supportsTools: boolean
  anysearchKey: string | null
  signal?: AbortSignal
  /** 时间预算基准，与路由的 latency 统计共用同一个起点 */
  startedAt?: number
}

/** 一轮对话的聚合结果，供路由写唯一一条 kb_chat 用量日志 */
export type KbAgentResult = {
  status: "ok" | "error"
  errorCode: string | null
  usage: LlmTokenUsage | undefined
  /** 实际生成回答用的模型 */
  model: string
}

/** 首轮并行检索的产出，路由用它决定是否直接返回 empty */
export type KbPrefetch = {
  hits: KbBookmarkHit[]
  web: Array<{ title: string; url: string; snippet: string }>
  warnings: KbChatWarning[]
  /** 分类目录的 prompt 文本，库里没有分类时为空串 */
  folderDigest: string
  /** 这轮在问库结构本身（分类怎么组织、归类是否合理） */
  structural: boolean
}

/** 结构类提问：检索无命中也答得出来，因为分类目录本身就是答案 */
const STRUCTURE_HINTS = /分类|归类|文件夹|目录|标签|整理|结构|folder|categor|tag/i

/**
 * 首轮检索。放在 agent 外面是因为路由要先看命中情况：
 * 两路皆空时整轮不消耗生成额度，只发 meta + empty。
 */
export async function prefetchKbContext(input: {
  db: Db
  query: string
  anysearchKey: string | null
  signal?: AbortSignal
}): Promise<KbPrefetch> {
  const warnings: KbChatWarning[] = []
  // 本地检索、分类目录与联网检索并行，降低首包延迟
  const [hits, digest, web] = await Promise.all([
    searchBookmarks(input.db, input.query, KB_CHAT_TOP_K).catch((err) => {
      console.error("[kb] bookmark search failed", err)
      return [] as KbBookmarkHit[]
    }),
    loadFolderDigest(input.db).catch((err) => {
      console.error("[kb] folder digest failed", err)
      return EMPTY_FOLDER_DIGEST
    }),
    input.anysearchKey
      ? // 出站仅本轮提问文本，不含笔记/账号等隐私字段
        searchWeb(input.anysearchKey, input.query, {
          maxResults: ANYSEARCH_MAX_RESULTS,
          signal: input.signal,
        }).catch((err) => {
          console.error("[kb] anysearch failed", err)
          warnings.push("ANYSEARCH_FAILED")
          return [] as Array<{ title: string; url: string; snippet: string }>
        })
      : Promise.resolve([] as Array<{ title: string; url: string; snippet: string }>),
  ])

  const folderDigest = formatFolderDigest(digest)
  return {
    hits,
    web,
    warnings,
    folderDigest,
    structural: Boolean(folderDigest) && STRUCTURE_HINTS.test(input.query),
  }
}

/**
 * 首轮资料的上下文与引用编号。编号表由路由建一次并传进 agent，
 * 循环路径新增的来源接着已分配的最大编号往后发，编号绝不在轮次之间重排。
 */
export type KbAgentContext = {
  registry: KbSourceRegistry
  sources: KbChatSource[]
  bookmarkContext: string
  webContext: string
}

export function createKbAgentContext(prefetch: KbPrefetch): KbAgentContext {
  const registry = createKbSourceRegistry()
  const { bookmarkContext, webContext } = registerFastPathSources(
    registry,
    prefetch.hits,
    prefetch.web,
  )
  return { registry, sources: registry.sources, bookmarkContext, webContext }
}

/**
 * 混合 agent：简单问题用首轮检索直接生成，复杂问题进 function calling 循环。
 * 产出 KbChatStreamEvent 供路由写进 SSE，返回值是整轮聚合后的用量。
 *
 * meta 不在这里发 —— 路由已用 context.sources 发过首个 meta，
 * 循环路径新增的来源一律走 sources_append。
 */
export async function* runKbAgent(
  input: KbAgentInput,
  prefetch: KbPrefetch,
  context: KbAgentContext,
): AsyncGenerator<KbChatStreamEvent, KbAgentResult> {
  const startedAt = input.startedAt ?? Date.now()
  const deadline = startedAt + KB_AGENT_TIME_BUDGET_MS
  const usage = emptyLlmUsage()
  // 时间与 token 预算是硬约束（Workers 超时表现为流被掐断），
  // 判定只在这里写一次，循环内复用同一个闭包
  const exhausted = () =>
    Date.now() >= deadline || usage.total_tokens >= KB_AGENT_MAX_TOTAL_TOKENS

  yield* prefetchActivity(prefetch, Boolean(input.anysearchKey))

  const complex =
    input.supportsTools &&
    !exhausted() &&
    mayNeedTools(input.query) &&
    (await isComplex(input, usage))

  if (!complex) {
    return yield* generate({
      input,
      usage,
      messages: buildMessages({
        messages: input.messages,
        contextSummary: input.contextSummary ?? "",
        folderDigest: prefetch.folderDigest,
        bookmarkContext: context.bookmarkContext,
        webContext: context.webContext,
      }),
    })
  }

  return yield* runLoop(input, prefetch, context, usage, exhausted)
}

/** 首轮检索已经发生，如实补两条 activity，让面板有可解释的过程 */
function* prefetchActivity(
  prefetch: KbPrefetch,
  webEnabled: boolean,
): Generator<KbChatStreamEvent> {
  yield {
    type: "activity",
    item: {
      id: "prefetch-bookmarks",
      type: "step",
      status: "complete",
      label: "search_bookmarks",
      stage: "search_bookmarks",
      count: prefetch.hits.length,
    },
  }
  if (webEnabled) {
    yield {
      type: "activity",
      item: {
        id: "prefetch-web",
        type: "step",
        status: "complete",
        label: "search_web",
        stage: "search_web",
        count: prefetch.web.length,
      },
    }
  }
}

/** 多步意图的表层信号，命中任一才值得为路由多付一次调用 */
const COMPLEX_HINTS =
  /对比|比较|区别|分别|哪个更|哪些更|优缺点|各自|汇总|整理成|梳理|逐个|逐条|先.{0,6}再|然后|以及|\bvs\b|\bversus\b|compare|difference/i
const COMPLEX_MIN_CHARS = 24

/**
 * 路由前的零成本粗筛。绝大多数提问是「有哪些 X 相关收藏」这类单步问题，
 * 为它们再打一次判定调用只会白加一个 round trip 与一份 token。
 */
function mayNeedTools(query: string): boolean {
  return query.length >= COMPLEX_MIN_CHARS || COMPLEX_HINTS.test(query)
}

/**
 * 一次低成本 JSON 判定：单轮检索是否够用。
 * 任何异常都当成 simple —— 路由判定失败绝不能拖垮整轮对话。
 */
async function isComplex(
  input: KbAgentInput,
  usage: LlmTokenUsage,
): Promise<boolean> {
  try {
    const { content, usage: routeUsage } = await callDeepSeekJson({
      apiKey: input.apiKey,
      model: input.model,
      maxTokens: 32,
      signal: input.signal,
      messages: [
        {
          role: "system",
          content: [
            "判断用户的问题是否需要多步检索才能回答。",
            "simple：一次关键词检索就够，例如「有哪些 react 相关收藏」「总结一下这些资料」。",
            "complex：需要对比、跨主题汇总、按条件筛选后再深挖，或要先查一批再逐条细看。",
            '只输出 JSON：{"mode":"simple"} 或 {"mode":"complex"}。',
          ].join("\n"),
        },
        { role: "user", content: input.query },
      ],
    })
    addLlmUsage(usage, routeUsage)
    const parsed = JSON.parse(content) as { mode?: unknown }
    return parsed.mode === "complex"
  } catch (err) {
    console.error("[kb] intent routing failed, fallback to fast path", err)
    return false
  }
}

/** function calling 循环：先出计划，再逐轮取资料，最后一定收尾 */
async function* runLoop(
  input: KbAgentInput,
  prefetch: KbPrefetch,
  context: KbAgentContext,
  usage: LlmTokenUsage,
  exhausted: () => boolean,
): AsyncGenerator<KbChatStreamEvent, KbAgentResult> {
  const toolkit = createKbToolkit({
    db: input.db,
    anysearchKey: input.anysearchKey,
    signal: input.signal,
    registry: context.registry,
  })

  const plan = await makePlan(input, usage)
  if (plan.length > 0) yield { type: "plan", items: plan }

  const conversation: DeepSeekChatMessage[] = buildLoopMessages({
    messages: input.messages,
    contextSummary: input.contextSummary ?? "",
    folderDigest: prefetch.folderDigest,
    bookmarkContext: context.bookmarkContext,
    webContext: context.webContext,
  })

  const gathered: string[] = []
  let planCursor = 0
  let failures = 0

  for (let round = 0; round < KB_AGENT_MAX_TOOL_ROUNDS; round++) {
    if (exhausted()) break

    const step = plan[planCursor]
    if (step) yield { type: "plan_update", id: step.id, status: "in-progress" }

    let calls: DeepSeekToolCall[] = []
    let text = ""
    try {
      for await (const chunk of streamDeepSeekChat({
        apiKey: input.apiKey,
        model: input.model,
        messages: conversation,
        tools: toolkit.tools,
        signal: input.signal,
      })) {
        if (chunk.type === "delta") text += chunk.text
        else if (chunk.type === "tool_call") calls = chunk.calls
        else addLlmUsage(usage, chunk.usage)
      }
    } catch (err) {
      // 循环内的上游失败不判死，交给后面的直出收尾
      console.error("[kb] agent round failed", err)
      break
    }

    if (calls.length === 0) {
      // 模型认为资料已足够：这轮攒下的文本就是最终回答
      if (text.trim()) {
        yield { type: "delta", text }
        yield* settlePlan(plan, planCursor)
        return {
          status: "ok",
          errorCode: null,
          usage: hasLlmUsage(usage) ? usage : undefined,
          model: input.model,
        }
      }
      break
    }

    conversation.push({ role: "assistant", content: text, tool_calls: calls })

    for (const call of calls) {
      yield { type: "activity", item: toolActivity(call, "active") }

      const result = await toolkit.execute(
        call.function.name,
        call.function.arguments,
      )
      failures = result.failed ? failures + 1 : 0
      const content = truncate(result.content, KB_AGENT_TOOL_RESULT_MAX_CHARS)
      // 失败与无命中的回执是给循环内模型看的状态说明，不是资料。
      // 混进 gathered 会被收尾时当成「用户收藏」拼进 prompt，
      // 让模型面对一段声称是资料、实则只有错误提示的输入。
      if (!result.failed && result.count > 0) gathered.push(content)

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content,
      })

      if (result.sources.length > 0) {
        yield { type: "sources_append", sources: result.sources }
      }
      yield {
        type: "activity",
        item: toolActivity(call, "complete", result.count),
      }
    }

    if (step) {
      yield { type: "plan_update", id: step.id, status: "completed" }
      planCursor++
    }

    if (failures >= MAX_CONSECUTIVE_TOOL_FAILURES) break
  }

  // 轮数/预算耗尽或循环中断：用手上全部资料直出，绝不空手返回
  const result = yield* generate({
    input,
    usage,
    messages: buildMessages({
      messages: input.messages,
      contextSummary: input.contextSummary ?? "",
      folderDigest: prefetch.folderDigest,
      bookmarkContext: [context.bookmarkContext, ...gathered]
        .filter(Boolean)
        .join("\n\n"),
      webContext: context.webContext,
    }),
  })
  yield* settlePlan(plan, planCursor)
  return result
}

/** 收尾时把没走到的计划项标完成，避免 TodoList 永久转圈 */
function* settlePlan(
  plan: KbChatPlanItem[],
  from: number,
): Generator<KbChatStreamEvent> {
  for (const item of plan.slice(from)) {
    yield { type: "plan_update", id: item.id, status: "completed" }
  }
}

/** 让模型先给 3-5 条待办；失败时返回空计划，循环照常跑 */
async function makePlan(
  input: KbAgentInput,
  usage: LlmTokenUsage,
): Promise<KbChatPlanItem[]> {
  try {
    const { content, usage: planUsage } = await callDeepSeekJson({
      apiKey: input.apiKey,
      model: input.model,
      maxTokens: 256,
      signal: input.signal,
      messages: [
        {
          role: "system",
          content: [
            "把用户的问题拆成 3-5 个检索或分析步骤，每步一句话，中文，不超过 20 字。",
            '只输出 JSON：{"steps":["...","..."]}。',
          ].join("\n"),
        },
        { role: "user", content: input.query },
      ],
    })
    addLlmUsage(usage, planUsage)
    const parsed = JSON.parse(content) as { steps?: unknown }
    if (!Array.isArray(parsed.steps)) return []
    return parsed.steps
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .slice(0, 5)
      .map((title, i) => ({
        id: `plan-${i + 1}`,
        title: truncate(title.trim(), 40),
        status: "pending" as const,
      }))
  } catch (err) {
    console.error("[kb] plan generation failed", err)
    return []
  }
}

/** 最终生成：流式产出 delta，聚合 usage */
async function* generate(opts: {
  input: KbAgentInput
  usage: LlmTokenUsage
  messages: DeepSeekChatMessage[]
}): AsyncGenerator<KbChatStreamEvent, KbAgentResult> {
  const { input, usage } = opts
  try {
    for await (const chunk of streamDeepSeekChat({
      apiKey: input.apiKey,
      model: input.model,
      messages: opts.messages,
      signal: input.signal,
    })) {
      if (chunk.type === "delta") yield { type: "delta", text: chunk.text }
      else if (chunk.type === "usage") addLlmUsage(usage, chunk.usage)
    }
    return {
      status: "ok",
      errorCode: null,
      usage: hasLlmUsage(usage) ? usage : undefined,
      model: input.model,
    }
  } catch (err) {
    return {
      status: "error",
      errorCode:
        err && typeof err === "object" && "errorCode" in err
          ? String((err as { errorCode?: unknown }).errorCode)
          : "STREAM_FAILED",
      usage: hasLlmUsage(usage) ? usage : undefined,
      model: input.model,
    }
  }
}

/**
 * 工具名直接当 label 兜底，措辞由前端按 stage 本地化。
 * active 与 complete 共用 id，前端按 id 原地更新同一行而不是追加两条。
 */
function toolActivity(
  call: DeepSeekToolCall,
  status: "active" | "complete",
  count?: number,
): KbChatActivityItem {
  const name = call.function.name
  return {
    id: call.id || name,
    type: "step",
    status,
    label: name,
    stage:
      name === "search_web"
        ? "search_web"
        : name === "search_bookmarks" ||
            name === "get_bookmark_detail" ||
            name === "list_folder_bookmarks"
          ? "search_bookmarks"
          : undefined,
    ...(count === undefined ? {} : { count }),
  }
}

