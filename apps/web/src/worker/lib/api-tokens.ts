import { apiTokens, users, type Db } from "@mankr/db"
import { and, eq, isNull } from "drizzle-orm"
import { bytesToBase64, nowIso } from "./utils"
import { hashToken } from "./session"

export type ApiTokenScope = "read" | "write"

export type ResolvedApiToken = {
  id: string
  scopes: ApiTokenScope[]
  user: {
    id: string
    username: string
    email: string | null
  }
}

const TOKEN_PREFIX = "msk_live_"

export function generateApiTokenPlaintext(): {
  token: string
  prefix: string
} {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const body = bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  const token = `${TOKEN_PREFIX}${body}`
  return { token, prefix: token.slice(0, 12) }
}

export async function hashApiToken(
  token: string,
  pepper: string,
): Promise<string> {
  return hashToken(`${pepper}:${token}`)
}

export function parseScopes(raw: string): ApiTokenScope[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return ["read"]
    const scopes = parsed.filter(
      (s): s is ApiTokenScope => s === "read" || s === "write",
    )
    return scopes.includes("read") ? scopes : ["read", ...scopes]
  } catch {
    return ["read"]
  }
}

export function hasScope(
  scopes: ApiTokenScope[],
  needed: ApiTokenScope,
): boolean {
  if (needed === "read") return scopes.includes("read") || scopes.includes("write")
  return scopes.includes("write")
}

export async function resolveBearerToken(
  db: Db,
  authorization: string | undefined,
  pepper: string,
): Promise<ResolvedApiToken | null> {
  if (!authorization) return null
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  if (!match?.[1]) return null
  const token = match[1].trim()
  if (!token.startsWith(TOKEN_PREFIX)) return null

  const tokenHash = await hashApiToken(token, pepper)
  const row = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)))
    .get()
  if (!row) return null

  const user = await db.select().from(users).get()
  if (!user) return null

  // 节流：5 分钟内不重复写 last_used_at，避免 Bearer 高频读放大 D1 写
  const last = row.lastUsedAt ? Date.parse(row.lastUsedAt) : 0
  if (!Number.isFinite(last) || Date.now() - last > 5 * 60_000) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: nowIso() })
      .where(eq(apiTokens.id, row.id))
  }

  return {
    id: row.id,
    scopes: parseScopes(row.scopes),
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
  }
}
