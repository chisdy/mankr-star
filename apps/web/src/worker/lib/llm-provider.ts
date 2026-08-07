import type { KbChatProvider } from "@mankr/shared"

/**
 * 提供方无关的用量模型。各厂商的缓存字段名互不相同
 * （DeepSeek prompt_cache_hit_tokens / OpenAI cached_tokens /
 * Anthropic cache_read_input_tokens），一律在 parseLlmUsage 里归一到
 * cache_read_tokens 与 cache_write_tokens，让 agent、记账与洞察页
 * 都不必知道当前用的是哪一家。
 */
export type LlmTokenUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** 命中缓存、按折扣价计费的 input tokens */
  cache_read_tokens: number
  /** 为建立缓存额外计费的 tokens；DeepSeek 这类隐式缓存恒为 0 */
  cache_write_tokens: number
}

export function emptyLlmUsage(): LlmTokenUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  }
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 归一化上游 usage。未知 provider 只降级掉缓存字段而不抛错：
 * 记账是链路末端的副作用，不能因为多了一家没适配的模型就丢掉整轮用量。
 */
export function parseLlmUsage(
  raw: unknown,
  provider: KbChatProvider | string = "deepseek",
): LlmTokenUsage {
  if (!raw || typeof raw !== "object") return emptyLlmUsage()

  const u = raw as Record<string, unknown>
  const prompt = num(u.prompt_tokens)
  const completion = num(u.completion_tokens)
  const total = num(u.total_tokens) || prompt + completion

  let cacheRead = 0
  let cacheWrite = 0
  switch (provider) {
    case "deepseek":
      // 隐式磁盘缓存：只报命中/未命中，没有写入费用。
      // miss 不单独存，需要时可由 prompt_tokens - cache_read_tokens 推导。
      cacheRead = num(u.prompt_cache_hit_tokens)
      break
    default:
      // 新厂商在此追加一支；未适配时缓存指标留 0，不影响主用量。
      break
  }

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
  }
}

/** 原地累加，供 agent 把一轮里多次调用的用量聚合成一条日志 */
export function addLlmUsage(target: LlmTokenUsage, next: LlmTokenUsage): void {
  target.prompt_tokens += next.prompt_tokens
  target.completion_tokens += next.completion_tokens
  target.total_tokens += next.total_tokens
  target.cache_read_tokens += next.cache_read_tokens
  target.cache_write_tokens += next.cache_write_tokens
}

export function hasLlmUsage(usage: LlmTokenUsage): boolean {
  return usage.total_tokens > 0 || usage.prompt_tokens > 0
}

/**
 * 缓存策略缝隙。
 *
 * implicit 的厂商（DeepSeek、OpenAI）只靠消息顺序就能命中，稳定前缀布局
 * 已经把活干完了，请求上不需要任何额外字段。explicit 的厂商（Anthropic 的
 * cache_control）还要显式指出「缓存到哪一条为止」。
 *
 * 消息布局本身是厂商无关的（见 kb-prompts.ts），所以这里只描述「要不要打标」，
 * 不承担布局职责。接第二家时在此追加分支即可，压缩与布局都不用动。
 */
export type LlmCachePolicy = {
  mode: "implicit" | "explicit"
  /**
   * explicit 厂商在此给稳定前缀打断点。stablePrefixCount 是从头数起
   * 「两次压缩之间不会变」的消息条数（system + 分类目录 + 摘要），
   * 断点必须打在这个边界上——打在历史或资料上等于每轮重建缓存。
   */
  applyCacheHints?: <T>(messages: T[], stablePrefixCount: number) => T[]
}

const IMPLICIT_POLICY: LlmCachePolicy = { mode: "implicit" }

export function getCachePolicy(
  provider: KbChatProvider | string | undefined,
): LlmCachePolicy {
  switch (provider) {
    case "deepseek":
      // 服务端自动前缀缓存，命中与否只体现在 usage 里
      return IMPLICIT_POLICY
    default:
      // 未适配的厂商按 implicit 处理：稳定前缀布局对所有前缀缓存都有效，
      // 最坏情况只是拿不到 explicit 那部分额外收益，不会把请求发坏。
      return IMPLICIT_POLICY
  }
}
