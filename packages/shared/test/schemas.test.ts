import { describe, expect, it } from "vitest"
import {
  aiOutputSchema,
  createBookmarkSchema,
  createFolderSchema,
  deepseekSettingsSchema,
  deleteFolderSchema,
  listBookmarksQuerySchema,
  loginSchema,
  registerSchema,
  updateBookmarkSchema,
} from "../src/schemas"
import { DEFAULT_DEEPSEEK_MODEL, PASSWORD_MIN_LENGTH } from "../src/constants"

describe("registerSchema", () => {
  it("email 必填，username 可选", () => {
    const ok = registerSchema.safeParse({
      email: "owner@example.com",
      password: "password123",
    })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.username).toBeUndefined()
  })

  it("缺少 email 时失败", () => {
    const res = registerSchema.safeParse({
      username: "owner",
      password: "password123",
    })
    expect(res.success).toBe(false)
  })

  it("email 非法时失败", () => {
    expect(
      registerSchema.safeParse({ email: "not-an-email", password: "password123" })
        .success,
    ).toBe(false)
  })

  it(`密码短于 ${PASSWORD_MIN_LENGTH} 位时失败`, () => {
    expect(
      registerSchema.safeParse({ email: "a@b.com", password: "short" }).success,
    ).toBe(false)
  })

  it("username 只允许字母数字下划线连字符", () => {
    expect(
      registerSchema.safeParse({
        email: "a@b.com",
        password: "password123",
        username: "有中文",
      }).success,
    ).toBe(false)
    expect(
      registerSchema.safeParse({
        email: "a@b.com",
        password: "password123",
        username: "owner_1-x",
      }).success,
    ).toBe(true)
  })
})

describe("loginSchema", () => {
  it("使用 username 字段（可传用户名或邮箱）", () => {
    const res = loginSchema.safeParse({ username: "owner", password: "x" })
    expect(res.success).toBe(true)
    const byEmail = loginSchema.safeParse({
      username: "owner@example.com",
      password: "x",
    })
    expect(byEmail.success).toBe(true)
  })

  it("不接受 identifier 作为唯一凭据字段", () => {
    expect(
      loginSchema.safeParse({ identifier: "owner", password: "x" }).success,
    ).toBe(false)
  })

  it("username 或 password 为空时失败", () => {
    expect(loginSchema.safeParse({ username: "", password: "x" }).success).toBe(false)
    expect(loginSchema.safeParse({ username: "owner", password: "" }).success).toBe(
      false,
    )
  })
})

describe("createBookmarkSchema", () => {
  it("url 必填并默认开启更新跟踪", () => {
    const res = createBookmarkSchema.safeParse({ url: "owner/repo" })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.trackUpdates).toBe(true)
  })

  it("folderId 必须是 uuid（允许 null）", () => {
    expect(
      createBookmarkSchema.safeParse({ url: "o/r", folderId: "not-uuid" }).success,
    ).toBe(false)
    expect(
      createBookmarkSchema.safeParse({ url: "o/r", folderId: null }).success,
    ).toBe(true)
    expect(
      createBookmarkSchema.safeParse({
        url: "o/r",
        folderId: crypto.randomUUID(),
      }).success,
    ).toBe(true)
  })
})

describe("updateBookmarkSchema", () => {
  it("接受 camelCase 字段（summaryAi / trackUpdates / tagNames）", () => {
    const res = updateBookmarkSchema.safeParse({
      summaryAi: "一句话摘要",
      trackUpdates: false,
      tagNames: ["react", "ui"],
      notes: null,
      folderId: null,
      archived: true,
    })
    expect(res.success).toBe(true)
  })

  it("标签数量上限 20", () => {
    const tagNames = Array.from({ length: 21 }, (_, i) => `t${i}`)
    expect(updateBookmarkSchema.safeParse({ tagNames }).success).toBe(false)
  })
})

describe("listBookmarksQuerySchema", () => {
  it("提供默认分页与排序", () => {
    const res = listBookmarksQuerySchema.safeParse({})
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.page).toBe(1)
      expect(res.data.pageSize).toBe(20)
      expect(res.data.sort).toBe("created_at")
      expect(res.data.order).toBe("desc")
      expect(res.data.archived).toBe(false)
      expect(res.data.includeArchived).toBe(false)
    }
  })

  it("字符串 archived/includeArchived 转布尔", () => {
    const res = listBookmarksQuerySchema.safeParse({
      archived: "true",
      includeArchived: "1",
      page: "2",
      pageSize: "50",
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.archived).toBe(true)
      expect(res.data.includeArchived).toBe(true)
      expect(res.data.page).toBe(2)
      expect(res.data.pageSize).toBe(50)
    }
  })

  it("pageSize 上限 100", () => {
    expect(listBookmarksQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false)
  })

  it("接受 healthStatus", () => {
    const res = listBookmarksQuerySchema.safeParse({ healthStatus: "stale" })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.healthStatus).toBe("stale")
  })

  it("接受 owner", () => {
    const res = listBookmarksQuerySchema.safeParse({ owner: "facebook" })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.owner).toBe("facebook")
  })

  it("接受 site", () => {
    const res = listBookmarksQuerySchema.safeParse({ site: "react.dev" })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.site).toBe("react.dev")
  })
})

