import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { CheckCircleIcon, PlugsConnectedIcon } from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Badge } from "@workspace/ui/components/badge"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"

export function CloudflareSettingsSection() {
  const { t } = useTranslation(["settings", "common", "errors"])
  const queryClient = useQueryClient()

  const { data: user } = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => api.getMe(),
  })

  const [accountId, setAccountId] = React.useState("")
  const [token, setToken] = React.useState("")

  React.useEffect(() => {
    if (user?.cloudflare_account_id) {
      setAccountId(user.cloudflare_account_id)
    }
  }, [user?.cloudflare_account_id])

  const updateMutation = useMutation({
    mutationFn: () =>
      api.updateCloudflareSettings({
        account_id: accountId.trim() || undefined,
        api_token: token.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      queryClient.invalidateQueries({
        queryKey: queryKeys.insights.cloudflareQuota,
      })
      toast.success(t("toasts.cloudflareSaved"))
      setToken("")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const clearMutation = useMutation({
    mutationFn: () => api.clearCloudflareSettings(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      queryClient.invalidateQueries({
        queryKey: queryKeys.insights.cloudflareQuota,
      })
      toast.success(t("toasts.cloudflareCleared"))
      setAccountId("")
      setToken("")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const testMutation = useMutation({
    mutationFn: () => api.testCloudflareConnection(),
    onSuccess: (res) => {
      if (res.success) toast.success(t("toasts.cloudflareTestSuccess"))
      else toast.error(res.message)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  return (
    <section id="cloudflare" className="scroll-mt-16 space-y-4 border-t border-border pt-6 lg:scroll-mt-6">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
          <span>{t("cloudflare.section")}</span>
          {user?.cloudflare_configured ? (
            <Badge
              variant="outline"
              className="text-[10px] text-emerald-700 border-emerald-500/30 bg-emerald-500/10 dark:text-emerald-400"
            >
              <CheckCircleIcon className="size-3 mr-1" />
              {t("cloudflare.configuredBadge", {
                last4: user.cloudflare_token_last4 || "Token",
              })}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">
              {t("cloudflare.unconfiguredBadge")}
            </Badge>
          )}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("cloudflare.description")}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const nextAccountId =
            accountId.trim() || user?.cloudflare_account_id || ""
          if (!nextAccountId && !token.trim()) {
            toast.error(t("cloudflare.needBoth"))
            return
          }
          updateMutation.mutate()
        }}
        className="space-y-4 bg-card p-4 rounded-xl border border-border/60"
      >
        <div className="space-y-1.5">
          <Label htmlFor="cfAccountId" className="text-xs font-medium">
            {t("cloudflare.accountIdLabel")}
          </Label>
          <Input
            id="cfAccountId"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder={t("cloudflare.accountIdPlaceholder")}
            className="h-9 text-xs md:text-sm font-mono"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cfToken" className="text-xs font-medium">
            {t("cloudflare.tokenLabel")}
          </Label>
          <Input
            id="cfToken"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              user?.cloudflare_token_last4
                ? t("cloudflare.savedTokenPlaceholder", {
                    last4: user.cloudflare_token_last4,
                  })
                : t("cloudflare.tokenPlaceholder")
            }
            className="h-9 text-xs md:text-sm font-mono"
            autoComplete="off"
          />
        </div>

        <p className="text-[11px] text-muted-foreground">
          {t("cloudflare.hint")}{" "}
          <Link
            to="/insights"
            className="text-foreground underline-offset-2 hover:underline"
          >
            {t("cloudflare.insightsLink")}
          </Link>
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            type="submit"
            size="sm"
            disabled={updateMutation.isPending}
            className="text-xs font-medium"
          >
            {updateMutation.isPending
              ? t("common:actions.wait")
              : t("cloudflare.save")}
          </Button>

          {user?.cloudflare_configured && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                className="text-xs gap-1.5"
              >
                <PlugsConnectedIcon className="size-3.5" />
                <span>{t("cloudflare.test")}</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm(t("cloudflare.clearConfirm"))) {
                    clearMutation.mutate()
                  }
                }}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                {t("cloudflare.clear")}
              </Button>
            </>
          )}
        </div>
      </form>
    </section>
  )
}
