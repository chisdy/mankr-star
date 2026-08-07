import { applyD1Migrations, env } from "cloudflare:test"
import { beforeAll, beforeEach } from "vitest"

const TABLES = [
  "bookmark_tags",
  "update_events",
  "ai_jobs",
  "ai_usage_logs",
  "kb_messages",
  "kb_conversations",
  "bookmarks",
  "tags",
  "folders",
  "sessions",
  "users",
  "settings",
] as const

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

// 每个用例从空库开始（单用户实例的注册守卫要求 users 表为空）
beforeEach(async () => {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
})
