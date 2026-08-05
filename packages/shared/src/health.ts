import {
  DEFAULT_HOT_WITHIN_DAYS,
  DEFAULT_STALE_AFTER_DAYS,
  type HealthStatus,
  type SyncStatus,
} from "./constants"

export type ComputeHealthInput = {
  syncStatus: SyncStatus
  githubArchived?: boolean | null
  githubDisabled?: boolean | null
  repoSize?: number | null
  pushedAt?: string | null
  defaultBranch?: string | null
  hotWithinDays?: number
  staleAfterDays?: number
  /** 计算「距今」的锚点，默认 Date.now()；测试可注入 */
  nowMs?: number
}

function daysSince(iso: string, nowMs: number): number | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (nowMs - t) / (1000 * 60 * 60 * 24)
}

/**
 * 互斥优先级：unavailable → empty → archived → hot/active/stale → unknown
 * sync_status=error 时不把原近况降为 stale（由调用方决定是否传入已有 status 并跳过）；
 * 本函数在 error/never 且无足够事实时返回 unknown。
 */
export function computeHealthStatus(input: ComputeHealthInput): HealthStatus {
  const hotDays = input.hotWithinDays ?? DEFAULT_HOT_WITHIN_DAYS
  const staleDays = input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS
  const nowMs = input.nowMs ?? Date.now()

  if (
    input.syncStatus === "not_found" ||
    input.syncStatus === "forbidden" ||
    input.githubDisabled
  ) {
    return "unavailable"
  }

  if (input.syncStatus === "error" || input.syncStatus === "never") {
    // 无成功事实时无法判定活跃度
    if (
      input.githubArchived == null &&
      input.repoSize == null &&
      !input.pushedAt
    ) {
      return "unknown"
    }
    // error 但已有快照：仍可按事实判定（不因本次失败改写为 stale 以外的降级）
  }

  if (input.repoSize === 0) {
    return "empty"
  }

  if (
    (input.repoSize == null || input.repoSize === 0) &&
    !input.pushedAt &&
    !input.defaultBranch
  ) {
    // size 未知且无推送/分支 → 可能空仓；仅在明确 size===0 时标 empty
    // 此处保持继续往下；若完全无 pushedAt 最后会 unknown/stale 边界
  }

  if (input.githubArchived) {
    return "archived"
  }

  if (!input.pushedAt) {
    // 有 size>0 但无 pushed_at：近况未知
    if (input.repoSize != null && input.repoSize > 0) return "unknown"
    if (!input.defaultBranch) return "empty"
    return "unknown"
  }

  const age = daysSince(input.pushedAt, nowMs)
  if (age == null) return "unknown"

  if (age <= hotDays) return "hot"
  if (age < staleDays) return "active"
  return "stale"
}

/** 仅用已存 pushed_at 重算 hot/active/stale（阈值变更时）；其它终态保持不变 */
export function recomputeActivityHealth(
  current: HealthStatus,
  pushedAt: string | null | undefined,
  opts: {
    hotWithinDays?: number
    staleAfterDays?: number
    nowMs?: number
  } = {},
): HealthStatus {
  if (
    current === "unavailable" ||
    current === "empty" ||
    current === "archived" ||
    current === "unknown"
  ) {
    return current
  }
  return computeHealthStatus({
    syncStatus: "ok",
    pushedAt,
    hotWithinDays: opts.hotWithinDays,
    staleAfterDays: opts.staleAfterDays,
    nowMs: opts.nowMs,
  })
}
