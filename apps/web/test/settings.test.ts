import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  OWNER,
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"
const DEEPSEEK = "https://api.deepseek.com/chat/completions"
const ANYSEARCH = "https://api.anysearch.com/v1/search"
const FAKE_KEY = "sk-test-deepseek-key-abcdef1234"
const ANYSEARCH_KEY = "as-test-anysearch-key-987654"

interface DeepSeekSettingsResponse {
  deepseek_configured: boolean
  deepseek_last4: string | null
  deepseek_model: string
  code?: string
  error?: string
}

interface AnySearchSettingsResponse {
  anysearch_configured: boolean
  anysearch_last4: string | null
  code?: string
  error?: string
}

let client: TestClient
let outbound: OutboundMock

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  outbound.text(`${GITHUB}facebook/react/readme`, "# React\n用于构建界面的库")
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

describe("PUT /api/settings/deepseek", () => {
  it("保存 Key 后只回显 configured 与 last4，永不回显完整 Key", async () => {
    const res = await client.fetch("/api/settings/deepseek", {
      method: "PUT",
      body: JSON.stringify({ apiKey: FAKE_KEY, model: "deepseek-v4-pro" }),
    })
    const text = await res.text()
    const body = JSON.parse(text) as DeepSeekSettingsResponse

    expect(res.status).toBe(200)
    expect(body.deepseek_configured).toBe(true)
    expect(body.deepseek_last4).toBe(FAKE_KEY.slice(-4))
    expect(body.deepseek_model).toBe("deepseek-v4-pro")
    expect(text).not.toContain(FAKE_KEY)
    expect(text).not.toContain("deepseek_api_key_encrypted")
  })

  it("GET /api/me 同样不回显完整 Key", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })

    const res = await client.fetch("/api/me")
    const text = await res.text()
    const body = JSON.parse(text) as Record<string, unknown>

    expect(body.deepseek_configured).toBe(true)
    expect(body.deepseek_last4).toBe(FAKE_KEY.slice(-4))
    expect(text).not.toContain(FAKE_KEY)
    expect(text).not.toContain(FAKE_KEY.slice(0, 12))
  })

  it("仅更新模型时保留已有 Key", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })
    const { status, body } = await client.put<DeepSeekSettingsResponse>(
      "/api/settings/deepseek",
      { model: "deepseek-v4-pro" },
    )
    expect(status).toBe(200)
    expect(body.deepseek_configured).toBe(true)
    expect(body.deepseek_model).toBe("deepseek-v4-pro")
    expect(body.deepseek_last4).toBe(FAKE_KEY.slice(-4))
  })

  it("空请求体返回 400，非法模型返回 400", async () => {
    const empty = await client.put<DeepSeekSettingsResponse>(
      "/api/settings/deepseek",
      {},
    )
    expect(empty.status).toBe(400)
    expect(empty.body.code).toBe("BAD_REQUEST")

    const badModel = await client.put<DeepSeekSettingsResponse>(
      "/api/settings/deepseek",
      { model: "gpt-4o" },
    )
    expect(badModel.status).toBe(400)
    expect(badModel.body.code).toBe("VALIDATION_ERROR")
  })

  it("clearKey 与 DELETE 均可清除 Key", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })
    const cleared = await client.put<DeepSeekSettingsResponse>(
      "/api/settings/deepseek",
      { clearKey: true },
    )
    expect(cleared.body.deepseek_configured).toBe(false)
    expect(cleared.body.deepseek_last4).toBeNull()

    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })
    const deleted = await client.delete<DeepSeekSettingsResponse>(
      "/api/settings/deepseek",
    )
    expect(deleted.status).toBe(200)
    expect(deleted.body.deepseek_configured).toBe(false)

    const me = await client.json<{ deepseek_configured: boolean }>("/api/me")
    expect(me.body.deepseek_configured).toBe(false)
  })
})

describe("POST /api/settings/deepseek/test", () => {
  it("未配置 Key 时返回 400 NOT_CONFIGURED", async () => {
    const { status, body } = await client.post<{ ok: boolean; code: string }>(
      "/api/settings/deepseek/test",
    )
    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.code).toBe("NOT_CONFIGURED")
  })

  it("连接成功返回 ok，上游失败返回 502", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })

    outbound.json(DEEPSEEK, { choices: [{ message: { content: "pong" } }] })
    const ok = await client.post<{ ok: boolean }>("/api/settings/deepseek/test")
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)

    outbound.json(DEEPSEEK, { error: "invalid api key" }, 401)
    const failed = await client.post<{ ok: boolean; error: string }>(
      "/api/settings/deepseek/test",
    )
    expect(failed.status).toBe(502)
    expect(failed.body.ok).toBe(false)
    expect(failed.body.error).toContain("401")
  })
})

