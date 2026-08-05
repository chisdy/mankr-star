import { base64ToBytes, bytesToBase64, timingSafeEqual } from "./utils"

const PBKDF2_ITERATIONS = 100_000
const HASH_BITS = 256

/**
 * 格式：pbkdf2$sha256$iterations$salt_b64$hash_b64
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$")
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") {
    return false
  }
  const iterations = Number(parts[2])
  const salt = base64ToBytes(parts[3]!)
  const expected = parts[4]!
  const actual = bytesToBase64(await derive(password, salt, iterations))
  return timingSafeEqual(actual, expected)
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_BITS,
  )
}
