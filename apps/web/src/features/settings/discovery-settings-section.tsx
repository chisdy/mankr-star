import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import type { DiscoveryChannelsResponse } from "@/lib/types"

export function DiscoverySettingsSection() {
  const { t } = useTranslation(["settings", "common", "errors"])
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: queryKeys.settings.discovery,
    queryFn: () => api.getDiscoverySettings(),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.enabled && !query.state.data.ready && !query.state.error
        ? 15_000
        : false,
  })

  const update = useMutation({
    mutationFn: (enabled: boolean) => api.updateDiscoverySettings({ enabled }),
    onSuccess: async (response) => {
      queryClient.setQueryData(queryKeys.settings.discovery, response)
      queryClient.setQueriesData<DiscoveryChannelsResponse>(
        { queryKey: ["discovery", "channels"] },
        (previous) => (previous ? { ...previous, ...response } : previous)
      )
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.settings.discovery,
        }),
        queryClient.invalidateQueries({ queryKey: ["discovery", "channels"] }),
        queryClient.invalidateQueries({ queryKey: ["bookmarks", "discovery"] }),
      ])
      toast.success(
        t(
          response.enabled
            ? "discovery.enabledToast"
            : "discovery.disabledToast"
        )
      )
    },
    onError: (error: Error) => toast.error(formatApiError(error, t)),
  })

  return (
    <section
      id="discovery"
      className="scroll-mt-16 space-y-4 border-t border-border pt-6 lg:scroll-mt-6"
    >
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("discovery.section")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("discovery.description")}
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="discovery-enabled" className="text-xs font-medium">
              {t("discovery.enable")}
            </Label>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("discovery.sourceHint")}
            </p>
          </div>
          <Switch
            id="discovery-enabled"
            checked={settings.data?.enabled ?? false}
            disabled={
              settings.isFetching ||
              settings.isError ||
              !settings.data ||
              update.isPending
            }
            onCheckedChange={(enabled) => update.mutate(enabled)}
            aria-label={t("discovery.enable")}
          />
        </div>

        {settings.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-xs text-destructive"
          >
            <span>{t("discovery.loadError")}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void settings.refetch()}
              disabled={settings.isFetching}
            >
              {t("discovery.retry")}
            </Button>
          </div>
        ) : settings.data ? (
          <div
            role="status"
            className="space-y-2 text-[11px] leading-relaxed text-muted-foreground"
          >
            <p>
              {t(
                !settings.data.enabled
                  ? "discovery.disabledHint"
                  : settings.data.ready
                    ? "discovery.readyHint"
                    : "discovery.preparingHint"
              )}
            </p>
            {settings.data.enabled && settings.data.ready && (
              <Link
                to="/discover"
                className="inline-block rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t("discovery.view")}
              </Link>
            )}
          </div>
        ) : (
          <p role="status" className="text-[11px] text-muted-foreground">
            {t("common:actions.wait")}
          </p>
        )}
      </div>
    </section>
  )
}
