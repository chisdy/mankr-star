import type { D1Migration } from "@cloudflare/vitest-pool-workers"
import type { Env as WorkerEnv } from "../src/worker/env"

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      /** 由 vitest.config.ts 注入的 D1 迁移，供 setup.ts 应用 */
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}
