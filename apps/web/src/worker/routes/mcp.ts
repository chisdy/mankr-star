import {
  bookmarkTags,
  bookmarks,
  folders,
  tags,
} from "@mankr/db"
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm"
import type { Context } from "hono"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { hasScope } from "../lib/api-tokens"
import { queryBookmarkIdsByFts } from "../lib/bookmark-fts"
import { syncBookmarkTags } from "../lib/ai-service"
import { nowIso } from "../lib/utils"
import { requireAuth } from "../middleware/auth"

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

const TOOLS = [
  {
    name: "search_bookmarks",
    description: "Search bookmarks by keyword / hybrid (FTS + embedding).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: {
          type: "number",
          description: "Max results (1-50)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_bookmark",
    description: "Get a bookmark by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Bookmark UUID" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_folders",
    description: "List folders (id, name, parent_id, path).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_tags",
    description: "List tags with usage counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "save_bookmark",
    description:
      "Save a URL via POST /api/bookmarks (requires write scope). Pass Authorization Bearer.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        notes: { type: "string" },
        folderId: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "update_bookmark",
    description:
      "Update bookmark: folderId, notes, archived, tagNames (requires write).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        folderId: { type: ["string", "null"] },
        notes: { type: ["string", "null"] },
        archived: { type: "boolean" },
        tagNames: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
  },
] as const

function rpcResult(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result }
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  }
}

export const mcpRoutes = new Hono<AppEnv>()

mcpRoutes.use("/mcp", requireAuth)
mcpRoutes.use("/mcp/*", requireAuth)

mcpRoutes.get("/mcp", (c) => {
  return c.json({
    name: "mankr-star",
    version: "1.0.0",
    transport: "streamable-http",
    tools: TOOLS.map((t) => t.name),
  })
})

mcpRoutes.post("/mcp", async (c) => {
  let body: JsonRpcRequest
  try {
    body = (await c.req.json()) as JsonRpcRequest
  } catch {
    return c.json(rpcError(null, -32700, "Parse error"), 400)
  }

  const method = body.method ?? ""
  const id = body.id

  if (method === "initialize") {
    return c.json(
      rpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mankr-star", version: "1.0.0" },
      }),
    )
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return c.body(null, 204)
  }

  if (method === "tools/list") {
    return c.json(rpcResult(id, { tools: TOOLS }))
  }

  if (method === "ping") {
    return c.json(rpcResult(id, {}))
  }

  if (method === "tools/call") {
    const params = body.params ?? {}
    const name = String(params.name ?? "")
    const args = (params.arguments ?? {}) as Record<string, unknown>
    try {
      const text = await callTool(c, name, args)
      return c.json(
        rpcResult(id, {
          content: [{ type: "text", text }],
        }),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json(
        rpcResult(id, {
          content: [{ type: "text", text: message }],
          isError: true,
        }),
      )
    }
  }

  return c.json(rpcError(id, -32601, `Method not found: ${method}`), 404)
})

function assertWrite(c: Context<AppEnv>) {
  if (
    c.get("authMethod") === "token" &&
    !hasScope(c.get("tokenScopes") ?? [], "write")
  ) {
    throw new Error("Token missing write scope")
  }
}

