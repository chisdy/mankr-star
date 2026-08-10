import { describe, expect, it } from "vitest"
import { getHorizontalScrollStep } from "../src/features/bookmarks/horizontal-scroll"

describe("getHorizontalScrollStep", () => {
  it("每次按可视宽度的七成滚动", () => {
    expect(getHorizontalScrollStep(1000, "left")).toBe(-700)
    expect(getHorizontalScrollStep(1000, "right")).toBe(700)
  })
})