describe("AnySearch 设置", () => {
  it("保存 Key 后只回显 configured 与 last4，/me 与 login 同步", async () => {
    const res = await client.fetch("/api/settings/anysearch", {
      method: "PUT",
      body: JSON.stringify({ apiKey: ANYSEARCH_KEY }),
    })
    const text = await res.text()
    const body = JSON.parse(text) as AnySearchSettingsResponse

    expect(res.status).toBe(200)
    expect(body.anysearch_configured).toBe(true)
    expect(body.anysearch_last4).toBe(ANYSEARCH_KEY.slice(-4))
    expect(text).not.toContain(ANYSEARCH_KEY)

    const me = await client.fetch("/api/me")
    const meText = await me.text()
    expect(JSON.parse(meText).anysearch_configured).toBe(true)
    expect(meText).not.toContain(ANYSEARCH_KEY)

    const relogin = new TestClient()
    const login = await relogin.post<{
      user: { anysearch_configured: boolean; anysearch_last4: string | null }
    }>("/api/auth/login", {
      username: OWNER.username,
      password: OWNER.password,
    })
    expect(login.body.user.anysearch_configured).toBe(true)
    expect(login.body.user.anysearch_last4).toBe(ANYSEARCH_KEY.slice(-4))
  })

  it("既无 apiKey 也无 clearKey 返回 400；DELETE 后回到未配置", async () => {
    const empty = await client.put<{ code: string }>(
      "/api/settings/anysearch",
      {},
    )
    expect(empty.status).toBe(400)

    await client.put("/api/settings/anysearch", { apiKey: ANYSEARCH_KEY })
    const cleared = await client.delete<AnySearchSettingsResponse>(
      "/api/settings/anysearch",
    )
    expect(cleared.status).toBe(200)
    expect(cleared.body.anysearch_configured).toBe(false)
    expect(cleared.body.anysearch_last4).toBeNull()
  })

  it("测试连接：未配置 400，配置后成功 200，上游失败 502", async () => {
    const notConfigured = await client.post<{ ok: boolean; code: string }>(
      "/api/settings/anysearch/test",
    )
    expect(notConfigured.status).toBe(400)
    expect(notConfigured.body.code).toBe("NOT_CONFIGURED")

    await client.put("/api/settings/anysearch", { apiKey: ANYSEARCH_KEY })

    outbound.json(ANYSEARCH, {
      code: 0,
      data: { results: [{ title: "t", url: "https://e.com", snippet: "s" }] },
    })
    const ok = await client.post<{ ok: boolean }>("/api/settings/anysearch/test")
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)

    outbound.json(ANYSEARCH, { code: 401, message: "invalid key" }, 401)
    const failed = await client.post<{ ok: boolean; error: string }>(
      "/api/settings/anysearch/test",
    )
    expect(failed.status).toBe(502)
    expect(failed.body.ok).toBe(false)
    expect(failed.body.error).not.toContain(ANYSEARCH_KEY)
  })
})

describe("DeepSeek 已配置时的 AI 分类", () => {
  it("成功调用后 ai_status=done 并写入摘要/分类/标签", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })
    outbound.json(DEEPSEEK, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "构建用户界面的声明式组件库",
              folder_path: ["AI / LLM"],
              tags: ["react", "ui", "frontend"],
              use_cases: ["搭建前端界面"],
              confidence: 0.9,
            }),
          },
        },
      ],
    })

    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "facebook/react",
    })
    expect(created.status).toBe(201)

    const detail = await client.json<{
      ai_status: string
      summary_ai: string
      use_cases: string[]
      ai_confidence: number
      tags: string[]
      folder: { name: string } | null
    }>(`/api/bookmarks/${created.body.id}`)

    expect(detail.body.ai_status).toBe("done")
    expect(detail.body.summary_ai).toBe("构建用户界面的声明式组件库")
    expect(detail.body.use_cases).toEqual(["搭建前端界面"])
    expect(detail.body.ai_confidence).toBeCloseTo(0.9)
    expect(detail.body.tags.sort()).toEqual(["frontend", "react", "ui"])
    expect(detail.body.folder?.name).toBe("AI / LLM")
    expect(outbound.calls).toContain(DEEPSEEK)
  })

  it("DeepSeek 调用失败时降级为 ai_status=failed 且仍有规则结果", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })
    outbound.json(DEEPSEEK, { error: "server error" }, 500)

    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "facebook/react",
    })
    const detail = await client.json<{
      ai_status: string
      summary_ai: string | null
      tags: string[]
    }>(`/api/bookmarks/${created.body.id}`)

    expect(detail.body.ai_status).toBe("failed")
    expect(detail.body.summary_ai).toBeTruthy()
    expect(detail.body.tags.length).toBeGreaterThan(0)
  })
})

