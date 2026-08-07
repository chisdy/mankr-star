import { applyD1Migrations, env } from "cloudflare:test"
import { beforeAll, describe, expect, it } from "vitest"

/**
 * 0013 把 users 上的服务端配置迁到 settings 表。
 * 这里在独立的 MIGRATION_DB 上先跑到 0012、写入旧版数据，再单独应用 0013。
 */
const PAT_CIPHERTEXT = "pat-ciphertext-v1"
const DEEPSEEK_CIPHERTEXT = "deepseek-ciphertext-v1"
const ANYSEARCH_CIPHERTEXT = "anysearch-ciphertext-v1"

const db = env.MIGRATION_DB

/**
 * 严格「0013 之前」，而不是「除了 0013」：迁移会一直往后加，
 * 排除式过滤会把后续迁移提前到 0013 之前跑，撞上顺序依赖就成了假绿。
 */
function migrationsBefore0013() {
  return env.TEST_MIGRATIONS.filter((m) => m.name < "0013_")
}

async function readSettingValue(key: string): Promise<Record<string, unknown>> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>()
  expect(row, `settings.${key} 应存在`).toBeTruthy()
  return JSON.parse(row!.value) as Record<string, unknown>
}

beforeAll(async () => {
  await applyD1Migrations(db, migrationsBefore0013())

  await db
    .prepare(
      `INSERT INTO users (
        id, username, email, password_hash,
        github_pat_encrypted,
        deepseek_api_key_encrypted, deepseek_key_last4, deepseek_model,
        anysearch_api_key_encrypted, anysearch_key_last4,
        hot_within_days, stale_after_days, public_browsing_enabled,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "user-legacy",
      "legacy",
      "legacy@example.com",
      "hash",
      PAT_CIPHERTEXT,
      DEEPSEEK_CIPHERTEXT,
      "abcd",
      "deepseek-v4-pro",
      ANYSEARCH_CIPHERTEXT,
      "wxyz",
      7,
      90,
      1,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    )
    .run()

  // d1_migrations 已记录 0000–0012，这里只会追加应用 0013 及之后的
  await applyD1Migrations(db, env.TEST_MIGRATIONS)
})

describe("0013 设置迁移", () => {
  it("AI 领域保留密文、后四位与模型", async () => {
    expect(await readSettingValue("ai")).toEqual({
      deepseekApiKeyEncrypted: DEEPSEEK_CIPHERTEXT,
      deepseekKeyLast4: "abcd",
      deepseekModel: "deepseek-v4-pro",
    })
  })

  it("联网搜索与 GitHub PAT 密文原样迁移", async () => {
    expect(await readSettingValue("search")).toEqual({
      anysearchApiKeyEncrypted: ANYSEARCH_CIPHERTEXT,
      anysearchKeyLast4: "wxyz",
    })
    expect(await readSettingValue("github")).toEqual({
      patEncrypted: PAT_CIPHERTEXT,
    })
  })

  it("跟踪阈值与公开浏览按原值迁移，公开浏览是 JSON 布尔", async () => {
    expect(await readSettingValue("tracking")).toEqual({
      hotWithinDays: 7,
      staleAfterDays: 90,
    })
    expect(await readSettingValue("browsing")).toEqual({
      publicBrowsingEnabled: true,
    })
  })

  it("收藏分页写入默认值", async () => {
    expect(await readSettingValue("bookmarks")).toEqual({
      paginationMode: "auto",
      pageSize: 20,
    })
  })

  it("users 上的设置列已移除，身份字段保留", async () => {
    const { results } = await db.prepare("PRAGMA table_info(users)").all<{
      name: string
    }>()
    const columns = results.map((r) => r.name)

    for (const dropped of [
      "github_pat_encrypted",
      "deepseek_api_key_encrypted",
      "deepseek_key_last4",
      "deepseek_model",
      "anysearch_api_key_encrypted",
      "anysearch_key_last4",
      "hot_within_days",
      "stale_after_days",
      "public_browsing_enabled",
    ]) {
      expect(columns).not.toContain(dropped)
    }
    expect(columns).toEqual(
      expect.arrayContaining(["id", "username", "email", "password_hash"]),
    )
  })

  it("value 列拒绝非 JSON 文本", async () => {
    await expect(
      db
        .prepare("INSERT INTO settings (key, value) VALUES ('broken', 'not-json')")
        .run(),
    ).rejects.toThrow()
  })
})
