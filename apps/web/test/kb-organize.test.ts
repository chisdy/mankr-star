import type { KbChatStreamEvent, KbOrganizeProposal } from "@mankr/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildDuplicateHints, capLines } from "../src/worker/lib/kb-folders"
import {
  allocateOrganizeSlug,
  organizeFolderId,
  proposalFromSimulation,
  simulateOrganize,
  type OrganizeBookmark,
  type OrganizeDraft,
  type OrganizeFolder,
  type OrganizeWorld,
} from "../src/worker/lib/kb-organize"
import {
  TestClient,
  githubRepoPayload,
  mockOutboundFetch,
  registerOwner,
  type OutboundMock,
} from "./helpers"

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

function folder(
  n: number,
  name: string,
  parent: number | null,
  depth: number
): OrganizeFolder {
  const folderId = id(n)
  const parentId = parent === null ? null : id(parent)
  const path =
    parentId === null ? `/${folderId}/` : `/${id(parent!)}/${folderId}/`
  return { id: folderId, name, slug: name, parentId, depth, path }
}

function bookmark(
  n: number,
  folderN: number | null,
  extra: Partial<OrganizeBookmark> = {}
): OrganizeBookmark {
  return {
    id: id(100 + n),
    title: `收藏 ${n}`,
    folderId: folderN === null ? null : id(folderN),
    deleted: false,
    archived: false,
    ...extra,
  }
}

function world(
  folders: OrganizeFolder[],
  bookmarks: OrganizeBookmark[] = []
): OrganizeWorld {
  return { folders, bookmarks }
}

