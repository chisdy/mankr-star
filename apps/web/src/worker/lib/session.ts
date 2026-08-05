import { sessions, users } from "@mankr/db"
import { and, eq, gt, isNull } from "drizzle-orm"
import type { Context } from "hono"
import { getCookie } from "hono/cookie"
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS } from "@mankr/shared"
import { deleteCookie, setCookie } from "hono/cookie"
import type { AppEnv } from "../env"
import { addDaysIso, bytesToBase64, nowIso } from "./utils"

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  )
  return bytesToBase64(digest)
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export async function createSession(
  c: Context<AppEnv>,
  userId: string,
): Promise<void> {
  const db = c.get("db")
  const token = generateSessionToken()
  const tokenHash = await hashToken(token)
  const id = crypto.randomUUID()
  const expiresAt = addDaysIso(SESSION_TTL_DAYS)

  await db.insert(sessions).values({
    id,
    userId,
    tokenHash,
    expiresAt,
    createdAt: nowIso(),
  })

  const isSecure = new URL(c.req.url).protocol === "https:"
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  })
}

export async function revokeSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (token) {
    const db = c.get("db")
    const tokenHash = await hashToken(token)
    await db
      .update(sessions)
      .set({ revokedAt: nowIso() })
      .where(eq(sessions.tokenHash, tokenHash))
  }
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" })
}

export async function resolveSessionUser(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return null

  const db = c.get("db")
  const tokenHash = await hashToken(token)

  const row = await db
    .select({
      userId: users.id,
      username: users.username,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, nowIso()),
      ),
    )
    .get()

  if (!row) return null
  return {
    id: row.userId,
    username: row.username,
    email: row.email,
  }
}
