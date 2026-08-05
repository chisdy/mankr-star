import { base64ToBytes, bytesToBase64 } from "./utils"

/**
 * AES-GCM 加密。密文格式：v1$iv_b64$ciphertext_b64
 * 密钥由 Workers Secret（32+ 字节字符串）经 SHA-256 派生为 AES-256 key。
 */
export async function encryptSecret(
  plaintext: string,
  secretKey: string,
): Promise<string> {
  const key = await importAesKey(secretKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  )
  return `v1$${bytesToBase64(iv)}$${bytesToBase64(ciphertext)}`
}

export async function decryptSecret(
  packed: string,
  secretKey: string,
): Promise<string> {
  const [version, ivB64, ctB64] = packed.split("$")
  if (version !== "v1" || !ivB64 || !ctB64) {
    throw new Error("invalid ciphertext format")
  }
  const key = await importAesKey(secretKey)
  const iv = base64ToBytes(ivB64)
  const ciphertext = base64ToBytes(ctB64)
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  )
  return new TextDecoder().decode(plain)
}

async function importAesKey(secretKey: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secretKey),
  )
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}

export function last4(value: string): string {
  return value.slice(-4)
}
