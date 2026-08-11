import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  CheckCircleIcon,
  SignOutIcon,
  DownloadSimpleIcon,
  PlugsConnectedIcon,
  LockKeyIcon,
  SunIcon,
  MoonIcon,
  DesktopIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Badge } from "@workspace/ui/components/badge"
import { Switch } from "@workspace/ui/components/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { api } from "@/lib/api"
import type { TrackingSettings } from "@/lib/types"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import { useTheme } from "@/components/theme-provider"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { SectionNav, type SectionNavItem } from "@/components/section-nav"
import { BookmarkListSection } from "./bookmark-list-section"
import { ApiTokensSection } from "./api-tokens-section"
import { ClearDataSection } from "./clear-data-section"
import { CloudflareSettingsSection } from "./cloudflare-settings-section"
import { EmbeddingSettingsSection } from "./embedding-settings-section"
import { GithubImportSection } from "./github-import-section"
import { GoogleAnalyticsSection } from "./google-analytics-section"

/** 动态订阅开关；顺序与动态流筛选一致 */
const EVENT_PREFS = [
  { key: "event_push", labelKey: "tracking.eventPush" },
  { key: "event_release", labelKey: "tracking.eventRelease" },
  { key: "event_stars_delta", labelKey: "tracking.eventStarsDelta" },
  { key: "event_meta_change", labelKey: "tracking.eventMetaChange" },
] as const

const SECTION_NAV_KEYS = [
  { id: "account", labelKey: "nav.account" },
  { id: "api-tokens", labelKey: "nav.apiTokens" },
  { id: "deepseek", labelKey: "nav.deepseek" },
  { id: "anysearch", labelKey: "nav.anysearch" },
  { id: "cloudflare", labelKey: "nav.cloudflare" },
  { id: "github", labelKey: "nav.github" },
  { id: "import", labelKey: "nav.import" },
  { id: "tracking", labelKey: "nav.tracking" },
  { id: "bookmark-list", labelKey: "nav.bookmarkList" },
  { id: "visibility", labelKey: "nav.visibility" },
  { id: "analytics", labelKey: "nav.analytics" },
  { id: "export", labelKey: "nav.export" },
  { id: "danger", labelKey: "nav.danger" },
  { id: "appearance", labelKey: "nav.appearance" },
] as const

const SECTION_CLASS =
  "scroll-mt-16 space-y-4 border-t border-border pt-6 lg:scroll-mt-6"

