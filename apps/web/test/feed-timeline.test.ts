import { describe, expect, it } from "vitest"
import {
  flattenFeedRows,
  formatFeedDate,
} from "../src/features/feed/feed-timeline"
import type { UpdateEvent } from "../src/lib/types"

function event(id: string, detectedAt: string): UpdateEvent {
  return {
    id,
    bookmark_id: `bm-${id}`,
    event_type: "push",
    detected_at: detectedAt,
  }
}

describe("flattenFeedRows", () => {
  it("空列表不产生任何行", () => {
    expect(flattenFeedRows([], "zh-CN")).toEqual([])
  })

  it("同一天的事件共用一个标题，标题按到达顺序排列", () => {
    const rows = flattenFeedRows(
      [
        event("a", "2026-03-02T12:00:00.000Z"),
        event("b", "2026-03-02T11:00:00.000Z"),
        event("c", "2026-03-01T12:00:00.000Z"),
      ],
      "en-US",
    )

    expect(rows.map((r) => r.kind)).toEqual([
      "header",
      "event",
      "event",
      "header",
      "event",
    ])
    expect(rows.filter((r) => r.kind === "header")).toHaveLength(2)
    expect(rows.flatMap((r) => (r.kind === "event" ? [r.event.id] : []))).toEqual(
      ["a", "b", "c"],
    )
  })

  it("只有当天最后一条带 lastOfDay，用于承担组间间距", () => {
    const rows = flattenFeedRows(
      [
        event("a", "2026-03-02T12:00:00.000Z"),
        event("b", "2026-03-02T11:00:00.000Z"),
        event("c", "2026-03-01T12:00:00.000Z"),
      ],
      "en-US",
    )

    const flags = rows.flatMap((r) =>
      r.kind === "event" ? [[r.event.id, r.lastOfDay] as const] : [],
    )
    expect(flags).toEqual([
      ["a", false],
      ["b", true],
      ["c", true],
    ])
  })

  it("行 key 稳定：标题按日期、事件按 id", () => {
    const rows = flattenFeedRows([event("a", "2026-03-02T10:00:00.000Z")], "en-US")
    const [header, first] = rows
    expect(header?.kind === "header" && header.key).toBe(
      `header:${formatFeedDate("2026-03-02T10:00:00.000Z", "en-US")}`,
    )
    expect(first?.key).toBe("a")
  })

  it("标题按传入 locale 格式化，切换语言后整列跟着变", () => {
    const iso = "2026-03-02T10:00:00.000Z"
    const en = flattenFeedRows([event("a", iso)], "en-US")[0]
    const zh = flattenFeedRows([event("a", iso)], "zh-CN")[0]

    expect(en?.kind === "header" && en.date).toBe(formatFeedDate(iso, "en-US"))
    expect(zh?.kind === "header" && zh.date).toBe(formatFeedDate(iso, "zh-CN"))
  })

  it("跨越本地日界的事件分到不同组", () => {
    // 同一 UTC 日的两个时刻，在 UTC 下必然同组；换成相邻两天则必然分组
    const rows = flattenFeedRows(
      [event("a", "2026-03-02T00:30:00.000Z"), event("b", "2026-03-03T00:30:00.000Z")],
      "en-US",
    )
    expect(rows.filter((r) => r.kind === "header")).toHaveLength(2)
  })
})
