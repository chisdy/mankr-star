import { settings, type Db } from "@mankr/db"
import {
  SETTING_KEYS,
  defaultSettingValue,
  parseSettingJson,
  type SettingKey,
  type SettingsValueMap,
} from "@mankr/shared"
import { eq } from "drizzle-orm"
import { nowIso } from "./utils"

/** 读单个领域；缺行或 JSON 损坏都只回退该领域的默认值 */
export async function readSetting<K extends SettingKey>(
  db: Db,
  key: K,
): Promise<SettingsValueMap[K]> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get()
  return parseSettingJson(key, row?.value)
}

/** 一次读全部领域，避免 /me、/auth/status 这类接口串行查多行 */
export async function readAllSettings(db: Db): Promise<SettingsValueMap> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
  const byKey = new Map(rows.map((r) => [r.key, r.value]))

  return {
    ai: parseSettingJson("ai", byKey.get("ai")),
    search: parseSettingJson("search", byKey.get("search")),
    github: parseSettingJson("github", byKey.get("github")),
    tracking: parseSettingJson("tracking", byKey.get("tracking")),
    browsing: parseSettingJson("browsing", byKey.get("browsing")),
    bookmarks: parseSettingJson("bookmarks", byKey.get("bookmarks")),
  }
}

function stripUndefined<T extends object>(patch: Partial<T>): Partial<T> {
  const out: Partial<T> = {}
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[field as keyof T] = value as T[keyof T]
  }
  return out
}

/**
 * read-merge-upsert：只覆盖 patch 里显式给出的属性。
 * 更新模型这类局部字段时不会清掉同领域里已保存的密钥。
 */
export async function writeSetting<K extends SettingKey>(
  db: Db,
  key: K,
  patch: Partial<SettingsValueMap[K]>,
): Promise<SettingsValueMap[K]> {
  const current = await readSetting(db, key)
  const next = {
    ...current,
    ...stripUndefined(patch),
  } as SettingsValueMap[K]

  const value = JSON.stringify(next)
  const now = nowIso()
  await db
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })

  return next
}

/** 注册时幂等写入默认设置；已存在的领域保持原值 */
export async function initializeSettings(db: Db): Promise<void> {
  const now = nowIso()
  for (const key of SETTING_KEYS) {
    await db
      .insert(settings)
      .values({
        key,
        value: JSON.stringify(defaultSettingValue(key)),
        updatedAt: now,
      })
      .onConflictDoNothing({ target: settings.key })
  }
}
