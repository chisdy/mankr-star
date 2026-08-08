import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const GITHUB = "https://api.github.com/repos/"

let client: TestClient
let outbound: OutboundMock

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  outbound.text(`${GITHUB}facebook/react/readme`, "# React")
  client = await registerOwner()
})

afterEach(() => {
  outbound.restore()
})

describe("GET /api/export?format=markdown", () => {
  it("返回可下载的 Markdown，含标题、链接、标签与笔记", async () => {
    const folder = await client.post<{ id: string }>("/api/folders", {
      name: "前端",
    })
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "facebook/react",
      notes: "第一行\n第二行",
    })
    expect(created.status).toBe(201)
    // 创建后的 AI 归类是异步的，改文件夹/标签放到它跑完之后
    const patched = await client.patch(`/api/bookmarks/${created.body.id}`, {
      folderId: folder.body.id,
      tagNames: ["ui", "库"],
    })
    expect(patched.status).toBe(200)

    const res = await client.fetch("/api/export?format=markdown")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(res.headers.get("content-disposition")).toContain(".md")

    const text = await res.text()
    expect(text).toContain("# Mankr Star")
    expect(text).toContain("## 前端")
    expect(text).toContain("### facebook/react")
    expect(text).toContain("<https://github.com/facebook/react>")
    expect(text).toContain("`ui`")
    // 笔记里的换行会被压平，避免撑成多段
    expect(text).toContain("> 第一行 第二行")
  })

  it("/api/export/markdown 同样可用，未归类收藏收尾", async () => {
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "facebook/react",
    })
    await client.patch(`/api/bookmarks/${created.body.id}`, { folderId: null })

    const res = await client.fetch("/api/export/markdown")
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain("## 未归类")
    expect(text).toContain("### facebook/react")
  })

  it("未登录访客拿不到导出", async () => {
    const guest = new TestClient()
    const res = await guest.fetch("/api/export?format=markdown")
    expect(res.status).toBe(401)
  })

  it("转义标题与笔记中的 Markdown/HTML 特殊字符", async () => {
    const created = await client.post<{ id: string }>("/api/bookmarks", {
      url: "facebook/react",
    })
    expect(created.status).toBe(201)
    const patched = await client.patch(`/api/bookmarks/${created.body.id}`, {
      title: "Evil </h1><script>alert(1)</script>",
      notes: "用 `反引号` 和 **加粗** 试注入",
      tagNames: ["tag`break"],
    })
    expect(patched.status).toBe(200)

    const res = await client.fetch("/api/export/markdown")
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain("<script>")
    expect(text).toContain("&lt;script&gt;")
    expect(text).toContain("\\*\\*加粗\\*\\*")
    expect(text).toContain("`tag'break`")
  })
})
