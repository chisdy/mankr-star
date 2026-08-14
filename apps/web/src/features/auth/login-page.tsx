import { Link, useNavigate, useSearchParams } from "react-router"
import { motion, useReducedMotion, type Variants } from "framer-motion"
import { useTranslation } from "react-i18next"

import { BrandLogo } from "@/components/brand-logo"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { LoginForm } from "./login-form"
import { safeNextPath, useAuth } from "@/hooks/use-auth"

export function LoginPage() {
  const { t } = useTranslation("auth")
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const shouldReduceMotion = useReducedMotion()
  const { status } = useAuth()
  // 仅未初始化时展示注册入口；加载中或已初始化均隐藏，避免闪烁
  const showRegister = status?.initialized === false

  const containerVariants: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.3, ease: "easeOut" },
    },
  }

  return (
    <div className="relative grid min-h-[100dvh] w-full grid-cols-1 bg-background antialiased md:grid-cols-2">
      <LocaleSwitcher
        variant="compact"
        className="absolute top-4 right-4 z-10"
      />

      <div className="flex flex-col justify-between border-b border-border/60 bg-muted/30 p-8 md:border-r md:border-b-0 md:p-12 lg:p-16">
        <div>
          <div className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            <BrandLogo
              variant="flat"
              className="size-9 rounded-md bg-primary text-primary-foreground"
              iconClassName="size-7"
            />
            <span>Mankr Star</span>
          </div>
        </div>

        <div className="my-auto py-12 md:py-0">
          <p className="text-xl leading-snug font-medium tracking-tight text-foreground md:text-2xl">
            {t("brand.tagline")}
          </p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("brand.loginDescription")}
          </p>
        </div>

        <div className="text-xs text-muted-foreground">{t("brand.badge")}</div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <motion.div
          className="w-full max-w-sm space-y-6"
          initial="hidden"
          animate="visible"
          variants={containerVariants}
        >
          <div className="space-y-1 text-left">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {t("login.pageTitle")}
            </h1>
            <p className="text-xs text-muted-foreground">
              {t("login.pageDescription")}
            </p>
          </div>

          <LoginForm
            onSuccess={() => {
              const next = safeNextPath(searchParams.get("next"))
              navigate(next || "/")
            }}
            footer={
              showRegister ? (
                <div className="text-center text-xs text-muted-foreground">
                  {t("login.registerPrompt")}{" "}
                  <Link
                    to="/register"
                    className="font-medium text-primary hover:underline"
                  >
                    {t("login.registerLink")}
                  </Link>
                </div>
              ) : null
            }
          />
        </motion.div>
      </div>
    </div>
  )
}
