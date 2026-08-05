/**
 * 前端 api client ←→ Worker 契约测试：
 * 把 globalThis.fetch 指向真实 Hono app，直接跑 apps/web/src/lib/api.ts，
 * 用于抓住字段名/信封/状态码层面的前后端漂移。
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, api } from "../src/lib/api"
import { app } from "../src/worker/app"
import { OWNER, githubRepoPayload } from "./helpers"

const GITHUB_REPOS = "https://api.github.com/repos/"

let clientIp = 0

function installBrowserFetch() {
  const cookies = new Map<string, string>()
  clientIp += 1
  const ip = `10.20.0.${clientIp % 250}`

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    if (url.startsWith("/api/")) {
      const headers = new Headers(init?.headers)
      if (cookies.size > 0) {
        headers.set(
          "Cookie",
          Array.from(cookies.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        )
      }
      headers.set("cf-connecting-ip", ip)

      const ctx = createExecutionContext()
      const response = await app.request(url, { ...init, headers }, env, ctx)
      await waitOnExecutionContext(ctx)

      const setCookies =
        typeof response.headers.getSetCookie === "function"
          ? response.headers.getSetCookie()
          : [response.headers.get("set-cookie")].filter(Boolean as never)
      for (const cookie of setCookies) {
        if (!cookie) continue
        const [pair, ...attrs] = cookie.split(";")
        const eq = pair!.indexOf("=")
        if (eq < 0) continue
        const name = pair!.slice(0, eq).trim()
        const value = pair!.slice(eq + 1).trim()
        const expired = attrs.some((a) => a.trim().toLowerCase() === "max-age=0")
        if (expired || !value) cookies.delete(name)
        else cookies.set(name, value)
      }
      return response
    }

    if (url.startsWith(`${GITHUB_REPOS}facebook/react/readme`)) {
      return new Response("# React")
    }
    if (url.startsWith(`${GITHUB_REPOS}facebook/react`)) {
      return new Response(JSON.stringify(githubRepoPayload("facebook/react")), {
        headers: { "content-type": "application/json" },
      })
    }
    throw new Error(`未 mock 的出站请求: ${url}`)
  })
}

beforeEach(() => {
  installBrowserFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function registerViaClient() {
  return api.register({
    email: OWNER.email,
    username: OWNER.username,
    password: OWNER.password,
  })
}

describe("api client 鉴权", () => {
  it("register 解开 {user} 信封并返回扁平 User", async () => {
    const user = await registerViaClient()
    expect(user.username).toBe(OWNER.username)
    expect(user.email).toBe(OWNER.email)
    expect(user.deepseek_configured).toBe(false)
    expect(user.deepseek_model).toBe("deepseek-v4-flash")
  })

  it("getInstanceStatus 反映实例是否已初始化", async () => {
    expect((await api.getInstanceStatus()).initialized).toBe(false)
    await registerViaClient()
    expect((await api.getInstanceStatus()).initialized).toBe(true)
  })

  it("login 使用 username 字段（用户名或邮箱都可）", async () => {
    await registerViaClient()

    const byUsername = await api.login({
      username: OWNER.username,
      password: OWNER.password,
    })
    expect(byUsername.username).toBe(OWNER.username)

    const byEmail = await api.login({
      username: OWNER.email,
      password: OWNER.password,
    })
    expect(byEmail.email).toBe(OWNER.email)
  })

  it("密码错误抛出 401 ApiError，不被 mock 兜底吞掉", async () => {
    await registerViaClient()
    const error = await api
      .login({ username: OWNER.username, password: "nope" })
      .then(() => null)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(401)
    expect((error as ApiError).code).toBe("INVALID_CREDENTIALS")
    expect((error as ApiError).backendUnavailable).toBe(false)
  })

  it("二次注册抛出 409 ApiError", async () => {
    await registerViaClient()
    const error = await api
      .register({ email: "other@example.com", password: OWNER.password })
      .then(() => null)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).code).toBe("INSTANCE_INITIALIZED")
  })

  it("未登录时 getMe 抛出 401；logout 后同样 401", async () => {
    await registerViaClient()
    const me = await api.getMe()
    expect(me.username).toBe(OWNER.username)

    await api.logout()

    const error = await api
      .getMe()
      .then(() => null)
      .catch((e: unknown) => e)
    expect((error as ApiError).status).toBe(401)
  })
})

describe("api client 业务映射", () => {
  beforeEach(async () => {
    await registerViaClient()
  })

  it("getFolders 解开 {items} 并带 count", async () => {
    const folders = await api.getFolders()
    expect(Array.isArray(folders)).toBe(true)
    expect(folders.length).toBeGreaterThan(0)
    expect(folders[0]!.count).toBe(0)
    expect(folders[0]!.sort_order).toBeGreaterThan(0)
  })

  it("createFolder 接受英文 slug，中文名可省略 slug", async () => {
    const created = await api.createFolder({
      name: "UI 组件库扩展",
      slug: "ui-components-ext",
      color: "#3b82f6",
      description: "组件相关",
    })
    expect(created.id).toBeTruthy()
    expect(created.slug).toBe("ui-components-ext")

    const renamed = await api.updateFolder(created.id, { name: "组件库" })
    expect(renamed.name).toBe("组件库")

    await api.deleteFolder(created.id)
    const after = await api.getFolders()
    expect(after.find((f) => f.id === created.id)).toBeUndefined()
  })

  it("createBookmark 把 folder_id 映射为 folderId", async () => {
    const folders = await api.getFolders()
    const target = folders[0]!

    const bookmark = await api.createBookmark({
      url: "https://github.com/facebook/react",
      folder_id: target.id,
      notes: "写点笔记",
    })

    expect(bookmark.external_id).toBe("facebook/react")
    expect(bookmark.folder_id).toBe(target.id)
    expect(bookmark.notes).toBe("写点笔记")
  })

  it("getBookmarks 把 pageSize 映射回 limit 并补齐 folder_name", async () => {
    await api.createBookmark({ url: "facebook/react" })

    const list = await api.getBookmarks({ sort: "recent", page: 1, limit: 10 })
    expect(list.total).toBe(1)
    expect(list.page).toBe(1)
    expect(list.limit).toBe(10)
    expect(list.items[0]!.folder_name).toBeTruthy()
    expect(list.items[0]!.tags!.length).toBeGreaterThan(0)

    const byStars = await api.getBookmarks({ sort: "stars" })
    expect(byStars.items).toHaveLength(1)
    const byName = await api.getBookmarks({ sort: "name" })
    expect(byName.items).toHaveLength(1)
    const searched = await api.getBookmarks({ q: "react" })
    expect(searched.items).toHaveLength(1)
    const filtered = await api.getBookmarks({ q: "不存在的关键字" })
    expect(filtered.items).toHaveLength(0)
  })

  it("updateBookmark 把 tags/track_updates 映射为 tagNames/trackUpdates", async () => {
    const created = await api.createBookmark({ url: "facebook/react" })

    const updated = await api.updateBookmark(created.id, {
      summary_ai: "手动摘要",
      tags: ["手动标签", "react"],
      notes: "备注",
      track_updates: false,
      folder_id: null,
    })

    expect(updated.summary_ai).toBe("手动摘要")
    expect(updated.notes).toBe("备注")
    expect(updated.track_updates).toBe(false)
    expect(updated.folder_id).toBeNull()
    expect(updated.folder_name).toBeNull()
    expect(updated.tags!.sort()).toEqual(["react", "手动标签"].sort())

    const archived = await api.updateBookmark(created.id, { archived: true })
    expect(archived.archived_at).toBeTruthy()

    const defaultList = await api.getBookmarks({})
    expect(defaultList.total).toBe(0)
    const withArchived = await api.getBookmarks({ archived: true })
    expect(withArchived.total).toBe(1)
  })

  it("regenerateAi 返回最新收藏对象", async () => {
    const created = await api.createBookmark({ url: "facebook/react" })
    const refreshed = await api.regenerateAi(created.id)
    expect(refreshed.id).toBe(created.id)
    expect(["pending", "fallback", "done", "failed"]).toContain(refreshed.ai_status)
  })

  it("deleteBookmark 后 getBookmark 抛出真实 404", async () => {
    const created = await api.createBookmark({ url: "facebook/react" })
    await api.deleteBookmark(created.id)

    const error = await api
      .getBookmark(created.id)
      .then(() => null)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(404)
    expect((error as ApiError).code).toBe("NOT_FOUND")
  })

  it("getTags 把 usage_count 映射为 count", async () => {
    await api.createBookmark({ url: "facebook/react" })
    const tags = await api.getTags()
    expect(tags.length).toBeGreaterThan(0)
    expect(tags[0]!.count).toBeGreaterThan(0)
  })

  it("getFeed 返回数组", async () => {
    const feed = await api.getFeed()
    expect(Array.isArray(feed)).toBe(true)
    expect(feed).toHaveLength(0)
  })

  it("DeepSeek 设置映射 api_key→apiKey，响应映射为 configured/last4/model", async () => {
    const key = "sk-client-test-key-9876"
    const saved = await api.updateDeepSeekSettings({
      api_key: key,
      model: "deepseek-v4-pro",
    })
    expect(saved.configured).toBe(true)
    expect(saved.last4).toBe("9876")
    expect(saved.model).toBe("deepseek-v4-pro")

    const me = await api.getMe()
    expect(me.deepseek_configured).toBe(true)
    expect(me.deepseek_last4).toBe("9876")

    await api.clearDeepSeekKey()
    expect((await api.getMe()).deepseek_configured).toBe(false)
  })

  it("testDeepSeekConnection 未配置 Key 时抛出后端错误信息", async () => {
    const error = await api
      .testDeepSeekConnection()
      .then(() => null)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe("NOT_CONFIGURED")
  })

  it("updateGithubPat 映射响应为 configured", async () => {
    const res = await api.updateGithubPat({ pat: "ghp_clienttest0001" })
    expect(res.configured).toBe(true)
    expect(res.last4).toBe("0001")
    expect((await api.getMe()).github_pat_configured).toBe(true)
  })

  it("changePassword 映射为 camelCase 字段", async () => {
    await api.changePassword({
      current_password: OWNER.password,
      new_password: "another-strong-pass",
    })
    const relogin = await api.login({
      username: OWNER.username,
      password: "another-strong-pass",
    })
    expect(relogin.username).toBe(OWNER.username)
  })

  it("getExportData 返回导出信封", async () => {
    await api.createBookmark({ url: "facebook/react" })
    const data = await api.getExportData()
    expect(data.version).toBe(2)
    expect(data.bookmarks).toHaveLength(1)
    expect(Array.isArray(data.folders)).toBe(true)
  })
})
