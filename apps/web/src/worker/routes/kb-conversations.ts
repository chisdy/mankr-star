import { kbConversations, kbMessages, type KbMessageRow } from "@mankr/db"
import {
  KB_CHAT_MAX_CONVERSATIONS,
  KB_CHAT_TITLE_MAX_CHARS,
  kbConversationUpsertSchema,
  kbStoredMessageSchema,
  type KbConversationDetail,
  type KbConversationSummary,
  type KbStoredMessage,
} from "@mankr/shared"
import { asc, count, desc, eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { truncate } from "../lib/kb-search"
import { nowIso } from "../lib/utils"
import { requireAuth } from "../middleware/auth"

export const kbConversationRoutes = new Hono<AppEnv>()

kbConversationRoutes.use("/kb/conversations", requireAuth)
kbConversationRoutes.use("/kb/conversations/*", requireAuth)

kbConversationRoutes.get("/kb/conversations", async (c) => {
  const db = c.get("db")
  const messageCount = count(kbMessages.id).as("message_count")

  const rows = await db
    .select({
      id: kbConversations.id,
      title: kbConversations.title,
      created_at: kbConversations.createdAt,
      updated_at: kbConversations.updatedAt,
      message_count: messageCount,
      summary_covers_through_id: kbConversations.summaryCoversThroughId,
    })
    .from(kbConversations)
    .leftJoin(kbMessages, eq(kbConversations.id, kbMessages.conversationId))
    .groupBy(kbConversations.id)
    .orderBy(desc(kbConversations.updatedAt))
    .limit(KB_CHAT_MAX_CONVERSATIONS)

  return c.json({
    items: rows.map((r) => ({ ...r, message_count: Number(r.message_count) })),
  })
})

kbConversationRoutes.get("/kb/conversations/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")

  const conversation = await db
    .select()
    .from(kbConversations)
    .where(eq(kbConversations.id, id))
    .get()
  if (!conversation) {
    return c.json({ error: "会话不存在", code: "NOT_FOUND" }, 404)
  }

  const rows = await db
    .select()
    .from(kbMessages)
    .where(eq(kbMessages.conversationId, id))
    .orderBy(asc(kbMessages.seq))

  const detail: KbConversationDetail = {
    id: conversation.id,
    title: conversation.title,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
    messages: rows.map(toStoredMessage).filter((m): m is KbStoredMessage => !!m),
    summary_covers_through_id: conversation.summaryCoversThroughId,
  }
  return c.json(detail)
})

/**
 * 整会话全量覆盖（客户端生成会话 id，首次 PUT 即创建）。
 * 用覆盖而不是增量 append：重试会丢弃尾部消息重新生成，
 * append 语义表达不了这种截断，两端会慢慢对不上。
 */
kbConversationRoutes.put("/kb/conversations/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = kbConversationUpsertSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: "参数校验失败",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      400,
    )
  }

  const { messages } = parsed.data
  const title = deriveTitle(messages)
  const now = nowIso()

  // set 只写 title / updatedAt：context_summary 与 summary_covers_through_id
  // 由后台压缩单独维护，存档是每轮收尾的整体回写，把它们一起 set 会把水位清空，
  // 下一轮就会把已经压缩过的旧消息再压一遍。
  //
  // RETURNING 顺路把当前水位带回给客户端，省掉一次单独的请求。它可能比实际
  // 落库的值旧一轮（压缩是并发的，可能还没写完），这不影响正确性：
  // 服务端每轮都会按同一个 id 再对齐一次，客户端水位只决定上传多少条。
  const [row] = await db
    .insert(kbConversations)
    .values({ id, title, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: kbConversations.id,
      set: { title, updatedAt: now },
    })
    .returning({
      summary_covers_through_id: kbConversations.summaryCoversThroughId,
    })

  // 覆盖式写入：先清空再整批插入。D1 单请求内没有事务，
  // 中途失败最坏留下一个空会话，下一次 PUT 会补齐。
  await db.delete(kbMessages).where(eq(kbMessages.conversationId, id))
  if (messages.length > 0) {
    await db.insert(kbMessages).values(
      messages.map((m, index) => ({
        id: m.id,
        conversationId: id,
        seq: index,
        role: m.role,
        content: m.content,
        state: m.state ?? null,
        errorCode: m.errorCode ?? null,
        sources: toJson(m.sources),
        warnings: toJson(m.warnings),
        plan: toJson(m.plan),
        activity: toJson(m.activity),
        createdAt: now,
      })),
    )
  }

  await pruneConversations(db)

  const summary: KbConversationSummary = {
    id,
    title,
    created_at: now,
    updated_at: now,
    message_count: messages.length,
    summary_covers_through_id: row?.summary_covers_through_id ?? null,
  }
  return c.json(summary)
})

kbConversationRoutes.delete("/kb/conversations/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")

  await db.delete(kbMessages).where(eq(kbMessages.conversationId, id))
  await db.delete(kbConversations).where(eq(kbConversations.id, id))

  return c.json({ ok: true })
})

kbConversationRoutes.delete("/kb/conversations", async (c) => {
  const db = c.get("db")
  await db.delete(kbMessages)
  await db.delete(kbConversations)
  return c.json({ ok: true })
})

/** 标题取首条提问，落库时派生一次，避免前后端两处各算一遍 */
function deriveTitle(messages: KbStoredMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim())
  if (!first) return "未命名对话"
  return truncate(first.content.trim(), KB_CHAT_TITLE_MAX_CHARS)
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value) && value.length === 0) return null
  return JSON.stringify(value)
}

/**
 * 单条脏数据不该让整个会话打不开：解析失败的字段按缺失处理，
 * 整条消息形状不合法时才丢弃这一条。
 */
function toStoredMessage(row: KbMessageRow): KbStoredMessage | null {
  const candidate = {
    id: row.id,
    role: row.role,
    content: row.content,
    ...(row.state ? { state: row.state } : {}),
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...fromJson("sources", row.sources),
    ...fromJson("warnings", row.warnings),
    ...fromJson("plan", row.plan),
    ...fromJson("activity", row.activity),
  }
  const parsed = kbStoredMessageSchema.safeParse(candidate)
  if (!parsed.success) {
    console.error("[kb] stored message dropped", row.id, parsed.error.issues[0])
    return null
  }
  return parsed.data
}

function fromJson(key: string, raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return { [key]: JSON.parse(raw) }
  } catch {
    return {}
  }
}

/** 超出保留上限的会话按最久未更新淘汰；messages 显式删，不依赖 FK 级联 */
async function pruneConversations(db: AppEnv["Variables"]["db"]): Promise<void> {
  const stale = await db.all<{ id: string }>(sql`
    SELECT id FROM kb_conversations
    ORDER BY updated_at DESC
    LIMIT -1 OFFSET ${KB_CHAT_MAX_CONVERSATIONS}
  `)
  for (const row of stale) {
    await db.delete(kbMessages).where(eq(kbMessages.conversationId, row.id))
    await db.delete(kbConversations).where(eq(kbConversations.id, row.id))
  }
}
