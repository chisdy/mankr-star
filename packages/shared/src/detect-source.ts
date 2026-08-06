import {
  IMPLEMENTED_SOURCE_TYPES,
  SOURCE_DETECT_RULES,
  type SourceType,
} from "./constants"

export type DetectSourceResult =
  | {
      ok: true
      sourceType: SourceType
      implemented: boolean
      label: string
    }
  | {
      ok: false
      code: "INVALID_URL" | "UNSUPPORTED_SOURCE"
      error: string
      detectedType?: SourceType
      label?: string
    }

const OWNER_REPO_SHORT =
  /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/

function isImplemented(type: SourceType): boolean {
  return (IMPLEMENTED_SOURCE_TYPES as readonly string[]).includes(type)
}

function labelFor(type: SourceType): string {
  return (
    SOURCE_DETECT_RULES.find((r) => r.type === type)?.label ??
    (type === "url" ? "通用网页" : type)
  )
}

function unsupportedMessage(type: SourceType, label: string): string {
  if (type === "url") {
    return "暂不支持通用网页链接，目前仅支持 GitHub 仓库"
  }
  return `识别为${label}，专项能力尚未接入；通用网页收藏即将开放`
}

/** 从输入中提取 hostname（不依赖 DOM URL） */
function extractHost(input: string): string | null {
  const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`
  const m = withProto.match(/^https?:\/\/([^/?#]+)/i)
  if (!m?.[1]) return null
  return m[1].toLowerCase()
}

/**
 * 从用户输入识别来源类型。
 * - owner/repo 短形式 → github
 * - 否则按 SOURCE_DETECT_RULES 匹配 host / 兜底 https
 */
export function detectSourceType(input: string): DetectSourceResult {
  const raw = input.trim()
  if (!raw) {
    return {
      ok: false,
      code: "INVALID_URL",
      error: "请输入有效链接或 owner/repo",
    }
  }

  // 1) GitHub owner/repo 短形式
  if (
    !raw.includes("://") &&
    !raw.toLowerCase().startsWith("github.com") &&
    OWNER_REPO_SHORT.test(raw)
  ) {
    return {
      ok: true,
      sourceType: "github",
      implemented: true,
      label: labelFor("github"),
    }
  }

  const host = extractHost(raw)
  if (host) {
    for (const rule of SOURCE_DETECT_RULES) {
      if (rule.type === "url") continue
      if (rule.match.test(host)) {
        const implemented = isImplemented(rule.type)
        if (!implemented) {
          return {
            ok: false,
            code: "UNSUPPORTED_SOURCE",
            error: unsupportedMessage(rule.type, rule.label),
            detectedType: rule.type,
            label: rule.label,
          }
        }
        return {
          ok: true,
          sourceType: rule.type,
          implemented: true,
          label: rule.label,
        }
      }
    }

    // 3) 合法 http(s) → url 兜底
    if (/^https?:\/\//i.test(raw) || host.includes(".")) {
      const implemented = isImplemented("url")
      if (!implemented) {
        return {
          ok: false,
          code: "UNSUPPORTED_SOURCE",
          error: unsupportedMessage("url", "通用网页"),
          detectedType: "url",
          label: "通用网页",
        }
      }
      return {
        ok: true,
        sourceType: "url",
        implemented: true,
        label: labelFor("url"),
      }
    }
  }

  return {
    ok: false,
    code: "INVALID_URL",
    error: "无效的链接或 owner/repo",
  }
}
