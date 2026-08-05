import { PRESET_FOLDERS, SESSION_COOKIE_NAME } from "@mankr/shared"
import { describe, expect, it } from "vitest"
import { OWNER, TestClient, loginClient, registerOwner } from "./helpers"

describe("GET /api/health", () => {
  it("无需登录即可返回健康状态", async () => {
    const { status, body } = await new TestClient().json<{
      ok: boolean
      service: string
      ts: string
    }>("/api/health")
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.service).toBe("mankr-star")
    expect(typeof body.ts).toBe("string")
  })
})

describe("GET /api/auth/status", () => {
  it("未初始化时 initialized=false，注册后为 true；默认未开启公开浏览", async () => {
    const client = new TestClient()
    const before = await client.json<{
      initialized: boolean
      public_browsing_enabled: boolean
      authenticated: boolean
    }>("/api/auth/status")
    expect(before.status).toBe(200)
    expect(before.body.initialized).toBe(false)
    expect(before.body.public_browsing_enabled).toBe(false)
    expect(before.body.authenticated).toBe(false)

    await registerOwner(client)

    const after = await client.json<{
      initialized: boolean
      public_browsing_enabled: boolean
      authenticated: boolean
    }>("/api/auth/status")
    expect(after.body.initialized).toBe(true)
    expect(after.body.public_browsing_enabled).toBe(false)
    expect(after.body.authenticated).toBe(true)
  })
})

describe("POST /api/auth/register", () => {
  it("注册成功返回 201、用户摘要与会话 Cookie", async () => {
    const client = new TestClient()
    const res = await client.fetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: OWNER.email,
        username: OWNER.username,
        password: OWNER.password,
      }),
    })
    expect(res.status).toBe(201)

    const text = await res.text()
    const body = JSON.parse(text) as { user: Record<string, unknown> }
    expect(body.user.username).toBe(OWNER.username)
    expect(body.user.email).toBe(OWNER.email)
    expect(body.user.deepseek_configured).toBe(false)
    expect(body.user.deepseek_model).toBe("deepseek-v4-flash")
    expect(body.user.github_pat_configured).toBe(false)
    // 永不回传密码相关字段
    expect(text).not.toContain("password")
    expect(text).not.toContain(OWNER.password)

    expect(client.cookieHeader).toContain(SESSION_COOKIE_NAME)
  })

  it("username 缺省时取邮箱前缀", async () => {
    const client = new TestClient()
    const { status, body } = await client.post<{ user: { username: string } }>(
      "/api/auth/register",
      { email: "solo.owner@example.com", password: OWNER.password },
    )
    expect(status).toBe(201)
    expect(body.user.username).toBe("soloowner")
  })

  it("单用户实例：二次注册返回 409", async () => {
    const client = await registerOwner()
    const second = await new TestClient().post<{ code: string }>(
      "/api/auth/register",
      { email: "other@example.com", password: "anotherpass123" },
    )
    expect(second.status).toBe(409)
    expect(second.body.code).toBe("INSTANCE_INITIALIZED")
    expect(client.cookieHeader).toContain(SESSION_COOKIE_NAME)
  })

  it("缺少 email 或密码过短时返回 400", async () => {
    const client = new TestClient()
    const noEmail = await client.post<{ code: string }>("/api/auth/register", {
      username: "owner",
      password: OWNER.password,
    })
    expect(noEmail.status).toBe(400)
    expect(noEmail.body.code).toBe("VALIDATION_ERROR")

    const shortPassword = await client.post("/api/auth/register", {
      email: OWNER.email,
      password: "123",
    })
    expect(shortPassword.status).toBe(400)
  })

  it("注册后 seed 预置文件夹", async () => {
    const client = await registerOwner()
    const { status, body } = await client.json<{
      items: Array<{ name: string; slug: string; is_preset: boolean; count: number }>
    }>("/api/folders")
    expect(status).toBe(200)
    expect(body.items).toHaveLength(PRESET_FOLDERS.length)
    expect(body.items.every((f) => f.is_preset)).toBe(true)
    expect(body.items.map((f) => f.slug)).toContain("ai-llm")
    expect(body.items[0]!.count).toBe(0)
  })
})

