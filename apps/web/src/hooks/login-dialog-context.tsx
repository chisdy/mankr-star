import * as React from "react"

type LoginDialogContextValue = {
  open: boolean
  openLogin: () => void
  closeLogin: () => void
  setOpen: (open: boolean) => void
}

const LoginDialogContext = React.createContext<LoginDialogContextValue | null>(
  null,
)

/** 仅管理登录弹窗开关状态；UI 由 features/auth/login-dialog 渲染 */
export function LoginDialogProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)

  const openLogin = React.useCallback(() => setOpen(true), [])
  const closeLogin = React.useCallback(() => setOpen(false), [])

  const value = React.useMemo<LoginDialogContextValue>(
    () => ({ open, openLogin, closeLogin, setOpen }),
    [open, openLogin, closeLogin],
  )

  return (
    <LoginDialogContext.Provider value={value}>
      {children}
    </LoginDialogContext.Provider>
  )
}

export function useLoginDialog() {
  const ctx = React.useContext(LoginDialogContext)
  if (!ctx) {
    throw new Error("useLoginDialog must be used within LoginDialogProvider")
  }
  return ctx
}

/** Provider 外安全调用（返回 null） */
export function useOptionalLoginDialog() {
  return React.useContext(LoginDialogContext)
}
