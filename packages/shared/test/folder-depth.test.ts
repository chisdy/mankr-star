import { describe, expect, it } from "vitest"

import { FOLDER_MAX_DEPTH, wouldExceedMaxDepth } from "../src/constants"

describe("wouldExceedMaxDepth", () => {
  it("根级只在子树跨度本身超限时拒绝", () => {
    expect(wouldExceedMaxDepth(0, -1)).toBe(false)
    expect(wouldExceedMaxDepth(FOLDER_MAX_DEPTH, -1)).toBe(false)
    expect(wouldExceedMaxDepth(FOLDER_MAX_DEPTH + 1, -1)).toBe(true)
  })

  it("新父级深度加上子树跨度超过上限时拒绝", () => {
    expect(wouldExceedMaxDepth(0, FOLDER_MAX_DEPTH)).toBe(true)
    expect(wouldExceedMaxDepth(0, FOLDER_MAX_DEPTH - 1)).toBe(false)
    expect(wouldExceedMaxDepth(1, 3)).toBe(true)
  })
})