describe("整理方案模拟", () => {
  it("先移走子文件夹再合并可以通过，收藏进目标", () => {
    const before = world(
      [
        folder(1, "父", null, 0),
        folder(2, "子", 1, 1),
        folder(3, "目标", null, 0),
      ],
      [bookmark(1, 1)]
    )
    const result = simulateOrganize(before, [
      moveFolder("op-1", 2, null),
      merge("op-2", 1, 3),
    ])

    expect(result.ops.map((op) => op.type)).toEqual([
      "move_folder",
      "merge_folders",
    ])
    expect(result.skipped).toEqual([])
    expect(result.folders.some((item) => item.id === id(1))).toBe(false)
    expect(result.bookmarks[0]?.folderId).toBe(id(3))
    expect(proposalFromSimulation("pending", result)?.ops).toHaveLength(2)
  })

  it("子文件夹还在时拒绝合并", () => {
    const result = simulateOrganize(
      world([
        folder(1, "父", null, 0),
        folder(2, "子", 1, 1),
        folder(3, "目标", null, 0),
      ]),
      [merge("op-1", 1, 3)]
    )
    expect(result.ops).toEqual([])
    expect(result.skipped[0]?.reason).toContain("子文件夹")
    expect(result.folders).toHaveLength(3)
  })

  it("互相合并的两夹都拒绝，不删任何一个", () => {
    const result = simulateOrganize(
      world([folder(1, "甲", null, 0), folder(2, "乙", null, 0)]),
      [merge("op-1", 1, 2), merge("op-2", 2, 1)]
    )
    expect(result.ops).toEqual([])
    expect(result.skipped.map((item) => item.reason)).toEqual([
      "合并会形成循环",
      "合并会形成循环",
    ])
    expect(result.folders).toHaveLength(2)
  })

  it("合并把未删除收藏（含已归档）移走，软删收藏只是脱离文件夹", () => {
    const result = simulateOrganize(
      world(
        [folder(1, "来源", null, 0), folder(2, "目标", null, 0)],
        [bookmark(1, 1, { archived: true }), bookmark(2, 1, { deleted: true })]
      ),
      [merge("op-1", 1, 2)]
    )
    expect(result.ops).toHaveLength(1)
    expect(result.bookmarks.find((item) => item.id === id(101))?.folderId).toBe(
      id(2)
    )
    expect(
      result.bookmarks.find((item) => item.id === id(102))?.folderId
    ).toBeNull()
  })

  it("新建 id 是 UUID，同一 id 再模拟不会多出一个文件夹", async () => {
    const folderId = await organizeFolderId("message-1", "op-1")
    expect(folderId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(await organizeFolderId("message-1", "op-1")).toBe(folderId)

    const draft = create("op-1", "k1", "规整夹")
    const options = {
      createIds: new Map([["k1", folderId]]),
      allocateSlug: allocateOrganizeSlug,
    }
    const first = simulateOrganize(world([]), [draft], options)
    const second = simulateOrganize(world(first.folders), [draft], options)
    expect(first.folders.filter((item) => item.id === folderId)).toHaveLength(1)
    expect(
      second.folders.filter((item) => item.name === "规整夹")
    ).toHaveLength(1)
    expect(second.ops[0]).toMatchObject({
      type: "create_folder",
      reuseId: folderId,
    })
  })

  it("同一次方案里后一个新建能看见前一个占掉的 slug", async () => {
    const firstId = await organizeFolderId("message-1", "op-1")
    const secondId = await organizeFolderId("message-1", "op-2")
    const result = simulateOrganize(
      world([]),
      [create("op-1", "a", "甲"), create("op-2", "b", "乙")],
      {
        createIds: new Map([
          ["a", firstId],
          ["b", secondId],
        ]),
        allocateSlug: allocateOrganizeSlug,
      }
    )
    expect(result.folders.map((item) => item.slug).sort()).toEqual([
      "folder",
      "folder-2",
    ])
  })

  it("同级同名改为引用已有文件夹", () => {
    const result = simulateOrganize(world([folder(1, "笔记", null, 0)]), [
      create("op-1", "k1", "笔 记"),
    ])
    expect(result.folders).toHaveLength(1)
    expect(result.ops[0]).toMatchObject({
      type: "create_folder",
      reuseId: id(1),
    })
  })

  it("取消新建后，把收藏移进那个临时 key 会被拒绝", () => {
    const result = simulateOrganize(world([], [bookmark(1, null)]), [
      {
        opId: "op-2",
        reason: "归进去",
        type: "move_bookmarks",
        bookmarkIds: [id(101)],
        folderId: null,
        folderKey: "k1",
      },
    ])
    expect(result.ops).toEqual([])
    expect(result.skipped[0]?.reason).toContain("还没")
    expect(result.bookmarks[0]?.folderId).toBeNull()
  })

  it("移动到已有相同 slug 的位置时加后缀，没有冲突则保持原 slug", () => {
    const parent = folder(1, "parent", null, 0)
    const sibling = { ...folder(2, "sibling", 1, 1), slug: "folder" }
    const moving = { ...folder(3, "moving", null, 0), slug: "folder" }
    const kept = { ...folder(4, "kept", null, 0), slug: "keep-me" }
    const result = simulateOrganize(world([parent, sibling, moving, kept]), [
      moveFolder("op-1", 3, 1),
      moveFolder("op-2", 4, 1),
    ])

    expect(result.skipped).toEqual([])
    expect(result.folders.find((item) => item.id === id(3))).toMatchObject({
      parentId: id(1),
      slug: "folder-2",
    })
    expect(result.folders.find((item) => item.id === id(4))).toMatchObject({
      parentId: id(1),
      slug: "keep-me",
    })

    const rooted = { ...folder(5, "rooted", null, 0), slug: "folder" }
    const nested = { ...folder(6, "nested", 1, 1), slug: "folder" }
    const lifted = simulateOrganize(
      world([folder(1, "parent", null, 0), rooted, nested]),
      [moveFolder("op-1", 6, null)]
    )
    expect(lifted.folders.find((item) => item.id === id(6))).toMatchObject({
      parentId: null,
      slug: "folder-2",
    })
  })
})

describe("疑似重复只是提示", () => {
  it("归一化相同、以及较短名称被包含且两边都有收藏时才提示", () => {
    const hints = buildDuplicateHints([
      { name: "React", path: "前端 / React", count: 2 },
      { name: "react", path: "其他 / react", count: 1 },
      { name: "前端", path: "前端", count: 3 },
      { name: "前端工程", path: "前端工程", count: 1 },
      { name: "空夹", path: "空夹", count: 0 },
      { name: "空夹子", path: "空夹子", count: 2 },
    ])
    expect(hints.some((hint) => hint.includes("归一化后相同"))).toBe(true)
    expect(
      hints.some((hint) => hint.includes("包含") && hint.includes("前端工程"))
    ).toBe(true)
    expect(hints.some((hint) => hint.includes("空夹子"))).toBe(false)
    expect(hints.join("\n")).not.toMatch(/合并|merge/)
  })

  it("紧凑列表自己截断，不把超长结果整段塞回去", () => {
    const text = capLines(
      [
        "标题",
        ...Array.from({ length: 30 }, (_, i) => `行 ${i} ${"甲".repeat(80)}`),
      ],
      500
    )
    expect(text.length).toBeLessThan(700)
    expect(text).toContain("另有")
  })
})

const GITHUB = "https://api.github.com/repos/"
const DEEPSEEK = "https://api.deepseek.com/chat/completions"
const DEEPSEEK_KEY = "sk-test-deepseek-key-abcdef1234"

let client: TestClient
let outbound: OutboundMock

function deepseekStream(text: string): Response {
  const chunks = [
    ...Array.from(text).map((ch) =>
      JSON.stringify({ choices: [{ delta: { content: ch } }] })
    ),
    JSON.stringify({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    }),
  ]
  return new Response(
    chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n",
    {
      headers: { "content-type": "text/event-stream" },
    }
  )
}

function jsonResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { headers: { "content-type": "application/json" } }
  )
}

