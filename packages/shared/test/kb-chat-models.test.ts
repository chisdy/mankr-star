import { describe, expect, it } from "vitest"
import {
  DEEPSEEK_PRICE_USD_PER_1M,
  DEFAULT_DEEPSEEK_MODEL,
  KB_CHAT_MODELS,
  KB_CHAT_MODEL_IDS,
  findKbChatModel,
  isAllowedKbChatModel,
} from "../src/constants"

describe("findKbChatModel", () => {
  it("命中表内模型，返回 provider 与 tools 能力", () => {
    const entry = findKbChatModel(DEFAULT_DEEPSEEK_MODEL)
    expect(entry?.provider).toBe("deepseek")
    expect(entry?.tools).toBe(true)
  })

  it("内置模型、已同步目录和当前保存的模型可以通过，其余 id 不行", () => {
    expect(isAllowedKbChatModel("deepseek-v4-flash", [], null)).toBe(true)
    expect(
      isAllowedKbChatModel("deepseek-flash", ["deepseek-flash"], null)
    ).toBe(true)
    expect(isAllowedKbChatModel("deepseek-flash", [], "deepseek-flash")).toBe(
      true
    )
    expect(isAllowedKbChatModel("deepseek-v3-retired", [], null)).toBe(false)
    expect(isAllowedKbChatModel("bad id", ["bad id"], null)).toBe(false)
  })

  it("空值与下线模型都查不到，调用方可据此回落默认模型", () => {
    for (const value of [undefined, null, "", "deepseek-v3-retired"]) {
      expect(findKbChatModel(value)).toBeUndefined()
    }
  })
})

describe("KB_CHAT_MODELS", () => {
  it("默认模型在可选列表内", () => {
    expect(KB_CHAT_MODEL_IDS).toContain(DEFAULT_DEEPSEEK_MODEL)
  })

  /**
   * 漏配定价不会报错，只会让洞察页的成本估算静默少算
   * （insights 对查不到价格的 model 是 continue 跳过）。
   */
  it("每个 deepseek 模型都配了单价", () => {
    for (const entry of KB_CHAT_MODELS) {
      expect(DEEPSEEK_PRICE_USD_PER_1M[entry.model]).toBeDefined()
    }
  })
})
