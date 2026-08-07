/** 将任意字符串转为 URL-safe slug（标签等可用，允许中文） */
export { slugify } from "@mankr/shared"

/** 文件夹专用：仅英文 kebab-case，无 ascii 时返回空串 */
export function asciiSlugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
}

/** 规范化为合法英文文件夹 slug，空则 `folder` */
export function folderSlugBase(input: string): string {
  return asciiSlugify(input) || "folder"
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function addDaysIso(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ""
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]!)
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return out === 0
}

export function jsonError(
  error: string,
  status: number,
  extras?: { code?: string; details?: unknown },
) {
  return Response.json(
    { error, code: extras?.code, details: extras?.details },
    { status },
  )
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  )
}