function toolCallStream(name: string, args: string): Response {
  const chunks = [
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_org",
                type: "function",
                function: { name, arguments: args },
              },
            ],
          },
        },
      ],
    }),
    JSON.stringify({
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  ]
  return new Response(
    chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n",
    {
      headers: { "content-type": "text/event-stream" },
    }
  )
}

function queueDeepSeek(responses: Array<() => Response>) {
  let i = 0
  outbound.on(DEEPSEEK, () => {
    const next = responses[Math.min(i, responses.length - 1)]!
    i += 1
    return next()
  })
}

async function readEvents(res: Response): Promise<KbChatStreamEvent[]> {
  const text = await res.text()
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data:"))
    .map((block) => JSON.parse(block.slice(5).trim()) as KbChatStreamEvent)
}

beforeEach(async () => {
  outbound = mockOutboundFetch()
  outbound.json(`${GITHUB}facebook/react`, githubRepoPayload("facebook/react"))
  outbound.json(`${GITHUB}vuejs/core`, githubRepoPayload("vuejs/core"))
  outbound.text(
    `${GITHUB}facebook/react/readme`,
    "# React\n用于构建用户界面的状态管理与渲染库"
  )
  outbound.text(`${GITHUB}vuejs/core/readme`, "# Vue")
  client = await registerOwner()
  await client.put("/api/settings/deepseek", { apiKey: DEEPSEEK_KEY })
})

afterEach(() => {
  outbound.restore()
})

describe("当前文件夹快照", () => {
  it("条数与收藏列表一致，子文件夹里的算进去，已归档的不算，超长文本保留换行", async () => {
    const parent = await client.post<{ id: string }>("/api/folders", {
      name: "快照父夹",
      slug: "snap-parent",
      description: `${"甲".repeat(220)}SNAPSHOT_TAIL`,
    })
    const child = await client.post<{ id: string }>("/api/folders", {
      name: "快照子夹",
      slug: "snap-child",
      parentId: parent.body.id,
    })
    const kept = await client.post<{ id: string }>("/api/bookmarks", {
      url: "vuejs/core",
      folderId: child.body.id,
    })
    const archived = await client.post<{ id: string }>("/api/bookmarks", {
      url: "facebook/react",
      folderId: parent.body.id,
    })
    expect(parent.status).toBe(201)
    await client.patch(`/api/bookmarks/${kept.body.id}`, {
      title: "子树里的收藏",
      summaryAi: "短摘要标记",
      tagNames: ["子树标签"],
    })
    await client.patch(`/api/bookmarks/${archived.body.id}`, {
      title: "已归档不该出现",
      archived: true,
    })

    const listed = await client.json<{ total: number }>(
      `/api/bookmarks?folderId=${parent.body.id}`
    )
    expect(listed.body.total).toBe(1)

    const prompts: string[] = []
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as {
        messages: Array<{ role: string; content: string }>
      }
      prompts.push(body.messages.map((message) => message.content).join("\n"))
      return deepseekStream("在子文件夹里")
    })

    const res = await client.fetch("/api/kb/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "这些文件夹" }],
        context: { folderId: parent.body.id, folderName: "客户端伪造名" },
      }),
    })
    expect(res.status).toBe(200)
    await res.text()

    const prompt = prompts[0] ?? ""
    const start = prompt.indexOf("<当前文件夹快照>")
    const end = prompt.indexOf("</当前文件夹快照>")
    const body = prompt.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(body).toContain("\n")
    expect(body).toContain("SNAPSHOT_TAIL")
    expect(body).toContain("子树里的收藏")
    expect(body).toContain("短摘要标记")
    expect(body).toContain("子树标签")
    expect(body).toContain("快照子夹")
    expect(body).toContain(
      `子树收藏（未删除、未归档）：${listed.body.total} 条`
    )
    expect(body).not.toContain("已归档不该出现")
    expect(body).not.toContain("渲染库")
    expect(prompt).not.toContain("客户端伪造名")
  })
})

