import { app } from "./app"
import {
  BUSINESS_CRON,
  DISCOVERY_CRON,
  runDiscoveryScheduled,
} from "./cron/discovery"
import { runCronJobs } from "./cron/sync"
import type { Env } from "./env"

export default {
  fetch: app.fetch,
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) {
    if (controller.cron === BUSINESS_CRON) ctx.waitUntil(runCronJobs(env, ctx))
    else if (controller.cron === DISCOVERY_CRON)
      ctx.waitUntil(runDiscoveryScheduled(env))
  },
}

export type { Env }
