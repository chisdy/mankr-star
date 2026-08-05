import { app } from "./app"
import { runCronJobs } from "./cron/sync"
import type { Env } from "./env"

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runCronJobs(env))
  },
}

export type { Env }