describe("GitHub PAT 设置", () => {
  it("保存与清除 PAT，且不回显明文", async () => {
    const pat = "ghp_secretsecretsecret1234"
    const res = await client.fetch("/api/settings/github-pat", {
      method: "PUT",
      body: JSON.stringify({ pat }),
    })
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(JSON.parse(text)).toEqual({ github_pat_configured: true })
    expect(text).not.toContain(pat)

    const me = await client.json<{ github_pat_configured: boolean }>("/api/me")
    expect(me.body.github_pat_configured).toBe(true)

    const cleared = await client.delete<{ github_pat_configured: boolean }>(
      "/api/settings/github-pat",
    )
    expect(cleared.body.github_pat_configured).toBe(false)
  })

  it("既未提供 pat 也未 clear 时返回 400", async () => {
    const { status, body } = await client.put<{ code: string }>(
      "/api/settings/github-pat",
      {},
    )
    expect(status).toBe(400)
    expect(body.code).toBe("BAD_REQUEST")
  })

  it("配置 PAT 后拉取元数据会带上 Authorization", async () => {
    const pat = "ghp_tokenvalue0001"
    await client.put("/api/settings/github-pat", { pat })

    let authHeader: string | null = null
    outbound.on(`${GITHUB}facebook/react`, (request) => {
      authHeader = request.headers.get("Authorization")
      return new Response(JSON.stringify(githubRepoPayload("facebook/react")), {
        headers: { "content-type": "application/json" },
      })
    })

    const created = await client.post("/api/bookmarks", { url: "facebook/react" })
    expect(created.status).toBe(201)
    expect(authHeader).toBe(`Bearer ${pat}`)
  })
})

describe("POST /api/settings/password", () => {
  it("当前密码错误返回 401", async () => {
    const { status, body } = await client.post<{ code: string }>(
      "/api/settings/password",
      { currentPassword: "wrong-password", newPassword: "brand-new-pass-1" },
    )
    expect(status).toBe(401)
    expect(body.code).toBe("INVALID_PASSWORD")
  })

  it("新密码过短返回 400", async () => {
    const { status, body } = await client.post<{ code: string }>(
      "/api/settings/password",
      { currentPassword: OWNER.password, newPassword: "123" },
    )
    expect(status).toBe(400)
    expect(body.code).toBe("VALIDATION_ERROR")
  })

  it("修改成功后新密码可登录、旧密码失效", async () => {
    const newPassword = "brand-new-pass-1"
    const changed = await client.post<{ ok: boolean }>("/api/settings/password", {
      currentPassword: OWNER.password,
      newPassword,
    })
    expect(changed.status).toBe(200)
    expect(changed.body.ok).toBe(true)

    const withNew = await new TestClient().post("/api/auth/login", {
      username: OWNER.username,
      password: newPassword,
    })
    expect(withNew.status).toBe(200)

    const withOld = await new TestClient().post("/api/auth/login", {
      username: OWNER.username,
      password: OWNER.password,
    })
    expect(withOld.status).toBe(401)
  })
})

describe("POST /api/settings/clear-data", () => {
  it("清空业务数据但保留账号", async () => {
    await client.post("/api/bookmarks", { url: "facebook/react" })

    const cleared = await client.post<{ ok: boolean }>("/api/settings/clear-data")
    expect(cleared.status).toBe(200)
    expect(cleared.body.ok).toBe(true)

    // 当前会话已随 sessions 清空而失效
    const afterClear = await client.json<{ code: string }>("/api/bookmarks")
    expect(afterClear.status).toBe(401)

    const relogin = new TestClient()
    const login = await relogin.post("/api/auth/login", {
      username: OWNER.username,
      password: OWNER.password,
    })
    expect(login.status).toBe(200)

    const list = await relogin.json<{ total: number }>("/api/bookmarks")
    expect(list.body.total).toBe(0)
    // 登录会重新 seed 预置文件夹
    const folders = await relogin.json<{ items: unknown[] }>("/api/folders")
    expect(folders.body.items.length).toBeGreaterThan(0)
  })
})

describe("PUT /api/settings/tracking", () => {
  it("保存阈值并在 /me 回显；非法 hot>=stale 返回 400", async () => {
    const bad = await client.put<{ code: string }>("/api/settings/tracking", {
      hotWithinDays: 200,
      staleAfterDays: 100,
    })
    expect(bad.status).toBe(400)

    const ok = await client.put<{
      hot_within_days: number
      stale_after_days: number
    }>("/api/settings/tracking", {
      hotWithinDays: 14,
      staleAfterDays: 90,
    })
    expect(ok.status).toBe(200)
    expect(ok.body.hot_within_days).toBe(14)
    expect(ok.body.stale_after_days).toBe(90)

    const me = await client.json<{
      hot_within_days: number
      stale_after_days: number
    }>("/api/me")
    expect(me.body.hot_within_days).toBe(14)
    expect(me.body.stale_after_days).toBe(90)
  })
})

describe("导出数据不含任何密钥", () => {
  it("export 响应不包含加密后的 Key 字段", async () => {
    await client.put("/api/settings/deepseek", { apiKey: FAKE_KEY })
    await client.post("/api/bookmarks", { url: "facebook/react" })

    const res = await client.fetch("/api/export")
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).not.toContain(FAKE_KEY)
    expect(text).not.toContain("deepseek_api_key_encrypted")
    expect(text).not.toContain("password_hash")
  })
})
