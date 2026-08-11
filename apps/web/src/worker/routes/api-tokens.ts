import { apiTokens } from "@mankr/db"
import { createApiTokenSchema } from "@mankr/shared"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import {
  generateApiTokenPlaintext,
  hashApiToken,
  parseScopes,
} from "../lib/api-tokens"
import { nowIso } from "../lib/utils"
import { requireAuth } from "../middleware/auth"

export const apiTokenRoutes = new Hono<AppEnv>()

apiTokenRoutes.use("/api-tokens", requireAuth)
apiTokenRoutes.use("/api-tokens/*", requireAuth)

apiTokenRoutes.get("/api-tokens", async (c) => {
  const db = c.get("db")
  const rows = await db
    .select()
    .from(apiTokens)
    .where(isNull(apiTokens.revokedAt))
    .orderBy(desc(apiTokens.createdAt))

  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      token_prefix: r.tokenPrefix,
      scopes: parseScopes(r.scopes),
      created_at: r.createdAt,
      last_used_at: r.lastUsedAt,
    })),
  })
})

apiTokenRoutes.post("/api-tokens", async (c) => {
  // 仅 session 可创建 token，避免 token 自我增殖
  if (c.get("authMethod") === "token") {
    return c.json(
      { error: "请使用网页登录创建 Token", code: "SESSION_REQUIRED" },
      403,
    )
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "无效的 JSON", code: "BAD_REQUEST" }, 400)
  }

  const parsed = createApiTokenSchema.safeParse(body)
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

  const db = c.get("db")
  const { token, prefix } = generateApiTokenPlaintext()
  const tokenHash = await hashApiToken(token, c.env.SESSION_SECRET)
  const id = crypto.randomUUID()
  const scopes = Array.from(new Set(["read", ...parsed.data.scopes]))

  await db.insert(apiTokens).values({
    id,
    name: parsed.data.name,
    tokenHash,
    tokenPrefix: prefix,
    scopes: JSON.stringify(scopes),
    createdAt: nowIso(),
  })

  return c.json(
    {
      id,
      name: parsed.data.name,
      token_prefix: prefix,
      scopes,
      token,
      created_at: nowIso(),
    },
    201,
  )
})

apiTokenRoutes.delete("/api-tokens/:id", async (c) => {
  if (c.get("authMethod") === "token") {
    return c.json(
      { error: "请使用网页登录吊销 Token", code: "SESSION_REQUIRED" },
      403,
    )
  }

  const db = c.get("db")
  const id = c.req.param("id")
  const existing = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .get()
  if (!existing) {
    return c.json({ error: "Token 不存在", code: "NOT_FOUND" }, 404)
  }

  await db
    .update(apiTokens)
    .set({ revokedAt: nowIso() })
    .where(eq(apiTokens.id, id))

  return c.json({ ok: true })
})
