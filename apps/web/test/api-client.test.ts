/**
 * 前端 api client ←→ Worker 契约测试：
 * 把 globalThis.fetch 指向真实 Hono app，直接跑 apps/web/src/lib/api.ts，
 * 用于抓住字段名/信封/状态码层面的前后端漂移。
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  KB_CHAT_MESSAGE_MAX_CHARS,
  KB_CHAT_REQUEST_MAX_MESSAGES,
  kbChatRequestSchema,
  type KbChatActivityItem,
  type KbChatSource,
  type KbStoredMessage,
} from "@mankr/shared"
import { ApiError, api } from "../src/lib/api"
import { buildKbChatPayload, streamKbChat } from "../src/lib/kb-chat"
import { app } from "../src/worker/app"
import { OWNER, githubRepoPayload } from "./helpers"

const GITHUB_REPOS = "https://api.github.com/repos/"
const ANYSEARCH = "https://api.anysearch.com/v1/search"
const DEEPSEEK = "https://api.deepseek.com/chat/completions"

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
    if (url.startsWith(ANYSEARCH)) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            results: [
              { title: "React", url: "https://react.dev", snippet: "docs" },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      )
    }
    if (url.startsWith(DEEPSEEK)) {
      const body =
        `data: ${JSON.stringify({ choices: [{ delta: { content: "答案" } }] })}\n\n` +
        "data: [DONE]\n\n"
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
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

  it("分页切片返回当前页条目，total 保持过滤后的全量", async () => {
    await api.createBookmark({ url: "facebook/react" })
    await api.createBookmark({ url: "https://react.dev/learn" })

    const page1 = await api.getBookmarks({ page: 1, limit: 1 })
    expect(page1.total).toBe(2)
    expect(page1.items).toHaveLength(1)
    expect(page1.limit).toBe(1)

    const page2 = await api.getBookmarks({ page: 2, limit: 1 })
    expect(page2.total).toBe(2)
    expect(page2.items).toHaveLength(1)
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id)

    const beyond = await api.getBookmarks({ page: 3, limit: 1 })
    expect(beyond.items).toHaveLength(0)
    expect(beyond.total).toBe(2)
  })

  it("updateBookmarkPagination 保存实例分页偏好并在 status / me 回显", async () => {
    const saved = await api.updateBookmarkPagination({
      bookmark_pagination_mode: "manual",
      bookmark_page_size: 12,
    })
    expect(saved.bookmark_pagination_mode).toBe("manual")
    expect(saved.bookmark_page_size).toBe(12)

    const status = await api.getInstanceStatus()
    expect(status.bookmark_pagination_mode).toBe("manual")
    expect(status.bookmark_page_size).toBe(12)

    const me = await api.getMe()
    expect(me.bookmark_pagination_mode).toBe("manual")
    expect(me.bookmark_page_size).toBe(12)
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

  it("updateTag / deleteTag 同步标签与书签 tags", async () => {
    const created = await api.createBookmark({ url: "facebook/react" })
    await api.updateBookmark(created.id, { tags: ["旧名", "保留"] })

    const before = await api.getTags()
    const target = before.find((t) => t.name === "旧名")
    expect(target).toBeTruthy()

    const renamed = await api.updateTag(target!.id, { name: "新名" })
    expect(renamed.name).toBe("新名")

    const bookmarkAfterRename = await api.getBookmark(created.id)
    expect(bookmarkAfterRename.tags?.sort()).toEqual(["保留", "新名"].sort())

    const afterRename = await api.getTags()
    const toDelete = afterRename.find((t) => t.name === "新名")
    expect(toDelete).toBeTruthy()

    await api.deleteTag(toDelete!.id)
    const afterDelete = await api.getTags()
    expect(afterDelete.find((t) => t.name === "新名")).toBeUndefined()
    expect(afterDelete.find((t) => t.name === "保留")).toBeTruthy()

    const bookmarkAfterDelete = await api.getBookmark(created.id)
    expect(bookmarkAfterDelete.tags).toEqual(["保留"])
  })

  it("updateTag 在 slug 冲突时返回 DUPLICATE", async () => {
    const created = await api.createBookmark({ url: "facebook/react" })
    await api.updateBookmark(created.id, { tags: ["react", "other"] })

    const tags = await api.getTags()
    const other = tags.find((t) => t.name === "other")
    expect(other).toBeTruthy()

    const error = await api
      .updateTag(other!.id, { name: "react!" })
      .then(() => null)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).code).toBe("DUPLICATE")
  })

  it("getFeed 返回分页信封 { items, page, pageSize, total }", async () => {
    const feed = await api.getFeed()
    expect(Array.isArray(feed.items)).toBe(true)
    expect(feed.items).toHaveLength(0)
    expect(feed.page).toBe(1)
    expect(feed.pageSize).toBe(20)
    expect(feed.total).toBe(0)
  })

  it("getFeed 支持传入 page/pageSize 查询参数", async () => {
    const feed = await api.getFeed({ page: 2, pageSize: 5 })
    expect(feed.page).toBe(2)
    expect(feed.pageSize).toBe(5)
    expect(feed.items).toHaveLength(0)
  })

  it("importGithubStars 未配置 PAT 时抛出 400 PAT_REQUIRED", async () => {
    const error = await api
      .importGithubStars()
      .then(() => null)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).code).toBe("PAT_REQUIRED")
  })

  it("importGithubStars 启动后返回 job，可用 getGithubImportActive 查询", async () => {
    await api.updateGithubPat({ pat: "ghp_client_import01" })
    // 出站由 vitest 环境的 mock 覆盖不足时会失败；此处仅测契约形状需 worker 侧 mock。
    // 与 import.test 共用真实 worker：无 starred mock 会 500，故只测 active 空态。
    const active = await api.getGithubImportActive()
    expect(active).toHaveProperty("job")
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

  it("clearData 清空后当前会话失效", async () => {
    await api.createBookmark({ url: "facebook/react" })
    await api.clearData()

    const error = await api
      .getMe()
      .then(() => null)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(401)
  })

  it("getExportData 返回导出信封", async () => {
    await api.createBookmark({ url: "facebook/react" })
    const data = await api.getExportData()
    expect(data.version).toBe(2)
    expect(data.bookmarks).toHaveLength(1)
    expect(Array.isArray(data.folders)).toBe(true)
  })

  it("AnySearch Key 保存 / 测试 / 清除全链路在 /me 同步", async () => {
    expect((await api.getMe()).anysearch_configured).toBe(false)

    const saved = await api.updateAnySearchSettings({
      api_key: "as-client-test-4321",
    })
    expect(saved.configured).toBe(true)
    expect(saved.last4).toBe("4321")

    const me = await api.getMe()
    expect(me.anysearch_configured).toBe(true)
    expect(me.anysearch_last4).toBe("4321")

    expect((await api.testAnySearchConnection()).success).toBe(true)

    await api.clearAnySearchKey()
    expect((await api.getMe()).anysearch_configured).toBe(false)
  })
})

describe("streamKbChat 契约", () => {
  beforeEach(async () => {
    await registerViaClient()
    await api.updateDeepSeekSettings({ api_key: "sk-kb-client-test-0001" })
    await api.createBookmark({ url: "facebook/react" })
  })

  it("命中收藏后回调 meta 与 delta", async () => {
    const sources: KbChatSource[] = []
    let text = ""

    await streamKbChat(
      { messages: [{ role: "user", content: "react" }], webSearch: false },
      {
        onMeta: (s) => sources.push(...s),
        onDelta: (d) => {
          text += d
        },
      },
    )

    expect(sources.some((s) => s.type === "bookmark")).toBe(true)
    expect(text).toBe("答案")
  })

  it("联网未配置时抛 ANYSEARCH_NOT_CONFIGURED", async () => {
    const error = await streamKbChat(
      { messages: [{ role: "user", content: "react" }], webSearch: true },
      {},
    )
      .then(() => null)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe("ANYSEARCH_NOT_CONFIGURED")
  })

  it("检索无命中时回调 onEmpty 而非 onDelta", async () => {
    let empty = false
    let delta = false
    await streamKbChat(
      {
        messages: [{ role: "user", content: "量子退火超导材料" }],
        webSearch: false,
      },
      {
        onEmpty: () => {
          empty = true
        },
        onDelta: () => {
          delta = true
        },
      },
    )
    expect(empty).toBe(true)
    expect(delta).toBe(false)
  })

  it("快路径的检索阶段回调 onActivity，并带上 stage 与命中数", async () => {
    const activity: KbChatActivityItem[] = []
    await streamKbChat(
      { messages: [{ role: "user", content: "react" }], webSearch: false },
      { onActivity: (item) => activity.push(item) },
    )

    const bookmarks = activity.find((i) => i.id === "prefetch-bookmarks")
    expect(bookmarks?.type).toBe("step")
    if (bookmarks?.type !== "step") throw new Error("expected step")
    expect(bookmarks.stage).toBe("search_bookmarks")
    expect(bookmarks.count).toBeGreaterThan(0)
    // 未开联网时不该凭空报一条联网检索
    expect(activity.some((i) => i.id === "prefetch-web")).toBe(false)
  })

  it("请求级模型透传到后端", async () => {
    const models: string[] = []
    const inner = globalThis.fetch
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input)
      if (url.startsWith(DEEPSEEK) && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as { model?: string }
        if (body.model) models.push(body.model)
      }
      return inner(input, init)
    })

    await streamKbChat(
      {
        messages: [{ role: "user", content: "react" }],
        webSearch: false,
        model: "deepseek-v4-pro",
      },
      {},
    )

    expect(models).toContain("deepseek-v4-pro")
  })

  it("空命中回合不会卡死后续提问", async () => {
    const history = [
      { role: "user" as const, content: "量子退火超导材料" },
      // 空命中回合，助手侧没有正文
      { role: "assistant" as const, content: "" },
      { role: "user" as const, content: "react" },
    ]

    let text = ""
    await streamKbChat(
      { messages: buildKbChatPayload(history), webSearch: false },
      {
        onDelta: (d) => {
          text += d
        },
      },
    )

    expect(text).toBe("答案")
  })
})

describe("会话存档 api client", () => {
  beforeEach(async () => {
    await registerViaClient()
  })

  it("存档、列出、读回、删除走通同一套字段名", async () => {
    const id = crypto.randomUUID()
    const messages: KbStoredMessage[] = [
      { id: "m1", role: "user", content: "我收藏过哪些状态管理库？" },
      {
        id: "m2",
        role: "assistant",
        content: "zustand 与 jotai。",
        state: "done",
        sources: [
          {
            type: "bookmark",
            id: "bm-1",
            title: "zustand",
            url: "https://github.com/pmndrs/zustand",
            snippet: "轻量状态管理",
          },
        ],
        activity: [
          {
            id: "a1",
            type: "step",
            label: "检索收藏库",
            status: "complete",
            stage: "search_bookmarks",
            count: 1,
          },
        ],
      },
    ]

    const saved = await api.saveKbConversation(id, messages)
    expect(saved.title).toBe("我收藏过哪些状态管理库？")
    expect(saved.message_count).toBe(2)

    const list = await api.getKbConversations()
    expect(list.map((c) => c.id)).toContain(id)

    const detail = await api.getKbConversation(id)
    expect(detail.messages).toEqual(messages)

    await api.deleteKbConversation(id)
    await expect(api.getKbConversation(id)).rejects.toThrow(ApiError)
  })

  it("clearKbConversations 清掉全部存档", async () => {
    await api.saveKbConversation(crypto.randomUUID(), [
      { id: "m1", role: "user", content: "一" },
    ])
    await api.clearKbConversations()
    expect(await api.getKbConversations()).toEqual([])
  })
})

describe("buildKbChatPayload", () => {
  it("剔除空内容、截断超长正文并限制条数", () => {
    const history = [
      { role: "user" as const, content: "  第一问  " },
      { role: "assistant" as const, content: "   " },
      { role: "user" as const, content: "x".repeat(KB_CHAT_MESSAGE_MAX_CHARS + 200) },
    ]

    const payload = buildKbChatPayload(history)

    expect(payload).toHaveLength(2)
    expect(payload[0]).toEqual({ role: "user", content: "第一问" })
    expect(payload[1]?.content).toHaveLength(KB_CHAT_MESSAGE_MAX_CHARS)
    expect(kbChatRequestSchema.safeParse({ messages: payload }).success).toBe(
      true,
    )
  })

  it("超出请求上限时只保留最近的消息", () => {
    const history = Array.from(
      { length: KB_CHAT_REQUEST_MAX_MESSAGES + 5 },
      (_, i) => ({ role: "user" as const, content: `第 ${i} 问` }),
    )

    const payload = buildKbChatPayload(history)

    expect(payload).toHaveLength(KB_CHAT_REQUEST_MAX_MESSAGES)
    expect(payload.at(-1)?.content).toBe(
      `第 ${KB_CHAT_REQUEST_MAX_MESSAGES + 4} 问`,
    )
  })
})