describe("POST /api/auth/login", () => {
  it("使用 username 登录成功", async () => {
    await registerOwner()
    const client = new TestClient()
    const { status, body } = await client.post<{ user: Record<string, unknown> }>(
      "/api/auth/login",
      { username: OWNER.username, password: OWNER.password },
    )
    expect(status).toBe(200)
    expect(body.user.username).toBe(OWNER.username)
    expect(client.cookieHeader).toContain(SESSION_COOKIE_NAME)
  })

  it("username 字段也接受邮箱", async () => {
    await registerOwner()
    const client = new TestClient()
    const { status, body } = await client.post<{ user: { email: string } }>(
      "/api/auth/login",
      { username: OWNER.email, password: OWNER.password },
    )
    expect(status).toBe(200)
    expect(body.user.email).toBe(OWNER.email)
  })

  it("密码错误返回 401 且不泄露账号是否存在", async () => {
    await registerOwner()
    const client = new TestClient()
    const wrongPassword = await client.post<{ code: string; error: string }>(
      "/api/auth/login",
      { username: OWNER.username, password: "wrong-password" },
    )
    const unknownUser = await client.post<{ code: string; error: string }>(
      "/api/auth/login",
      { username: "ghost", password: OWNER.password },
    )

    expect(wrongPassword.status).toBe(401)
    expect(unknownUser.status).toBe(401)
    expect(wrongPassword.body.code).toBe("INVALID_CREDENTIALS")
    expect(wrongPassword.body.error).toBe(unknownUser.body.error)
    expect(client.cookieHeader).not.toContain(SESSION_COOKIE_NAME)
  })

  it("缺少 username 字段返回 400（不再接受 identifier）", async () => {
    await registerOwner()
    const { status, body } = await new TestClient().post<{ code: string }>(
      "/api/auth/login",
      { identifier: OWNER.username, password: OWNER.password },
    )
    expect(status).toBe(400)
    expect(body.code).toBe("VALIDATION_ERROR")
  })
})

describe("GET /api/me", () => {
  it("未登录返回 401", async () => {
    await registerOwner()
    const { status, body } = await new TestClient().json<{ code: string }>("/api/me")
    expect(status).toBe(401)
    expect(body.code).toBe("UNAUTHORIZED")
  })

  it("已登录返回扁平用户对象（不含密钥明文）", async () => {
    await registerOwner()
    const client = await loginClient()
    const res = await client.fetch("/api/me")
    const text = await res.text()
    const body = JSON.parse(text) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.username).toBe(OWNER.username)
    expect(body.email).toBe(OWNER.email)
    expect(body.deepseek_configured).toBe(false)
    expect(body.deepseek_last4).toBeNull()
    expect(body.deepseek_model).toBe("deepseek-v4-flash")
    expect(body.github_pat_configured).toBe(false)
    expect(body.public_browsing_enabled).toBe(false)
    expect(typeof body.created_at).toBe("string")
    expect(text).not.toContain("password")
    expect(Object.keys(body)).not.toContain("deepseek_api_key_encrypted")
  })
})

describe("受保护路由", () => {
  const protectedRoutes = [
    "/api/me",
    "/api/bookmarks",
    "/api/folders",
    "/api/tags",
    "/api/feed",
    "/api/export",
  ]

  it("未登录访问一律 401", async () => {
    await registerOwner()
    const client = new TestClient()
    for (const route of protectedRoutes) {
      const { status } = await client.json<{ code: string }>(route)
      expect(status, `${route} 应返回 401`).toBe(401)
    }
  })

  it("未登录的写操作同样 401", async () => {
    await registerOwner()
    const client = new TestClient()
    const create = await client.post("/api/bookmarks", { url: "owner/repo" })
    const settings = await client.put("/api/settings/deepseek", { apiKey: "sk-x" })
    expect(create.status).toBe(401)
    expect(settings.status).toBe(401)
  })
})

describe("POST /api/auth/logout", () => {
  it("登出后会话失效，再访问受保护路由为 401", async () => {
    await registerOwner()
    const client = await loginClient()

    const me = await client.json("/api/me")
    expect(me.status).toBe(200)

    const logout = await client.post<{ ok: boolean }>("/api/auth/logout")
    expect(logout.status).toBe(200)
    expect(logout.body.ok).toBe(true)
    expect(client.cookieHeader).not.toContain(SESSION_COOKIE_NAME)

    const after = await client.json<{ code: string }>("/api/me")
    expect(after.status).toBe(401)
  })

  it("被吊销的会话 token 无法复用", async () => {
    await registerOwner()
    const client = await loginClient()
    const stolen = client.cookieHeader

    await client.post("/api/auth/logout")

    const replay = await new TestClient().json<{ code: string }>("/api/me", {
      headers: { Cookie: stolen },
    })
    expect(replay.status).toBe(401)
  })

  it("未登录调用 logout 返回 401", async () => {
    await registerOwner()
    const { status } = await new TestClient().post("/api/auth/logout")
    expect(status).toBe(401)
  })
})

describe("未知 API 路径", () => {
  it("返回带 code 的 JSON 404（前端据此判断后端已就绪）", async () => {
    const res = await new TestClient().fetch("/api/not-a-real-route")
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("NOT_FOUND")
  })
})
