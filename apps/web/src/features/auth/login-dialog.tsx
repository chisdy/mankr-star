import { Link } from "react-router"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { BrandLogo } from "@/components/brand-logo"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { useLoginDialog } from "@/hooks/login-dialog-context"
import { useAuth } from "@/hooks/use-auth"
import { LoginForm } from "./login-form"

/** 登录弹窗 UI；需包在 LoginDialogProvider 内 */
export function LoginDialog() {
  const { t } = useTranslation("auth")
  const { open, setOpen, closeLogin } = useLoginDialog()
  const { status } = useAuth()
  // 仅未初始化时展示注册入口；加载中或已初始化均隐藏，避免闪烁
  const showRegister = status?.initialized === false

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-5 rounded-2xl border-border/80 bg-popover/95 p-6 shadow-xl backdrop-blur-md sm:max-w-[400px] sm:p-7">
        <LocaleSwitcher variant="compact" className="absolute top-4 left-4" />
        <DialogHeader className="items-center space-y-1.5 pt-1 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-2xs">
            <BrandLogo variant="flat" iconClassName="size-8" />
          </div>
          <DialogTitle className="pt-1 text-lg font-semibold tracking-tight text-foreground">
            {t("login.dialogTitle")}
          </DialogTitle>
          <DialogDescription className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
            {t("login.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <LoginForm
            onSuccess={closeLogin}
            footer={
              <div className="space-y-3 pt-2">
                <div className="relative flex items-center justify-center text-xs">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border/60" />
                  </div>
                  <span className="relative bg-popover px-2.5 text-[11px] text-muted-foreground/70">
                    {t("brand.badge")}
                  </span>
                </div>
                {showRegister ? (
                  <div className="text-center text-xs text-muted-foreground">
                    {t("login.registerPrompt")}{" "}
                    <Link
                      to="/register"
                      onClick={closeLogin}
                      className="font-medium text-primary transition-colors hover:underline"
                    >
                      {t("login.registerLink")}
                    </Link>
                  </div>
                ) : null}
              </div>
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export {
  LoginDialogProvider,
  useLoginDialog,
  useOptionalLoginDialog,
} from "@/hooks/login-dialog-context"
