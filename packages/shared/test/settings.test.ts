import { describe, expect, it } from "vitest"
import {
  DEFAULT_BOOKMARK_PAGE_SIZE,
  DEFAULT_BOOKMARK_PAGINATION_MODE,
  bookmarkPaginationSettingsSchema,
  defaultSettingValue,
  parseSettingJson,
  parseSettingValue,
} from "../src/settings"
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_HOT_WITHIN_DAYS,
} from "../src/constants"

describe("defaultSettingValue", () => {
  it("各领域给出完整默认值", () => {
    expect(defaultSettingValue("ai")).toEqual({
      deepseekApiKeyEncrypted: null,
      deepseekKeyLast4: null,
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
    })
    expect(defaultSettingValue("bookmarks")).toEqual({
      paginationMode: DEFAULT_BOOKMARK_PAGINATION_MODE,
      pageSize: DEFAULT_BOOKMARK_PAGE_SIZE,
    })
    expect(defaultSettingValue("browsing")).toEqual({
      publicBrowsingEnabled: false,
    })
  })
})

describe("parseSettingValue", () => {
  it("缺字段时按领域默认值补齐", () => {
    expect(parseSettingValue("bookmarks", { paginationMode: "manual" })).toEqual(
      { paginationMode: "manual", pageSize: DEFAULT_BOOKMARK_PAGE_SIZE },
    )
  })

  it("坏字段只回退自己，不牵连同领域的其他字段", () => {
    expect(
      parseSettingValue("bookmarks", { paginationMode: "spiral", pageSize: 50 }),
    ).toEqual({
      paginationMode: DEFAULT_BOOKMARK_PAGINATION_MODE,
      pageSize: 50,
    })
  })

  // 密钥和普通偏好同处一个领域，偏好字段损坏绝不能把密文判成"未配置"，
  // 否则用户下一次保存会把 null 合并写回，等于永久丢钥匙
  it("模型字段损坏时保住已保存的密钥", () => {
    expect(
      parseSettingValue("ai", {
        deepseekApiKeyEncrypted: "v1$cipher",
        deepseekKeyLast4: "60eb",
        deepseekModel: "",
      }),
    ).toEqual({
      deepseekApiKeyEncrypted: "v1$cipher",
      deepseekKeyLast4: "60eb",
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
    })
  })

  it("阈值越界只重置越界的那一项", () => {
    expect(
      parseSettingValue("tracking", { hotWithinDays: 0, staleAfterDays: 200 }),
    ).toEqual({ hotWithinDays: DEFAULT_HOT_WITHIN_DAYS, staleAfterDays: 200 })
  })

  it("整体不是对象时仍回退该领域默认值", () => {
    expect(parseSettingValue("ai", "cipher")).toEqual(defaultSettingValue("ai"))
    expect(parseSettingValue("bookmarks", null)).toEqual(
      defaultSettingValue("bookmarks"),
    )
  })

  it("pageSize 越界回退默认值", () => {
    expect(parseSettingValue("bookmarks", { pageSize: 0 }).pageSize).toBe(
      DEFAULT_BOOKMARK_PAGE_SIZE,
    )
    expect(parseSettingValue("bookmarks", { pageSize: 101 }).pageSize).toBe(
      DEFAULT_BOOKMARK_PAGE_SIZE,
    )
    expect(parseSettingValue("bookmarks", { pageSize: 7.5 }).pageSize).toBe(
      DEFAULT_BOOKMARK_PAGE_SIZE,
    )
  })

  it("边界值 1 与 100 被接受", () => {
    expect(parseSettingValue("bookmarks", { pageSize: 1 }).pageSize).toBe(1)
    expect(parseSettingValue("bookmarks", { pageSize: 100 }).pageSize).toBe(100)
  })
})

describe("parseSettingJson", () => {
  it("非法 JSON 回退默认值", () => {
    expect(parseSettingJson("ai", "{ not json")).toEqual(
      defaultSettingValue("ai"),
    )
    expect(parseSettingJson("tracking", null)).toEqual(
      defaultSettingValue("tracking"),
    )
  })

  it("合法 JSON 正常解析", () => {
    expect(
      parseSettingJson("github", JSON.stringify({ patEncrypted: "cipher" })),
    ).toEqual({ patEncrypted: "cipher" })
  })
})

describe("bookmarkPaginationSettingsSchema", () => {
  it("接受三种模式", () => {
    for (const mode of ["auto", "manual", "pagination"]) {
      expect(
        bookmarkPaginationSettingsSchema.safeParse({ paginationMode: mode })
          .success,
      ).toBe(true)
    }
  })

  it("拒绝未知模式与越界 pageSize", () => {
    expect(
      bookmarkPaginationSettingsSchema.safeParse({ paginationMode: "spiral" })
        .success,
    ).toBe(false)
    expect(
      bookmarkPaginationSettingsSchema.safeParse({ pageSize: 0 }).success,
    ).toBe(false)
    expect(
      bookmarkPaginationSettingsSchema.safeParse({ pageSize: 101 }).success,
    ).toBe(false)
    expect(
      bookmarkPaginationSettingsSchema.safeParse({ pageSize: 12.5 }).success,
    ).toBe(false)
  })

  it("两项都缺时失败", () => {
    expect(bookmarkPaginationSettingsSchema.safeParse({}).success).toBe(false)
  })
})