describe("确认后才写入", () => {
  it("提案只走卡片，对话本身不改文件夹", async () => {
    const created = await client.post<{ id: string }>("/api/folders", {
      name: "待改名",
      slug: "rename-me",
    })
    queueDeepSeek([
      () => jsonResponse({ steps: ["看文件夹", "出方案"] }),
      () =>
        toolCallStream(
          "propose_organize",
          JSON.stringify({
            ops: [
              {
                type: "rename_folder",
                folderId: created.body.id,
                name: "已经改好",
                reason: "更清楚",
              },
            ],
          })
        ),
      () => deepseekStream("请在卡片上点击应用所选"),
    ])

    const events = await readEvents(
      await client.fetch("/api/kb/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "规整一下" }],
        }),
      })
    )
    expect(events.some((event) => event.type === "organize_proposal")).toBe(
      true
    )
    const folders = await client.json<{ items: Array<{ name: string }> }>(
      "/api/folders"
    )
    expect(folders.body.items.some((item) => item.name === "待改名")).toBe(true)
    expect(folders.body.items.some((item) => item.name === "已经改好")).toBe(
      false
    )
  })

  it("方案没存上时不写库", async () => {
    const res = await client.post("/api/kb/organize", {
      conversationId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      opIds: ["op-1"],
    })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ code: "ORGANIZE_NOT_SAVED" })
  })

  it("新建的 id 可重复应用，不会多出一个文件夹", async () => {
    const conversationId = crypto.randomUUID()
    const messageId = crypto.randomUUID()
    const proposal: KbOrganizeProposal = {
      status: "pending",
      ops: [
        {
          id: "op-1",
          type: "create_folder",
          key: "k1",
          name: "规整夹",
          parentId: null,
          parentKey: null,
          reuseId: null,
          placeLabel: "根目录",
          reason: "归类",
        },
      ],
    }
    const saved = await client.put(`/api/kb/conversations/${conversationId}`, {
      messages: [
        { id: crypto.randomUUID(), role: "user", content: "整理一下这个库" },
        {
          id: messageId,
          role: "assistant",
          content: "请在卡片上确认",
          state: "done",
          organize: proposal,
        },
      ],
    })
    expect(saved.status).toBe(200)

    const first = await client.post<{ organize: KbOrganizeProposal }>(
      "/api/kb/organize",
      {
        conversationId,
        messageId,
        opIds: ["op-1"],
      }
    )
    expect(first.status).toBe(200)
    expect(first.body.organize.status).toBe("applied")

    const expectedId = await organizeFolderId(messageId, "op-1")
    const after = await foldersNamed("规整夹")
    expect(after.map((item) => item.id)).toEqual([expectedId])

    const second = await client.post("/api/kb/organize", {
      conversationId,
      messageId,
      opIds: ["op-1"],
    })
    expect(second.status).toBe(200)
    expect(await foldersNamed("规整夹")).toHaveLength(1)

    const detail = await client.json<{
      messages: Array<{ organize?: KbOrganizeProposal }>
    }>(`/api/kb/conversations/${conversationId}`)
    expect(detail.body.messages.at(-1)?.organize?.status).toBe("applied")
  })

  it("取消新建后留下的归属调整不会写入，也不会建出文件夹", async () => {
    const folderRes = await client.post<{ id: string }>("/api/folders", {
      name: "原夹",
      slug: "origin-box",
    })
    const bookmarkRes = await client.post<{ id: string }>("/api/bookmarks", {
      url: "vuejs/core",
      folderId: folderRes.body.id,
    })
    const conversationId = crypto.randomUUID()
    const messageId = crypto.randomUUID()
    const proposal: KbOrganizeProposal = {
      status: "pending",
      ops: [
        {
          id: "op-1",
          type: "create_folder",
          key: "k1",
          name: "不该出现的夹",
          parentId: null,
          parentKey: null,
          reuseId: null,
          placeLabel: "根目录",
          reason: "新建",
        },
        {
          id: "op-2",
          type: "move_bookmarks",
          bookmarkIds: [bookmarkRes.body.id],
          titles: ["Vue"],
          extraCount: 0,
          folderId: null,
          folderKey: "k1",
          fromLabel: "原夹",
          toLabel: "不该出现的夹",
          reason: "挪进去",
        },
      ],
    }
    await client.put(`/api/kb/conversations/${conversationId}`, {
      messages: [
        { id: crypto.randomUUID(), role: "user", content: "整理归属" },
        {
          id: messageId,
          role: "assistant",
          content: "请确认",
          state: "done",
          organize: proposal,
        },
      ],
    })

    const applied = await client.post<{ organize: KbOrganizeProposal }>(
      "/api/kb/organize",
      {
        conversationId,
        messageId,
        opIds: ["op-2"],
      }
    )
    expect(applied.status).toBe(200)
    expect(applied.body.organize.status).toBe("pending")
    expect(applied.body.organize.ops).toEqual([])
    expect(applied.body.organize.skipped?.[0]?.reason).toContain("还没")
    expect(await foldersNamed("不该出现的夹")).toEqual([])

    const saved = await client.json<{
      messages: Array<{ organize?: KbOrganizeProposal }>
    }>(`/api/kb/conversations/${conversationId}`)
    expect(saved.body.messages.at(-1)?.organize?.status).toBe("pending")

    const detail = await client.json<{ folder_id: string }>(
      `/api/bookmarks/${bookmarkRes.body.id}`
    )
    expect(detail.body.folder_id).toBe(folderRes.body.id)
  })

  it("移动文件夹后路径和列表一起变", async () => {
    const parent = await client.post<{ id: string }>("/api/folders", {
      name: "移动前的父夹",
      slug: "move-parent",
    })
    const child = await client.post<{ id: string }>("/api/folders", {
      name: "被挪走的子夹",
      slug: "move-child",
      parentId: parent.body.id,
    })
    const bookmarkRes = await client.post<{ id: string }>("/api/bookmarks", {
      url: "facebook/react",
      folderId: child.body.id,
    })
    const conversationId = crypto.randomUUID()
    const messageId = crypto.randomUUID()
    const proposal: KbOrganizeProposal = {
      status: "pending",
      ops: [
        {
          id: "op-1",
          type: "move_folder",
          folderId: child.body.id,
          parentId: null,
          parentKey: null,
          fromLabel: "移动前的父夹 / 被挪走的子夹",
          toLabel: "根目录",
          reason: "升到根上",
        },
      ],
    }
    await client.put(`/api/kb/conversations/${conversationId}`, {
      messages: [
        { id: crypto.randomUUID(), role: "user", content: "调整文件夹" },
        {
          id: messageId,
          role: "assistant",
          content: "请确认",
          state: "done",
          organize: proposal,
        },
      ],
    })

    const applied = await client.post("/api/kb/organize", {
      conversationId,
      messageId,
      opIds: ["op-1"],
    })
    expect(applied.status).toBe(200)

    const folders = await client.json<{
      items: Array<{
        id: string
        parent_id: string | null
        path: string
        path_label: string
      }>
    }>("/api/folders")
    const moved = folders.body.items.find((item) => item.id === child.body.id)
    expect(moved).toMatchObject({
      parent_id: null,
      path: `/${child.body.id}/`,
      path_label: "被挪走的子夹",
    })

    const parentList = await client.json<{ total: number }>(
      `/api/bookmarks?folderId=${parent.body.id}`
    )
    const childList = await client.json<{ total: number }>(
      `/api/bookmarks?folderId=${child.body.id}`
    )
    expect(parentList.body.total).toBe(0)
    expect(childList.body.total).toBe(1)

    const detail = await client.json<{ folder_id: string }>(
      `/api/bookmarks/${bookmarkRes.body.id}`
    )
    expect(detail.body.folder_id).toBe(child.body.id)
  })

  it("同级 slug 已被占用时仍能移动，并改成不冲突的后缀", async () => {
    const parentA = await client.post<{ id: string }>("/api/folders", {
      name: "甲父",
      slug: "slug-parent-a",
    })
    const parentB = await client.post<{ id: string }>("/api/folders", {
      name: "乙父",
      slug: "slug-parent-b",
    })
    await client.post("/api/folders", {
      name: "留下的",
      slug: "folder",
      parentId: parentA.body.id,
    })
    const moving = await client.post<{ id: string }>("/api/folders", {
      name: "挪过去的",
      slug: "folder",
      parentId: parentB.body.id,
    })
    await client.post("/api/folders", {
      name: "根上的",
      slug: "shared-root",
    })
    const nested = await client.post<{ id: string }>("/api/folders", {
      name: "升到根的",
      slug: "shared-root",
      parentId: parentB.body.id,
    })

    const moveUnderSibling = await applyFolderMove(
      moving.body.id,
      parentA.body.id
    )
    expect(moveUnderSibling.status).toBe(200)
    const liftToRoot = await applyFolderMove(nested.body.id, null)
    expect(liftToRoot.status).toBe(200)

    const folders = await client.json<{
      items: Array<{ id: string; parent_id: string | null; slug: string }>
    }>("/api/folders")
    expect(
      folders.body.items.find((item) => item.id === moving.body.id)
    ).toMatchObject({
      parent_id: parentA.body.id,
      slug: "folder-2",
    })
    expect(
      folders.body.items.find((item) => item.id === nested.body.id)
    ).toMatchObject({
      parent_id: null,
      slug: "shared-root-2",
    })
  })

  it("检查文件夹时每个文件夹只取少量标题，查询本身能跑完", async () => {
    const created = await client.post<{ id: string }>("/api/folders", {
      name: "样本夹",
      slug: "sample-box",
    })
    expect(created.status).toBe(201)

    const prompts: string[] = []
    outbound.on(DEEPSEEK, async (req) => {
      const body = (await req.json()) as {
        messages?: Array<{ content?: string | null }>
      }
      prompts.push(
        (body.messages ?? []).map((message) => message.content ?? "").join("\n")
      )
      if (prompts.length === 1) return jsonResponse({ steps: ["看结构"] })
      if (prompts.length === 2) return toolCallStream("inspect_library", "{}")
      return deepseekStream("看过了")
    })

    const res = await client.fetch("/api/kb/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "文件夹是否合理" }],
      }),
    })
    expect(res.status).toBe(200)
    await res.text()
    expect(prompts.at(-1)).toContain("样本夹")
    expect(prompts.at(-1)).not.toContain("文件夹检查失败")
  })
})

