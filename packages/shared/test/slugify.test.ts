import { describe, expect, it } from "vitest"
import { slugify } from "../src/slugify"

describe("slugify", () => {
  it("规范化空白、大小写与符号", () => {
    expect(slugify("  React UI  ")).toBe("react-ui")
    expect(slugify("react!")).toBe("react")
    expect(slugify("foo_bar")).toBe("foo-bar")
  })

  it("保留中文，空输入回退 tag", () => {
    expect(slugify("新标签")).toBe("新标签")
    expect(slugify("!!!")).toBe("tag")
    expect(slugify("   ")).toBe("tag")
  })
})
