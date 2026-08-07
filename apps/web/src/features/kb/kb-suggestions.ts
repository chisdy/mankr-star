/**
 * 欢迎页的建议提问由用户真实的分类与标签拼出来，而不是写死三句。
 * 这里只产出「语义槽位」，措辞交给 i18n —— 与 activity 的 stage 同一套路。
 */
export type KbSuggestionSlot =
  | { kind: "folderSummary"; name: string }
  | { kind: "folderBridge"; name: string; other: string }
  | { kind: "tagFind"; name: string }
  | { kind: "tagCompare"; name: string }
  | { kind: "recent" }

type Bucket = { name: string; count?: number }

/** 候选池取前几名就够，太长尾的分类拼出来的问题反而检索不到东西 */
const CANDIDATE_LIMIT = 6
const SLOT_COUNT = 3

/**
 * offset 用于「换一批」：按热度排序后循环取值，
 * 比随机更可预期 —— 连点几次能把候选逛完，且同一 offset 结果稳定。
 */
export function buildKbSuggestionSlots(input: {
  folders: readonly Bucket[]
  tags: readonly Bucket[]
  offset: number
}): KbSuggestionSlot[] {
  const folders = topBuckets(input.folders)
  const tags = topBuckets(input.tags)

  const folderAt = (i: number) => pickAt(folders, input.offset + i)
  const tagAt = (i: number) => pickAt(tags, input.offset + i)

  const slots: KbSuggestionSlot[] = []
  const push = (slot: KbSuggestionSlot | null) => {
    if (slot) slots.push(slot)
  }

  const firstFolder = folderAt(0)
  const secondFolder = folderAt(1)

  push(firstFolder ? { kind: "folderSummary", name: firstFolder } : null)
  push(tagAt(0) ? { kind: "tagFind", name: tagAt(0)! } : null)
  push(
    firstFolder && secondFolder && secondFolder !== firstFolder
      ? { kind: "folderBridge", name: firstFolder, other: secondFolder }
      : null,
  )
  push(tagAt(1) && tagAt(1) !== tagAt(0) ? { kind: "tagCompare", name: tagAt(1)! } : null)
  push({ kind: "recent" })

  return slots.slice(0, SLOT_COUNT)
}

function topBuckets(buckets: readonly Bucket[]): string[] {
  return [...buckets]
    .filter((b) => b.name.trim().length > 0 && (b.count ?? 0) > 0)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, CANDIDATE_LIMIT)
    .map((b) => b.name.trim())
}

function pickAt(list: string[], index: number): string | undefined {
  if (list.length === 0) return undefined
  return list[((index % list.length) + list.length) % list.length]
}