export function SettingsPage() {
  const { t } = useTranslation(["settings", "common", "errors"])
  const queryClient = useQueryClient()
  const { theme, setTheme } = useTheme()

  // User query
  const { data: user } = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => api.getMe(),
  })

  // DeepSeek form state
  const [deepseekKey, setDeepseekKey] = React.useState("")
  const [deepseekModel, setDeepseekModel] = React.useState<string>(
    user?.deepseek_model || "deepseek-v4-flash"
  )

  React.useEffect(() => {
    if (user?.deepseek_model) {
      setDeepseekModel(user.deepseek_model)
    }
    if (user?.hot_within_days != null) {
      setHotWithinDays(String(user.hot_within_days))
    }
    if (user?.stale_after_days != null) {
      setStaleAfterDays(String(user.stale_after_days))
    }
  }, [user])

  // AnySearch form state
  const [anysearchKey, setAnysearchKey] = React.useState("")

  // GitHub PAT state
  const [githubPat, setGithubPat] = React.useState("")

  // Tracking thresholds
  const [hotWithinDays, setHotWithinDays] = React.useState(
    String(user?.hot_within_days ?? 30)
  )
  const [staleAfterDays, setStaleAfterDays] = React.useState(
    String(user?.stale_after_days ?? 180)
  )

  // Change Password state
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")

  // Mutations
  const updateDeepSeekMutation = useMutation({
    mutationFn: () =>
      api.updateDeepSeekSettings({
        api_key: deepseekKey.trim() || undefined,
        model: deepseekModel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      toast.success(t("toasts.deepseekSaved"))
      setDeepseekKey("")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const clearDeepSeekMutation = useMutation({
    mutationFn: () => api.clearDeepSeekKey(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      toast.success(t("toasts.deepseekCleared"))
      setDeepseekKey("")
    },
  })

  const testDeepSeekMutation = useMutation({
    mutationFn: () => api.testDeepSeekConnection(),
    onSuccess: () => {
      toast.success(t("toasts.deepseekTestSuccess"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const updateAnySearchMutation = useMutation({
    mutationFn: () =>
      api.updateAnySearchSettings({ api_key: anysearchKey.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      toast.success(t("toasts.anysearchSaved"))
      setAnysearchKey("")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const clearAnySearchMutation = useMutation({
    mutationFn: () => api.clearAnySearchKey(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      toast.success(t("toasts.anysearchCleared"))
      setAnysearchKey("")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const testAnySearchMutation = useMutation({
    mutationFn: () => api.testAnySearchConnection(),
    onSuccess: (res) => {
      if (res.success) toast.success(t("toasts.anysearchTestSuccess"))
      else toast.error(res.message)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const updatePatMutation = useMutation({
    mutationFn: () => api.updateGithubPat({ pat: githubPat.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      toast.success(t("toasts.patSaved"))
      setGithubPat("")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const clearPatMutation = useMutation({
    mutationFn: () => api.updateGithubPat({}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      toast.success(t("toasts.patCleared"))
      setGithubPat("")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const updateTrackingMutation = useMutation({
    mutationFn: () =>
      api.updateTrackingSettings({
        hot_within_days: Number(hotWithinDays),
        stale_after_days: Number(staleAfterDays),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      setHotWithinDays(String(res.hot_within_days))
      setStaleAfterDays(String(res.stale_after_days))
      toast.success(t("toasts.trackingSaved"))
    },
    onError: (err: Error) => toast.error(formatApiError(err, t)),
  })

  const updateEventPrefMutation = useMutation({
    mutationFn: (patch: Partial<TrackingSettings>) =>
      api.updateTrackingSettings(patch),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.auth.me, (prev: typeof user) =>
        prev ? { ...prev, ...res } : prev,
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      toast.success(t("toasts.trackingSaved"))
    },
    onError: (err: Error) => toast.error(formatApiError(err, t)),
  })

  const updatePublicBrowsingMutation = useMutation({
    mutationFn: (enabled: boolean) => api.updatePublicBrowsing({ enabled }),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.auth.me, (prev: typeof user) =>
        prev
          ? { ...prev, public_browsing_enabled: res.public_browsing_enabled }
          : prev,
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.status })
      toast.success(
        res.public_browsing_enabled
          ? t("toasts.publicBrowsingEnabled")
          : t("toasts.publicBrowsingDisabled"),
      )
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const changePasswordMutation = useMutation({
    mutationFn: () =>
      api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    onSuccess: () => {
      toast.success(t("toasts.passwordChanged"))
      setCurrentPassword("")
      setNewPassword("")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const downloadFile = (content: string, type: string, ext: string) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `mankr-star-export-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportMutation = useMutation({
    mutationFn: () => api.getExportData(),
    onSuccess: (data) => {
      downloadFile(JSON.stringify(data, null, 2), "application/json", "json")
      toast.success(t("toasts.exportSuccess"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const exportMarkdownMutation = useMutation({
    mutationFn: () => api.exportMarkdown(),
    onSuccess: (markdown) => {
      downloadFile(markdown, "text/markdown;charset=utf-8", "md")
      toast.success(t("toasts.exportSuccess"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      queryClient.clear()
      window.location.href = "/login"
    },
  })

  const navItems: SectionNavItem[] = SECTION_NAV_KEYS.map(({ id, labelKey }) => ({
    id,
    label: t(labelKey),
  }))

  return (
    <div className="pb-16 text-foreground">
      <div className="mb-6 border-b border-border pb-4 lg:mx-auto lg:max-w-[calc(12.5rem+2.5rem+48rem)]">
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <SectionNav items={navItems} ariaLabel={t("nav.ariaLabel")}>
        <div className="space-y-8">
      {/* Section 1: Account */}
      <section id="account" className="scroll-mt-16 space-y-4 lg:scroll-mt-6">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("account.section")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-card p-4 rounded-xl border border-border/60 text-xs">
          <div>
            <span className="text-muted-foreground">{t("account.username")}</span>{" "}
            <span className="font-medium text-foreground">{user?.username || "demo_user"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("account.email")}</span>{" "}
            <span className="font-medium text-foreground">{user?.email || t("account.noEmail")}</span>
          </div>
        </div>

        {/* Change Password */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!currentPassword) {
              toast.error(t("password.currentRequired"))
              return
            }
            if (!newPassword || newPassword.length < 8) {
              toast.error(t("password.newMin"))
              return
            }
            changePasswordMutation.mutate()
          }}
          className="space-y-3 bg-card p-4 rounded-xl border border-border/60"
        >
          <div className="text-xs font-medium flex items-center gap-1.5">
            <LockKeyIcon className="size-4 text-muted-foreground" />
            <span>{t("password.title")}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="currPass" className="text-[11px] font-normal text-muted-foreground">
                {t("password.currentLabel")}
              </Label>
              <Input
                id="currPass"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t("password.currentPlaceholder")}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="newPass" className="text-[11px] font-normal text-muted-foreground">
                {t("password.newLabel")}
              </Label>
              <Input
                id="newPass"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("password.newPlaceholder")}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex justify-between items-center pt-1">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!newPassword || changePasswordMutation.isPending}
              className="text-xs h-8"
            >
              {changePasswordMutation.isPending
                ? t("common:actions.wait")
                : t("password.update")}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => logoutMutation.mutate()}
              className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
            >
              <SignOutIcon className="size-3.5" />
              <span>{t("common:actions.logout")}</span>
            </Button>
          </div>
        </form>
      </section>

      <section id="api-tokens" className={SECTION_CLASS}>
        <ApiTokensSection />
      </section>

      {/* Section 2: DeepSeek AI */}
      <section id="deepseek" className={SECTION_CLASS}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
              <span>{t("deepseek.section")}</span>
              {user?.deepseek_configured ? (
                <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-500/30 bg-emerald-500/10 dark:text-emerald-400">
                  <CheckCircleIcon className="size-3 mr-1" />
                  {t("deepseek.configuredBadge", {
                    last4: user.deepseek_last4 || "Key",
                  })}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  {t("deepseek.unconfiguredBadge")}
                </Badge>
              )}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("deepseek.description")}
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            updateDeepSeekMutation.mutate()
          }}
          className="space-y-4 bg-card p-4 rounded-xl border border-border/60"
        >
          <div className="space-y-1.5">
            <Label htmlFor="deepseekKey" className="text-xs font-medium">
              DeepSeek API Key
            </Label>
            <Input
              id="deepseekKey"
              type="password"
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              placeholder={
                user?.deepseek_configured
                  ? t("deepseek.savedKeyPlaceholder", {
                      last4: user.deepseek_last4 || "",
                    })
                  : t("deepseek.keyPlaceholder")
              }
              className="h-9 text-xs md:text-sm font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="model" className="text-xs font-medium">
              {t("deepseek.modelLabel")}
            </Label>
            <Select
              items={[
                {
                  value: "deepseek-v4-flash",
                  label: t("deepseek.modelFlash"),
                },
                {
                  value: "deepseek-v4-pro",
                  label: t("deepseek.modelPro"),
                },
              ]}
              value={deepseekModel}
              onValueChange={(val) =>
                setDeepseekModel(val || "deepseek-v4-flash")
              }
            >
              <SelectTrigger id="model" className="h-9 w-full text-xs sm:w-64">
                <SelectValue placeholder={t("deepseek.modelPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deepseek-v4-flash">
                  {t("deepseek.modelFlash")}
                </SelectItem>
                <SelectItem value="deepseek-v4-pro">
                  {t("deepseek.modelPro")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              type="submit"
              size="sm"
              disabled={updateDeepSeekMutation.isPending}
              className="text-xs font-medium"
            >
              {updateDeepSeekMutation.isPending
                ? t("common:actions.wait")
                : t("deepseek.save")}
            </Button>

            {user?.deepseek_configured && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => testDeepSeekMutation.mutate()}
                  disabled={testDeepSeekMutation.isPending}
                  className="text-xs gap-1.5"
                >
                  <PlugsConnectedIcon className="size-3.5" />
                  <span>{t("deepseek.test")}</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(t("deepseek.clearConfirm"))) {
                      clearDeepSeekMutation.mutate()
                    }
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  {t("deepseek.clear")}
                </Button>
              </>
            )}
          </div>
        </form>

        <EmbeddingSettingsSection />
      </section>

      {/* Section 3: AnySearch 联网搜索 */}
      <section id="anysearch" className={SECTION_CLASS}>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
            <span>{t("anysearch.section")}</span>
            {user?.anysearch_configured ? (
              <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-500/30 bg-emerald-500/10 dark:text-emerald-400">
                <CheckCircleIcon className="size-3 mr-1" />
                {t("anysearch.configuredBadge", {
                  last4: user.anysearch_last4 || "Key",
                })}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                {t("anysearch.unconfiguredBadge")}
              </Badge>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("anysearch.description")}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!anysearchKey.trim()) {
              toast.error(t("anysearch.keyRequired"))
              return
            }
            updateAnySearchMutation.mutate()
          }}
          className="space-y-4 bg-card p-4 rounded-xl border border-border/60"
        >
          <div className="space-y-1.5">
            <Label htmlFor="anysearchKey" className="text-xs font-medium">
              AnySearch API Key
            </Label>
            <Input
              id="anysearchKey"
              type="password"
              value={anysearchKey}
              onChange={(e) => setAnysearchKey(e.target.value)}
              placeholder={
                user?.anysearch_configured
                  ? t("anysearch.savedKeyPlaceholder", {
                      last4: user.anysearch_last4 || "",
                    })
                  : t("anysearch.keyPlaceholder")
              }
              className="h-9 text-xs md:text-sm font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("anysearch.hint")}{" "}
              <a
                href="https://www.anysearch.com/console/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t("anysearch.consoleLink")}
              </a>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              type="submit"
              size="sm"
              disabled={updateAnySearchMutation.isPending}
              className="text-xs font-medium"
            >
              {updateAnySearchMutation.isPending
                ? t("common:actions.wait")
                : t("anysearch.save")}
            </Button>

            {user?.anysearch_configured && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => testAnySearchMutation.mutate()}
                  disabled={testAnySearchMutation.isPending}
                  className="text-xs gap-1.5"
                >
                  <PlugsConnectedIcon className="size-3.5" />
                  <span>{t("anysearch.test")}</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(t("anysearch.clearConfirm"))) {
                      clearAnySearchMutation.mutate()
                    }
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  {t("anysearch.clear")}
                </Button>
              </>
            )}
          </div>
        </form>
      </section>

      <CloudflareSettingsSection />

      {/* Section 5: GitHub PAT */}
      <section id="github" className={SECTION_CLASS}>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
            <span>{t("github.section")}</span>
            {user?.github_pat_configured && (
              <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-500/30 bg-emerald-500/10 dark:text-emerald-400">
                {t("github.configuredBadge", {
                  last4: user.github_pat_last4 || "",
                })}
              </Badge>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("github.description")}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            updatePatMutation.mutate()
          }}
          className="space-y-3 bg-card p-4 rounded-xl border border-border/60"
        >
          <div className="space-y-1.5">
            <Label htmlFor="pat" className="text-xs font-medium">
              GitHub PAT
            </Label>
            <Input
              id="pat"
              type="password"
              value={githubPat}
              onChange={(e) => setGithubPat(e.target.value)}
              placeholder={
                user?.github_pat_configured
                  ? t("github.savedPatPlaceholder", {
                      last4: user.github_pat_last4 || "",
                    })
                  : t("github.patPlaceholder")
              }
              className="h-9 text-xs md:text-sm font-mono"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!githubPat || updatePatMutation.isPending}
              className="text-xs font-medium"
            >
              {updatePatMutation.isPending
                ? t("common:actions.wait")
                : t("github.save")}
            </Button>

            {user?.github_pat_configured && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm(t("github.clearConfirm"))) {
                    clearPatMutation.mutate()
                  }
                }}
                disabled={clearPatMutation.isPending}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                {t("github.clear")}
              </Button>
            )}
          </div>
        </form>
      </section>

      {/* Section 5: Import GitHub Stars */}
      <GithubImportSection user={user} />

      {/* Section 6: Update tracking */}
      <section id="tracking" className={SECTION_CLASS}>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {t("tracking.section")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("tracking.description")}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            updateTrackingMutation.mutate()
          }}
          className="space-y-3 bg-card p-4 rounded-xl border border-border/60"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hotDays" className="text-xs font-medium">
                {t("tracking.hotWithinDays")}
              </Label>
              <Input
                id="hotDays"
                type="number"
                min={1}
                max={3650}
                value={hotWithinDays}
                onChange={(e) => setHotWithinDays(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staleDays" className="text-xs font-medium">
                {t("tracking.staleAfterDays")}
              </Label>
              <Input
                id="staleDays"
                type="number"
                min={1}
                max={3650}
                value={staleAfterDays}
                onChange={(e) => setStaleAfterDays(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={updateTrackingMutation.isPending}
            className="text-xs font-medium"
          >
            {updateTrackingMutation.isPending
              ? t("common:actions.wait")
              : t("tracking.save")}
          </Button>
        </form>

        <div className="bg-card p-4 rounded-xl border border-border/60 space-y-3">
          <div className="space-y-0.5">
            <div className="text-xs font-medium">{t("tracking.events")}</div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("tracking.eventsDescription")}
            </p>
          </div>

          {EVENT_PREFS.map(({ key, labelKey }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <Label
                htmlFor={`event-${key}`}
                className="text-[11px] font-normal text-muted-foreground"
              >
                {t(labelKey)}
              </Label>
              <Switch
                id={`event-${key}`}
                checked={user?.[key] ?? true}
                disabled={updateEventPrefMutation.isPending}
                onCheckedChange={(checked) =>
                  updateEventPrefMutation.mutate({ [key]: checked })
                }
                aria-label={t(labelKey)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Section 7: Bookmark list pagination */}
      <BookmarkListSection user={user} />

      {/* Section 8: Visibility */}
      <section id="visibility" className={SECTION_CLASS}>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {t("visibility.section")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("visibility.description")}
          </p>
        </div>

        <div className="bg-card p-4 rounded-xl border border-border/60 flex items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="text-xs font-medium">{t("visibility.publicBrowsing")}</div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("visibility.publicBrowsingDescription")}
            </p>
          </div>
          <Switch
            checked={Boolean(user?.public_browsing_enabled)}
            disabled={updatePublicBrowsingMutation.isPending}
            onCheckedChange={(enabled) =>
              updatePublicBrowsingMutation.mutate(enabled)
            }
            aria-label={t("visibility.publicBrowsing")}
          />
        </div>
      </section>

      <GoogleAnalyticsSection />

      {/* Section: Data Export */}
      <section id="export" className={SECTION_CLASS}>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {t("export.section")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("export.description")}
          </p>
        </div>

        <div className="bg-card p-4 rounded-xl border border-border/60 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <div className="text-xs font-medium">{t("export.title")}</div>
              <p className="text-[11px] text-muted-foreground">{t("export.detail")}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              className="text-xs gap-1.5 shrink-0"
            >
              <DownloadSimpleIcon className="size-4" />
              <span>{t("export.button")}</span>
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
            <div className="space-y-0.5 min-w-0">
              <div className="text-xs font-medium">{t("export.mdTitle")}</div>
              <p className="text-[11px] text-muted-foreground">
                {t("export.mdDetail")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportMarkdownMutation.mutate()}
              disabled={exportMarkdownMutation.isPending}
              className="text-xs gap-1.5 shrink-0"
            >
              <DownloadSimpleIcon className="size-4" />
              <span>{t("export.mdButton")}</span>
            </Button>
          </div>
        </div>
      </section>

      {/* Section 10: Danger zone */}
      <ClearDataSection />

      {/* Section 11: Appearance / Theme */}
      <section id="appearance" className={SECTION_CLASS}>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {t("appearance.section")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("appearance.description")}
          </p>
        </div>

        <div className="bg-card p-4 rounded-xl border border-border/60 grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setTheme("system")}
            className={`flex flex-col items-center justify-center gap-2 p-3 rounded-lg border text-xs font-medium transition-all ${
              theme === "system"
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <DesktopIcon className="size-5" />
            <span>{t("appearance.system")}</span>
          </button>

          <button
            type="button"
            onClick={() => setTheme("light")}
            className={`flex flex-col items-center justify-center gap-2 p-3 rounded-lg border text-xs font-medium transition-all ${
              theme === "light"
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <SunIcon className="size-5" />
            <span>{t("appearance.light")}</span>
          </button>

          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={`flex flex-col items-center justify-center gap-2 p-3 rounded-lg border text-xs font-medium transition-all ${
              theme === "dark"
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <MoonIcon className="size-5" />
            <span>{t("appearance.dark")}</span>
          </button>
        </div>

        <div className="bg-card p-4 rounded-xl border border-border/60 space-y-3">
          <div className="space-y-0.5">
            <div className="text-xs font-medium">{t("appearance.language")}</div>
            <p className="text-[11px] text-muted-foreground">
              {t("appearance.languageDescription")}
            </p>
          </div>
          <LocaleSwitcher variant="cards" />
        </div>
      </section>
        </div>
      </SectionNav>
    </div>
  )
}
