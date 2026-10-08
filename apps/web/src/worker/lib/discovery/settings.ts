import { parseSettingJson } from "@mankr/shared"
import { discoveryEnabled } from "./repository"

export function resolveDiscoveryEnabled(
  settingValue: string | null | undefined,
  envValue: string | undefined
): boolean {
  return settingValue == null
    ? discoveryEnabled(envValue)
    : parseSettingJson("discovery", settingValue).enabled
}

/** 已保存的实例开关优先；未保存时兼容原有部署默认值。 */
export async function readDiscoveryEnabled(
  db: D1Database,
  envValue: string | undefined
): Promise<boolean> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'discovery'")
    .first<{ value: string }>()
  return resolveDiscoveryEnabled(row?.value, envValue)
}