describe("createFolderSchema", () => {
  it("接受英文 kebab slug，拒绝中文 slug", () => {
    expect(
      createFolderSchema.safeParse({ name: "UI 组件", slug: "ui-components" })
        .success,
    ).toBe(true)
    expect(
      createFolderSchema.safeParse({ name: "UI 组件", slug: "ui-组件" }).success,
    ).toBe(false)
  })

  it("拒绝大写字母 slug 与非法颜色", () => {
    expect(
      createFolderSchema.safeParse({ name: "x", slug: "UI-Components" }).success,
    ).toBe(false)
    expect(createFolderSchema.safeParse({ name: "x", color: "blue" }).success).toBe(
      false,
    )
    expect(
      createFolderSchema.safeParse({ name: "x", color: "#3b82f6" }).success,
    ).toBe(true)
  })
})

describe("deleteFolderSchema", () => {
  it("默认 detach，move 时要求目标", () => {
    expect(deleteFolderSchema.safeParse({}).success).toBe(true)
    expect(
      deleteFolderSchema.safeParse({ bookmarkAction: "delete" }).success,
    ).toBe(true)
    expect(
      deleteFolderSchema.safeParse({ bookmarkAction: "move" }).success,
    ).toBe(false)
    expect(
      deleteFolderSchema.safeParse({
        bookmarkAction: "move",
        moveToFolderId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true)
  })
})

describe("deepseekSettingsSchema", () => {
  it("只接受受支持的模型", () => {
    expect(
      deepseekSettingsSchema.safeParse({ model: DEFAULT_DEEPSEEK_MODEL }).success,
    ).toBe(true)
    expect(deepseekSettingsSchema.safeParse({ model: "gpt-4o" }).success).toBe(false)
  })

  it("支持 apiKey 与 clearKey", () => {
    expect(deepseekSettingsSchema.safeParse({ apiKey: "sk-test" }).success).toBe(true)
    expect(deepseekSettingsSchema.safeParse({ clearKey: true }).success).toBe(true)
  })
})

describe("aiOutputSchema", () => {
  it("解析合法 AI 输出并填充默认值（folder_id）", () => {
    const res = aiOutputSchema.safeParse({
      summary: "极速 Python 包管理器",
      folder_id: "00000000-0000-4000-8000-000000000001",
      tags: ["python", "cli"],
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.use_cases).toEqual([])
      expect(res.data.confidence).toBe(0.5)
      expect(res.data.folder_id).toBe("00000000-0000-4000-8000-000000000001")
    }
  })

  it("接受 new_folder 与兼容 folder_path", () => {
    expect(
      aiOutputSchema.safeParse({
        summary: "边缘网关",
        folder_id: null,
        new_folder: { name: "边缘网关", parent_id: null },
        tags: ["gateway"],
      }).success,
    ).toBe(true)
    expect(
      aiOutputSchema.safeParse({
        summary: "兼容",
        folder_path: ["工具与 CLI"],
        tags: ["cli"],
      }).success,
    ).toBe(true)
  })

  it("摘要超长或标签为空时失败", () => {
    expect(
      aiOutputSchema.safeParse({
        summary: "字".repeat(200),
        folder_id: null,
        tags: ["a"],
      }).success,
    ).toBe(false)
    expect(
      aiOutputSchema.safeParse({ summary: "x", folder_id: null, tags: [] })
        .success,
    ).toBe(false)
  })

  it("confidence 必须在 0~1", () => {
    expect(
      aiOutputSchema.safeParse({
        summary: "x",
        folder_id: null,
        tags: ["a"],
        confidence: 1.5,
      }).success,
    ).toBe(false)
  })

  it("接受多级 folder_path（兼容）", () => {
    const res = aiOutputSchema.safeParse({
      summary: "Agent Skill 集合",
      folder_path: ["AI / LLM", "Agent Skills"],
      tags: ["skill", "agent"],
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.folder_path).toEqual(["AI / LLM", "Agent Skills"])
    }
  })
})

describe("createFolderSchema parentId", () => {
  it("接受 uuid parentId 或 null", () => {
    const id = crypto.randomUUID()
    expect(
      createFolderSchema.safeParse({ name: "子文件夹", parentId: id }).success,
    ).toBe(true)
    expect(
      createFolderSchema.safeParse({ name: "一级", parentId: null }).success,
    ).toBe(true)
  })
})
