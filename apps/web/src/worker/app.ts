import { Hono } from "hono"
import type { AppEnv } from "./env"
import { withDb } from "./middleware/auth"
import { apiTokenRoutes } from "./routes/api-tokens"
import { authRoutes } from "./routes/auth"
import { bookmarkRoutes } from "./routes/bookmarks"
import { folderRoutes } from "./routes/folders"
import { exportRoutes } from "./routes/export"
import { feedRoutes } from "./routes/feed"
import { healthRoutes } from "./routes/health"
import { importRoutes } from "./routes/import"
import { insightsRoutes } from "./routes/insights"
import { kbRoutes } from "./routes/kb"
import { kbConversationRoutes } from "./routes/kb-conversations"
import { mcpRoutes, setMcpHttpDispatch } from "./routes/mcp"
import { meRoutes } from "./routes/me"
import { settingsRoutes } from "./routes/settings"
import { tagRoutes } from "./routes/tags"

const app = new Hono<AppEnv>()

app.use("/api/*", withDb)

app.route("/api", healthRoutes)
app.route("/api", authRoutes)
app.route("/api", meRoutes)
app.route("/api", bookmarkRoutes)
app.route("/api", folderRoutes)
app.route("/api", tagRoutes)
app.route("/api", feedRoutes)
app.route("/api", insightsRoutes)
app.route("/api", kbRoutes)
app.route("/api", kbConversationRoutes)
app.route("/api", settingsRoutes)
app.route("/api", importRoutes)
app.route("/api", exportRoutes)
app.route("/api", apiTokenRoutes)
app.route("/api", mcpRoutes)

setMcpHttpDispatch(async (path, init, env, executionCtx) => {
  const res = await app.request(
    path,
    init,
    env,
    executionCtx as ExecutionContext,
  )
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
})

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Not Found", code: "NOT_FOUND" }, 404)
  }
  return c.text("Not Found", 404)
})

app.onError((err, c) => {
  console.error(err)
  return c.json(
    {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      details: err instanceof Error ? err.message : String(err),
    },
    500,
  )
})

export { app }
