import * as React from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { copyText } from "@/lib/clipboard"

/**
 * 站点账号的复制。密码明文只在这里做一次局部变量，取到后立刻写剪贴板并丢弃，
 * 不进 React state、不进缓存。
 */
export function useBookmarkAccountCopy({
  bookmarkId,
  username,
  passwordSet,
  passwordDirty = false,
}: {
  bookmarkId: string | null
  username: string
  passwordSet: boolean
  passwordDirty?: boolean
}) {
  const { t } = useTranslation(["bookmarks", "errors"])
  const [usernameCopied, setUsernameCopied] = React.useState(false)
  const [passwordCopied, setPasswordCopied] = React.useState(false)
  const [copyingPassword, setCopyingPassword] = React.useState(false)
  const usernameTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const passwordTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (usernameTimer.current) clearTimeout(usernameTimer.current)
      if (passwordTimer.current) clearTimeout(passwordTimer.current)
    }
  }, [])

  const flash = (
    setCopied: React.Dispatch<React.SetStateAction<boolean>>,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setCopied(true)
    timerRef.current = setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, 1500)
  }

  const copyUsername = async () => {
    const value = username.trim()
    if (!value) {
      toast.error(t("detail.accountUsernameEmpty"))
      return
    }
    const ok = await copyText(value, {
      unsupportedMessage: t("detail.copyUnsupported"),
      silent: true,
    })
    if (ok) flash(setUsernameCopied, usernameTimer)
  }

  const copyPassword = async () => {
    if (!bookmarkId) return
    if (passwordDirty) {
      toast.error(t("detail.accountPasswordSaveFirst"))
      return
    }
    if (!passwordSet) {
      toast.error(t("detail.accountPasswordNotSet"))
      return
    }
    setCopyingPassword(true)
    try {
      const password = await api.copyAccountPassword(bookmarkId)
      const ok = await copyText(password, {
        unsupportedMessage: t("detail.copyUnsupported"),
        silent: true,
      })
      if (ok) flash(setPasswordCopied, passwordTimer)
    } catch (err) {
      toast.error(formatApiError(err as Error, t) || t("detail.copyFailed"))
    } finally {
      setCopyingPassword(false)
    }
  }

  return {
    usernameCopied,
    passwordCopied,
    copyingPassword,
    copyUsername,
    copyPassword,
  }
}
