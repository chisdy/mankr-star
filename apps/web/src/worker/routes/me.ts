import { users } from "@mankr/db"
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_HOT_WITHIN_DAYS,
  DEFAULT_STALE_AFTER_DAYS,
} from "@mankr/shared"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { requireAuth } from "../middleware/auth"

export const meRoutes = new Hono<AppEnv>()

meRoutes.get("/me", requireAuth, async (c) => {
  const db = c.get("db")
  const user = await db.select().from(users).get()
  if (!user) {
    return c.json({ error: "用户不存在", code: "NOT_FOUND" }, 404)
  }

  return c.json({
    id: user.id,
    username: user.username,
    email: user.email,
    deepseek_configured: Boolean(user.deepseekApiKeyEncrypted),
    deepseek_last4: user.deepseekKeyLast4,
    deepseek_model: user.deepseekModel || DEFAULT_DEEPSEEK_MODEL,
    anysearch_configured: Boolean(user.anysearchApiKeyEncrypted),
    anysearch_last4: user.anysearchKeyLast4,
    github_pat_configured: Boolean(user.githubPatEncrypted),
    hot_within_days: user.hotWithinDays ?? DEFAULT_HOT_WITHIN_DAYS,
    stale_after_days: user.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
    public_browsing_enabled: Boolean(user.publicBrowsingEnabled),
    created_at: user.createdAt,
  })
})
