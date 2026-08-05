import { Hono } from "hono"
import type { AppEnv } from "../env"

export const healthRoutes = new Hono<AppEnv>().get("/health", (c) =>
  c.json({ ok: true, service: "mankr-star", ts: new Date().toISOString() }),
)
