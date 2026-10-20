import { describe, expect, it } from "vitest"
import { buildDeepseekModelOptions } from "../src/features/settings/deepseek-model-options"

const builtin = [
  { value: "deepseek-v4-flash", label: "快速" },
  { value: "deepseek-v4-pro", label: "专业" },
]

const synced = [
  { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
]

describe("buildDeepseekModelOptions", () => {
  it("未同步时使用内置两项", () => {
    expect(
      buildDeepseekModelOptions({
        synced: [],
        savedModel: "deepseek-v4-flash",
        draftModel: "deepseek-v4-flash",
        builtin,
      }).map((option) => option.value)
    ).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"])
  })

  it("选中官方模型后，不在名单里的已保存模型仍然留在选项里", () => {
    const before = buildDeepseekModelOptions({
      synced,
      savedModel: "deepseek-v4-flash",
      draftModel: "deepseek-v4-flash",
      builtin,
    })
    const after = buildDeepseekModelOptions({
      synced,
      savedModel: "deepseek-v4-flash",
      draftModel: "deepseek-flash",
      builtin,
    })

    expect(before.map((option) => option.value)).toEqual([
      "deepseek-v4-flash",
      "deepseek-flash",
      "deepseek-v4-pro",
    ])
    expect(after.map((option) => option.value)).toEqual(
      before.map((option) => option.value)
    )
    expect(
      after.find((option) => option.value === "deepseek-flash")?.label
    ).toBe("DeepSeek-V4.1-Flash")
  })
})
