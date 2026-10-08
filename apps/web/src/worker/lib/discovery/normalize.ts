import { canonicalizeUrl } from "@mankr/shared"
import { parseGithubRepoInput } from "../github-url"

export const DISCOVERY_URL_MAX_LENGTH = 2048

/** Discovery-only identity wrapper; shared bookmark/import contracts stay intact. */
export function normalizeDiscoveryUrl(input: string): {
  canonicalUrl: string
  bookmarkSourceType: "github" | "url"
} | null {
  if (input.length > DISCOVERY_URL_MAX_LENGTH || /[\uD800-\uDFFF]/u.test(input))
    return null
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password)
    return null
  if (
    url.hostname.toLowerCase() === "github.com" ||
    url.hostname.toLowerCase() === "www.github.com"
  ) {
    const parsed = parseGithubRepoInput(url.href)
    if (!parsed) return null
    if (parsed.owner.length > 39 || parsed.repo.length > 100) return null
    if (parsed.canonicalUrl.length > DISCOVERY_URL_MAX_LENGTH) return null
    // Discovery folds case while reusing the established repository parsing rules.
    return {
      canonicalUrl: parsed.canonicalUrl.toLowerCase(),
      bookmarkSourceType: "github",
    }
  }
  const canonical = canonicalizeUrl(url.href)
  return canonical.ok &&
    canonical.canonicalUrl.length <= DISCOVERY_URL_MAX_LENGTH
    ? { canonicalUrl: canonical.canonicalUrl, bookmarkSourceType: "url" }
    : null
}

/** HTML is never returned to the browser. Entity decoding is bounded and safe. */
export function discoveryPlainText(
  input: string | null | undefined,
  maxLength = 2000
): string | null {
  if (!input) return null
  const text = input
    // In Unicode mode valid surrogate pairs are one non-BMP code point; only
    // unpaired code units match this range. Remove them before and after slicing.
    .replace(/[\uD800-\uDFFF]/gu, "")
    .slice(0, 32_000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|apos|#39);/giu,
      (entity) =>
        ({
          "&nbsp;": " ",
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&#39;": "'",
        })[entity.toLowerCase()] ?? " "
    )
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (_match, value: string) => {
      const code =
        value[0]!.toLowerCase() === "x"
          ? Number.parseInt(value.slice(1), 16)
          : Number(value)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : ""
    })
    .replace(/\s+/gu, " ")
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, maxLength)
    .replace(/[\uD800-\uDFFF]/gu, "")
  return text || null
}