async function callTool(
  c: Context<AppEnv>,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const db = c.get("db")

  switch (name) {
    case "search_bookmarks": {
      const query = String(args.query ?? "").trim()
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 10))
      if (!query) return JSON.stringify({ items: [] })
      let ids = await queryBookmarkIdsByFts(db, {
        q: query,
        includeNotes: true,
        limit: 5000,
      })
      try {
        const { queryBookmarkIdsHybrid } = await import("../lib/embeddings")
        ids = await queryBookmarkIdsHybrid(db, c.env, {
          q: query,
          includeNotes: true,
          ftsIds: ids,
          limit: 5000,
        })
      } catch (err) {
        console.error("[mcp] hybrid search failed", err)
      }
      ids = ids.slice(0, limit)
      if (ids.length === 0) return JSON.stringify({ items: [] })
      const rows = await db
        .select({
          id: bookmarks.id,
          title: bookmarks.title,
          url: bookmarks.canonicalUrl,
          summary: bookmarks.summaryAi,
          owner: bookmarks.owner,
          sourceType: bookmarks.sourceType,
        })
        .from(bookmarks)
        .where(and(inArray(bookmarks.id, ids), isNull(bookmarks.deletedAt)))
      const byId = new Map(rows.map((r) => [r.id, r]))
      const items = ids.map((id) => byId.get(id)).filter(Boolean)
      return JSON.stringify({ items }, null, 2)
    }
    case "get_bookmark": {
      const id = String(args.id ?? "")
      const row = await db
        .select()
        .from(bookmarks)
        .where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt)))
        .get()
      if (!row) throw new Error("Bookmark not found")
      const tagRows = await db
        .select({ name: tags.name })
        .from(bookmarkTags)
        .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
        .where(eq(bookmarkTags.bookmarkId, id))
      return JSON.stringify(
        {
          id: row.id,
          title: row.title,
          url: row.canonicalUrl,
          summary: row.summaryAi,
          notes: row.notes,
          folderId: row.folderId,
          tags: tagRows.map((t) => t.name),
          archived: Boolean(row.archivedAt),
          sourceType: row.sourceType,
        },
        null,
        2,
      )
    }
    case "list_folders": {
      const rows = await db
        .select({
          id: folders.id,
          name: folders.name,
          parentId: folders.parentId,
          path: folders.path,
          depth: folders.depth,
        })
        .from(folders)
        .orderBy(asc(folders.path))
      return JSON.stringify({ items: rows }, null, 2)
    }
    case "list_tags": {
      const usageCount = count(bookmarkTags.bookmarkId).as("usage_count")
      const rows = await db
        .select({
          id: tags.id,
          name: tags.name,
          usage_count: usageCount,
        })
        .from(tags)
        .leftJoin(bookmarkTags, eq(tags.id, bookmarkTags.tagId))
        .groupBy(tags.id)
        .orderBy(desc(usageCount), asc(tags.name))
      return JSON.stringify(
        {
          items: rows.map((r) => ({
            id: r.id,
            name: r.name,
            usage_count: Number(r.usage_count),
          })),
        },
        null,
        2,
      )
    }
    case "save_bookmark": {
      assertWrite(c)
      const url = String(args.url ?? "").trim()
      if (!url) throw new Error("url is required")
      // 避免循环依赖：通过同进程 dispatch（由 app 注入）
      const dispatch = getMcpHttpDispatch()
      if (!dispatch) {
        throw new Error("MCP HTTP dispatch not ready")
      }
      const payload: Record<string, unknown> = { url }
      if (typeof args.notes === "string") payload.notes = args.notes
      if (typeof args.folderId === "string") payload.folderId = args.folderId

      const headers: HeadersInit = {
        "content-type": "application/json",
      }
      const cookie = c.req.header("cookie")
      const auth = c.req.header("Authorization")
      if (cookie) (headers as Record<string, string>).cookie = cookie
      if (auth) (headers as Record<string, string>).Authorization = auth

      const res = await dispatch(
        "/api/bookmarks",
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        },
        c.env,
        c.executionCtx,
      )
      if (!res.ok) {
        throw new Error(`save failed (${res.status}): ${res.body}`)
      }
      return res.body
    }
    case "update_bookmark": {
      assertWrite(c)
      const id = String(args.id ?? "")
      if (!id) throw new Error("id is required")
      const existing = await db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt)))
        .get()
      if (!existing) throw new Error("Bookmark not found")

      const patch: Partial<typeof bookmarks.$inferInsert> = {
        updatedAt: nowIso(),
      }
      if ("folderId" in args) {
        patch.folderId =
          args.folderId === null || args.folderId === undefined
            ? null
            : String(args.folderId)
      }
      if ("notes" in args) {
        patch.notes =
          args.notes === null || args.notes === undefined
            ? null
            : String(args.notes)
      }
      if (typeof args.archived === "boolean") {
        patch.archivedAt = args.archived ? nowIso() : null
      }
      await db.update(bookmarks).set(patch).where(eq(bookmarks.id, id))
      if (Array.isArray(args.tagNames)) {
        await syncBookmarkTags(
          db,
          id,
          args.tagNames.map((t) => String(t)),
        )
      }
      return JSON.stringify({ ok: true, id })
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

type McpDispatch = (
  path: string,
  init: RequestInit,
  env: AppEnv["Bindings"],
  // Hono/Workers ExecutionContext 泛型在不同版本不完全一致
  executionCtx: unknown,
) => Promise<{ ok: boolean; status: number; body: string }>

let mcpHttpDispatch: McpDispatch | null = null

export function setMcpHttpDispatch(dispatch: McpDispatch) {
  mcpHttpDispatch = dispatch
}

function getMcpHttpDispatch() {
  return mcpHttpDispatch
}
