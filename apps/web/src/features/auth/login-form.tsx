import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { useTranslation } from "react-i18next"
import {
  UserIcon,
  LockKeyIcon,
  EyeIcon,
  EyeSlashIcon,
  CircleNotchIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import { patchAuthStatus } from "@/hooks/use-auth"
import type { User } from "@/lib/types"

type LoginFormProps = {
  onSuccess?: (user: User) => void
  /** 表单下方额外内容（如「去注册」链接） */
  footer?: React.ReactNode
  autoFocus?: boolean
}

export function LoginForm({ onSuccess, footer, autoFocus = true }: LoginFormProps) {
  const { t } = useTranslation("auth")
  const queryClient = useQueryClient()
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const loginMutation = useMutation({
    mutationFn: () => api.login({ username, password }),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.auth.me, user)
      patchAuthStatus(queryClient, {
        authenticated: true,
        initialized: true,
        public_browsing_enabled: Boolean(user.public_browsing_enabled),
        ...(user.bookmark_pagination_mode
          ? { bookmark_pagination_mode: user.bookmark_pagination_mode }
          : {}),
        ...(user.bookmark_page_size
          ? { bookmark_page_size: user.bookmark_page_size }
          : {}),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.status })
      onSuccess?.(user)
    },
    onError: (err: Error) => {
      setErrorMessage(formatApiError(err, t))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    if (!username.trim() || !password.trim()) {
      setErrorMessage(t("login.required"))
      return
    }
    loginMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs text-destructive dark:bg-destructive/15">
              <WarningCircleIcon className="size-4 shrink-0 text-destructive" />
              <span className="font-medium">{errorMessage}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="login-username" className="text-xs font-medium text-foreground/90">
            {t("login.usernameLabel")}
          </Label>
          <div className="relative flex items-center">
            <UserIcon className="pointer-events-none absolute left-3 size-4 text-muted-foreground/70" />
            <Input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus={autoFocus}
              placeholder={t("login.usernamePlaceholder")}
              className="h-10 pl-9 text-sm transition-all focus-visible:ring-2 focus-visible:ring-primary/20"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="login-password" className="text-xs font-medium text-foreground/90">
            {t("login.passwordLabel")}
          </Label>
          <div className="relative flex items-center">
            <LockKeyIcon className="pointer-events-none absolute left-3 size-4 text-muted-foreground/70" />
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder={t("login.passwordPlaceholder")}
              className="h-10 pl-9 pr-9 text-sm transition-all focus-visible:ring-2 focus-visible:ring-primary/20"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              aria-label={
                showPassword
                  ? t("common:accessibility.hidePassword")
                  : t("common:accessibility.showPassword")
              }
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeSlashIcon className="size-4" />
              ) : (
                <EyeIcon className="size-4" />
              )}
            </button>
          </div>
        </div>

        <Button
          type="submit"
          disabled={loginMutation.isPending}
          className="mt-2 h-10 w-full text-xs font-semibold tracking-wide transition-all shadow-xs active:scale-[0.99]"
        >
          {loginMutation.isPending ? (
            <span className="inline-flex items-center gap-2">
              <CircleNotchIcon className="size-4 animate-spin" />
              {t("login.submitting")}
            </span>
          ) : (
            t("login.submit")
          )}
        </Button>
      </form>

      {footer}
    </div>
  )
}
