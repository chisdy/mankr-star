import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { PlugsConnectedIcon } from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { Badge } from "@workspace/ui/components/badge"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"

export function EmbeddingSettingsSection() {
  const { t } = useTranslation(["settings", "common", "errors"])
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [baseUrl, setBaseUrl] = React.useState(
    user?.embedding_base_url ?? "https://api.openai.com/v1",
  )
  const [model, setModel] = React.useState(
    user?.embedding_model ?? "text-embedding-3-small",
  )
  const [apiKey, setApiKey] = React.useState("")
  const [reuseAiKey, setReuseAiKey] = React.useState(
    Boolean(user?.embedding_reuse_ai_key),
  )

  React.useEffect(() => {
    if (user?.embedding_base_url) setBaseUrl(user.embedding_base_url)
    if (user?.embedding_model) setModel(user.embedding_model)
    setReuseAiKey(Boolean(user?.embedding_reuse_ai_key))
  }, [
    user?.embedding_base_url,
    user?.embedding_model,
    user?.embedding_reuse_ai_key,
  ])

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateEmbeddingSettings({
        base_url: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        reuse_ai_key: reuseAiKey,
      }),
    onSuccess: () => {
      setApiKey("")
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
      toast.success(t("embedding.savedToast"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("embedding.saveError"))
    },
  })

  const testMutation = useMutation({
    mutationFn: () => api.testEmbeddingConnection(),
    onSuccess: (res) => {
      if (res.success) toast.success(res.message)
      else toast.error(res.message)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("embedding.testError"))
    },
  })

  return (
    <div className="space-y-4 border-t border-border/60 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-foreground">
            {t("embedding.title")}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("embedding.description")}
          </p>
        </div>
        {user?.embedding_configured ? (
          <Badge
            variant="outline"
            className="text-[10px] text-emerald-700 border-emerald-500/30 bg-emerald-500/10"
          >
            {t("embedding.configured")}
          </Badge>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t("embedding.baseUrl")}</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
          className="h-9 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("embedding.model")}</Label>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="text-embedding-3-small"
          className="h-9 text-sm"
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
        <div>
          <p className="text-xs font-medium">{t("embedding.reuseAiKey")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("embedding.reuseAiKeyHint")}
          </p>
        </div>
        <Switch checked={reuseAiKey} onCheckedChange={setReuseAiKey} />
      </div>
      {!reuseAiKey ? (
        <div className="space-y-1.5">
          <Label className="text-xs">{t("embedding.apiKey")}</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              user?.embedding_last4
                ? `••••${user.embedding_last4}`
                : t("embedding.apiKeyPlaceholder")
            }
            className="h-9 text-sm"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 text-xs"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {t("embedding.save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          disabled={testMutation.isPending || !user?.embedding_configured}
          onClick={() => testMutation.mutate()}
        >
          <PlugsConnectedIcon className="size-3.5" />
          {t("embedding.test")}
        </Button>
      </div>
    </div>
  )
}
