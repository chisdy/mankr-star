import type { TFunction } from "i18next"

import { ApiError } from "./api"

/**
 * Resolve a user-facing error message from ApiError code/status.
 * Never surfaces Chinese transport messages when a mapped key exists.
 */
export function formatApiError(
  err: unknown,
  t: TFunction<"errors"> | TFunction,
): string {
  if (err instanceof ApiError) {
    if (err.backendUnavailable || err.status === 0) {
      return t("errors:network")
    }
    if (err.code) {
      const keyed = t(`errors:${err.code}`, { defaultValue: "" })
      if (keyed) return keyed
    }
    if (err.status) {
      const byStatus = t(`errors:http.${err.status}`, { defaultValue: "" })
      if (byStatus) return byStatus
    }
    return t("errors:generic")
  }

  if (err instanceof Error && err.message.trim()) {
    // Client-side validation messages are already localized by callers
    return err.message
  }

  return t("errors:generic")
}
