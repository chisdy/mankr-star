import * as React from "react"
import { Link, useNavigate } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion, useReducedMotion, type Variants } from "framer-motion"
import { useTranslation } from "react-i18next"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { BrandLogo } from "@/components/brand-logo"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { ApiError, api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import { patchAuthStatus } from "@/hooks/use-auth"

export function RegisterPage() {
  const { t } = useTranslation("auth")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const shouldReduceMotion = useReducedMotion()

  const [username, setUsername] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [isInitialized, setIsInitialized] = React.useState<boolean>(false)

  // 实例是否已有唯一账号（已初始化则不允许再次注册）
  const { data: instanceStatus } = useQuery({
    queryKey: queryKeys.auth.status,
    queryFn: () => api.getInstanceStatus(),
    retry: false,
  })

  React.useEffect(() => {
    if (instanceStatus?.initialized) {
      setIsInitialized(true)
    }
  }, [instanceStatus])

  const registerMutation = useMutation({
    mutationFn: () =>
      api.register({
        email: email.trim(),
        password,
        ...(username.trim() ? { username: username.trim() } : {}),
      }),
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
      navigate("/")
    },
    onError: (err: unknown) => {
      if (
        err instanceof ApiError &&
        (err.code === "INSTANCE_INITIALIZED" || err.status === 409)
      ) {
        setIsInitialized(true)
      } else {
        setErrorMessage(formatApiError(err, t))
      }
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!email.trim() || !password.trim()) {
      setErrorMessage(t("register.required"))
      return
    }

    if (password.length < 8) {
      setErrorMessage(t("register.passwordMin"))
      return
    }

    registerMutation.mutate()
  }

  const containerVariants: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.3, ease: "easeOut" },
    },
  }

  return (
    <div className="relative grid min-h-[100dvh] w-full grid-cols-1 md:grid-cols-2 bg-background antialiased">
      <LocaleSwitcher
        variant="compact"
        className="absolute top-4 right-4 z-10"
      />

      {/* Brand Left Panel */}
      <div className="flex flex-col justify-between border-b border-border md:border-b-0 md:border-r border-border/60 bg-muted/30 p-8 md:p-12 lg:p-16">
        <div>
          <div className="flex items-center gap-2 font-bold tracking-tight text-foreground text-2xl md:text-3xl">
            <BrandLogo
              className="size-9 rounded-md bg-primary text-primary-foreground"
              iconClassName="size-5"
            />
            <span>Mankr Star</span>
          </div>
        </div>

        <div className="my-auto py-12 md:py-0">
          <p className="text-xl md:text-2xl font-medium tracking-tight text-foreground leading-snug">
            {t("brand.tagline")}
          </p>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-md">
            {t("brand.registerDescription")}
          </p>
        </div>

        <div className="text-xs text-muted-foreground">
          {t("brand.badge")}
        </div>
      </div>

      {/* Form Right Panel */}
      <div className="flex items-center justify-center p-6 md:p-12">
        <motion.div
          className="w-full max-w-sm space-y-6"
          initial="hidden"
          animate="visible"
          variants={containerVariants}
        >
          {isInitialized ? (
            /* Instance Already Initialized State */
            <div className="space-y-4">
              <Alert variant="default" className="border-muted bg-muted/40 p-4">
                <AlertTitle className="text-sm font-semibold">
                  {t("register.initializedTitle")}
                </AlertTitle>
                <AlertDescription className="mt-2 text-xs leading-normal text-muted-foreground">
                  {t("register.initializedDescription")}
                </AlertDescription>
              </Alert>

              <Button
                onClick={() => navigate("/login")}
                className="w-full h-9 font-medium text-xs"
              >
                {t("register.goLogin")}
              </Button>
            </div>
          ) : (
            /* Registration Form */
            <>
              <div className="space-y-1 text-left">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  {t("register.title")}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {t("register.description")}
                </p>
              </div>

              {errorMessage && (
                <Alert variant="destructive" className="py-2.5 text-xs">
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="text-xs font-medium">
                    {t("register.usernameLabel")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("register.usernameHint")}
                    </span>
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    placeholder={t("register.usernamePlaceholder")}
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-medium">
                    {t("register.emailLabel")}{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="name@example.com"
                    className="h-9 text-sm"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-medium">
                    {t("register.passwordLabel")}{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder={t("register.passwordPlaceholder")}
                    className="h-9 text-sm"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={registerMutation.isPending}
                  className="w-full h-9 font-medium text-xs mt-2"
                >
                  {registerMutation.isPending
                    ? t("common:actions.wait")
                    : t("register.submit")}
                </Button>
              </form>

              <div className="text-center text-xs text-muted-foreground">
                {t("register.existingPrompt")}{" "}
                <Link
                  to="/login"
                  className="text-primary hover:underline font-medium"
                >
                  {t("register.loginLink")}
                </Link>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  )
}
