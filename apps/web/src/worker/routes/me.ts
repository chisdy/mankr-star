import { users } from "@mankr/db"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { readAllSettings } from "../lib/settings-store"
import { serializeUser } from "../lib/user-response"
import { requireAuth } from "../middleware/auth"

export const meRoutes = new Hono<AppEnv>()

meRoutes.get("/me", requireAuth, async (c) => {
  const db = c.get("db")
  const user = await db.select().from(users).get()
  if (!user) {
    return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)
  }

  return c.json(serializeUser(user, await readAllSettings(db)))
})
