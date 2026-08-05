import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  writeStoredLocale,
} from "../src/i18n/locales"
import { ApiError } from "../src/lib/api"
import { formatApiError } from "../src/lib/api-error"

describe("locale storage", () => {
  const memory = new Map<string, string>()

  beforeEach(() => {
    memory.clear()
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value)
        },
        removeItem: (key: string) => {
          memory.delete(key)
        },
      },
    })
  })

  it("isLocale accepts en and zh-CN only", () => {
    expect(isLocale("en")).toBe(true)
    expect(isLocale("zh-CN")).toBe(true)
    expect(isLocale("zh")).toBe(false)
    expect(isLocale(null)).toBe(false)
  })

  it("readStoredLocale returns null when missing or invalid", () => {
    expect(readStoredLocale()).toBeNull()
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr")
    expect(readStoredLocale()).toBeNull()
  })

  it("writeStoredLocale then readStoredLocale round-trips", () => {
    writeStoredLocale("zh-CN")
    expect(readStoredLocale()).toBe("zh-CN")
    writeStoredLocale(DEFAULT_LOCALE)
    expect(readStoredLocale()).toBe("en")
  })
})

describe("formatApiError", () => {
  const messages: Record<string, string> = {
    "errors:network":
      "Unable to reach the server. Check your network and try again.",
    "errors:INVALID_CREDENTIALS": "Incorrect username or password",
    "errors:UNAUTHORIZED": "Not signed in",
    "errors:http.429": "Too many requests. Please try again later.",
    "errors:generic": "Request failed. Please try again later.",
  }

  const t = ((key: string, opts?: { defaultValue?: string }) => {
    if (key in messages) return messages[key]
    return opts?.defaultValue ?? ""
  }) as typeof import("i18next").t

  it("maps ApiError code without exposing Chinese transport message", () => {
    const err = new ApiError("用户名或密码错误", 401, {
      code: "INVALID_CREDENTIALS",
    })
    expect(formatApiError(err, t)).toBe("Incorrect username or password")
  })

  it("falls back to http status when code missing", () => {
    const err = new ApiError("whatever chinese", 429)
    expect(formatApiError(err, t)).toBe(
      "Too many requests. Please try again later.",
    )
  })

  it("uses network message for backendUnavailable", () => {
    const err = new ApiError("无法连接", 0, { backendUnavailable: true })
    expect(formatApiError(err, t)).toBe(
      "Unable to reach the server. Check your network and try again.",
    )
  })

  it("returns generic when no code or mapped status", () => {
    const err = new ApiError("神秘中文错误", 418)
    expect(formatApiError(err, t)).toBe(
      "Request failed. Please try again later.",
    )
  })
})
