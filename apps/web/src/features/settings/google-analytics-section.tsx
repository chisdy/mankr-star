import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CheckCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Badge } from "@workspace/ui/components/badge"
import { GOOGLE_ANALYTICS_MEASUREMENT_ID_RE } from "@mankr/shared"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import { patchAuthStatus, useAuth } from "@/hooks/use-auth"

export function GoogleAnalyticsSection() {
  const { t } = useTranslation(["settings", "common", "errors"])
  const queryClient = useQueryClient()
  const { status } = useAuth()

  const configuredId = status?.google_analytics_measurement_id ?? null
  const [measurementId, setMeasurementId] = React.useState("")

  React.useEffect(() => {
    if (configuredId) setMeasurementId(configuredId)
  }, [configuredId])

  const saveMutation = useMutation({
    mutationFn: (id: string | null) =>
      api.updateAnalyticsSettings({ measurement_id: id }),
    onSuccess: (res) => {
      patchAuthStatus(queryClient, {
        google_analytics_measurement_id: res.google_analytics_measurement_id,
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.status })
      toast.success(t("toasts.analyticsSaved"))
      setMeasurementId(res.google_analytics_measurement_id ?? "")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const clearMutation = useMutation({
    mutationFn: () =>
      api.updateAnalyticsSettings({ measurement_id: null }),
    onSuccess: (res) => {
      patchAuthStatus(queryClient, {
        google_analytics_measurement_id: res.google_analytics_measurement_id,
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.status })
      toast.success(t("toasts.analyticsCleared"))
      setMeasurementId("")
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = measurementId.trim()
    if (!trimmed) {
      saveMutation.mutate(null)
      return
    }
    if (!GOOGLE_ANALYTICS_MEASUREMENT_ID_RE.test(trimmed)) {
      toast.error(t("analytics.invalidMeasurementId"))
      return
    }
    saveMutation.mutate(trimmed.toUpperCase())
  }

  return (
    <section id="analytics" className="scroll-mt-16 space-y-4 border-t border-border pt-6 lg:scroll-mt-6">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
          <span>{t("analytics.section")}</span>
          {configuredId ? (
            <Badge
              variant="outline"
              className="text-[10px] text-emerald-700 border-emerald-500/30 bg-emerald-500/10 dark:text-emerald-400"
            >
              <CheckCircleIcon className="size-3 mr-1" />
              {t("analytics.configuredBadge", { id: configuredId })}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">
              {t("analytics.unconfiguredBadge")}
            </Badge>
          )}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("analytics.description")}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 bg-card p-4 rounded-xl border border-border/60"
      >
        <div className="space-y-1.5">
          <Label htmlFor="gaMeasurementId" className="text-xs font-medium">
            {t("analytics.measurementIdLabel")}
          </Label>
          <Input
            id="gaMeasurementId"
            value={measurementId}
            onChange={(e) => setMeasurementId(e.target.value)}
            placeholder={t("analytics.measurementIdPlaceholder")}
            className="h-9 text-xs md:text-sm font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">
            {t("analytics.hint")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={saveMutation.isPending}
            className="text-xs font-medium"
          >
            {saveMutation.isPending
              ? t("common:actions.wait")
              : t("analytics.save")}
          </Button>

          {configuredId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm(t("analytics.clearConfirm"))) {
                  clearMutation.mutate()
                }
              }}
              disabled={clearMutation.isPending}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              {t("analytics.clear")}
            </Button>
          )}
        </div>
      </form>
    </section>
  )
}