function moveFolder(
  opId: string,
  folderN: number,
  parent: number | null
): OrganizeDraft {
  return {
    opId,
    reason: "调整层级",
    type: "move_folder",
    folderId: id(folderN),
    parentId: parent === null ? null : id(parent),
    parentKey: null,
  }
}

function merge(opId: string, source: number, target: number): OrganizeDraft {
  return {
    opId,
    reason: "合并重复",
    type: "merge_folders",
    sourceId: id(source),
    targetId: id(target),
    targetKey: null,
  }
}

function create(opId: string, key: string, name: string): OrganizeDraft {
  return {
    opId,
    reason: "新建",
    type: "create_folder",
    key,
    name,
    parentId: null,
    parentKey: null,
  }
}

async function applyFolderMove(folderId: string, parentId: string | null) {
  const conversationId = crypto.randomUUID()
  const messageId = crypto.randomUUID()
  const proposal: KbOrganizeProposal = {
    status: "pending",
    ops: [
      {
        id: "op-1",
        type: "move_folder",
        folderId,
        parentId,
        parentKey: null,
        fromLabel: "原来的位置",
        toLabel: parentId ? "目标" : "根目录",
        reason: "换个位置",
      },
    ],
  }
  await client.put(`/api/kb/conversations/${conversationId}`, {
    messages: [
      { id: crypto.randomUUID(), role: "user", content: "移动文件夹" },
      {
        id: messageId,
        role: "assistant",
        content: "请确认",
        state: "done",
        organize: proposal,
      },
    ],
  })
  return client.post<{ organize: KbOrganizeProposal }>("/api/kb/organize", {
    conversationId,
    messageId,
    opIds: ["op-1"],
  })
}

async function foldersNamed(name: string) {
  const res = await client.json<{ items: Array<{ id: string; name: string }> }>(
    "/api/folders"
  )
  return res.body.items.filter((item) => item.name === name)
}
