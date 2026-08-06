import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test"
import { vi } from "vitest"
import { app } from "../src/worker/app"

let ipCounter = 0

/**
 * 带 Cookie 会话的测试客户端。
 * 每个实例使用独立的 client IP，避免共享进程内限流桶互相影响。
 */
export class TestClient {
  private cookies = new Map<string, string>()
  private readonly ip: string

  constructor() {
    ipCounter += 1
    this.ip = `10.10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`
  }

  get cookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ")
  }

  clearCookies(): void {
    this.cookies.clear()
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookies.size > 0) headers.set("Cookie", this.cookieHeader)
    headers.set("cf-connecting-ip", this.ip)
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }

    const ctx = createExecutionContext()
    const response = await app.request(path, { ...init, headers }, env, ctx)
    // 冲刷 waitUntil（收藏创建后的 AI 任务等）
    await waitOnExecutionContext(ctx)

    this.captureCookies(response)
    return response
  }

  async json<T = Record<string, unknown>>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: T }> {
    const res = await this.fetch(path, init)
    const text = await res.text()
    let body: unknown = {}
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = { raw: text }
      }
    }
    return { status: res.status, body: body as T }
  }

  post<T = Record<string, unknown>>(path: string, body?: unknown) {
    return this.json<T>(path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  put<T = Record<string, unknown>>(path: string, body?: unknown) {
    return this.json<T>(path, {
      method: "PUT",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  patch<T = Record<string, unknown>>(path: string, body?: unknown) {
    return this.json<T>(path, {
      method: "PATCH",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  delete<T = Record<string, unknown>>(path: string, body?: unknown) {
    return this.json<T>(path, {
      method: "DELETE",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  private captureCookies(response: Response): void {
    const raw =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean as never)

    for (const cookie of raw) {
      if (!cookie) continue
      const [pair, ...attrs] = cookie.split(";")
      const eq = pair!.indexOf("=")
      if (eq < 0) continue
      const name = pair!.slice(0, eq).trim()
      const value = pair!.slice(eq + 1).trim()

      const expired = attrs.some((a) => {
        const attr = a.trim().toLowerCase()
        if (attr === "max-age=0") return true
        if (attr.startsWith("expires=")) {
          const date = new Date(a.trim().slice("expires=".length))
          return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now()
        }
        return false
      })

      if (expired || value === "") this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
}

export const OWNER = {
  email: "owner@example.com",
  username: "owner",
  password: "password1234",
}

/** 注册唯一账号（注册成功即带上会话 Cookie） */
export async function registerOwner(client: TestClient = new TestClient()) {
  const res = await client.post("/api/auth/register", {
    email: OWNER.email,
    username: OWNER.username,
    password: OWNER.password,
  })
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return client
}

/** 已登录客户端（新会话，与注册时的会话独立） */
export async function loginClient(username = OWNER.username) {
  const client = new TestClient()
  const res = await client.post("/api/auth/login", {
    username,
    password: OWNER.password,
  })
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return client
}

type Responder = (request: Request) => Response | Promise<Response>

export interface OutboundMock {
  /** 按 URL 前缀注册响应（后注册的优先） */
  on(urlPrefix: string, responder: Responder): OutboundMock
  json(urlPrefix: string, body: unknown, status?: number): OutboundMock
  text(urlPrefix: string, body: string, status?: number): OutboundMock
  calls: string[]
  restore(): void
}

/**
 * 拦截 Worker 的所有出站 fetch（GitHub / DeepSeek）。
 * 未注册的出站请求会抛错，保证测试不触达真实外网。
 */
export function mockOutboundFetch(): OutboundMock {
  const routes: Array<{ prefix: string; responder: Responder }> = []
  const calls: string[] = []

  const mock: OutboundMock = {
    calls,
    on(urlPrefix, responder) {
      routes.unshift({ prefix: urlPrefix, responder })
      return mock
    },
    json(urlPrefix, body, status = 200) {
      return mock.on(
        urlPrefix,
        () =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
      )
    },
    text(urlPrefix, body, status = 200) {
      return mock.on(
        urlPrefix,
        () =>
          new Response(body, {
            status,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      )
    },
    restore() {
      vi.unstubAllGlobals()
    },
  }

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    calls.push(request.url)
    const route = routes.find((r) => request.url.startsWith(r.prefix))
    if (!route) {
      throw new Error(`未 mock 的出站请求: ${request.method} ${request.url}`)
    }
    return route.responder(request)
  })

  return mock
}

export function githubRepoPayload(
  fullName: string,
  overrides: Record<string, unknown> = {},
) {
  const [owner, repo] = fullName.split("/")
  return {
    full_name: fullName,
    name: repo,
    owner: { login: owner },
    description: `${repo} description`,
    language: "TypeScript",
    stargazers_count: 1234,
    forks_count: 56,
    license: { spdx_id: "MIT" },
    homepage: `https://${repo}.dev`,
    default_branch: "main",
    topics: ["react", "ui"],
    pushed_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-02T00:00:00Z",
    html_url: `https://github.com/${fullName}`,
    archived: false,
    disabled: false,
    size: 1024,
    ...overrides,
  }
}
