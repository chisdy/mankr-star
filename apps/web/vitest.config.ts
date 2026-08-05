import path from "node:path"
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig(async () => {
  // D1 迁移在测试启动前读入，由 setupFiles 应用到内存数据库
  const migrations = await readD1Migrations(
    path.resolve(__dirname, "../../packages/db/migrations"),
  )

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: "2026-08-04",
          d1Databases: ["DB"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: "test-session-secret-0123456789abcdef",
            PAT_ENCRYPTION_KEY: "test-pat-encryption-key-0123456789ab",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  }
})
