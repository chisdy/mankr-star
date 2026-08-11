import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CopyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Badge } from "@workspace/ui/components/badge"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"

export function ApiTokensSection() {
  const { t } = useTranslation(["settings", "common", "errors"])
  const queryClient = useQueryClient()
  const [name, setName] = React.useState("")
  const [createdToken, setCreatedToken] = React.useState<string | null>(null)

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: queryKeys.apiTokens.all,
    queryFn: () => api.listApiTokens(),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createApiToken({
        name: name.trim() || t("apiTokens.defaultName"),
        scopes: ["read", "write"],
      }),
    onSuccess: (res) => {
      setCreatedToken(res.token)
      setName("")
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
      toast.success(t("apiTokens.createdToast"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("apiTokens.createError"))
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.revokeApiToken(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
      toast.success(t("apiTokens.revokedToast"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("apiTokens.revokeError"))
    },
  })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {t("apiTokens.title")}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("apiTokens.description")}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="api-token-name" className="text-xs">
            {t("apiTokens.nameLabel")}
          </Label>
          <Input
            id="api-token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("apiTokens.namePlaceholder")}
            className="h-9 text-sm"
            maxLength={64}
          />
        </div>
        <Button
          type="button"
          size="sm"
          className="h-9 gap-1.5 text-xs"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          <PlusIcon className="size-3.5" />
          {t("apiTokens.create")}
        </Button>
      </div>

      {createdToken ? (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs text-muted-foreground">
            {t("apiTokens.copyOnce")}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
              {createdToken}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1 text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(createdToken)
                toast.success(t("apiTokens.copied"))
              }}
            >
              <CopyIcon className="size-3.5" />
              {t("common:actions.copy")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("apiTokens.mcpHint", {
              url: typeof window !== "undefined"
                ? `${window.location.origin}/api/mcp`
                : "/api/mcp",
            })}
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common:actions.wait")}</p>
        ) : tokens.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("apiTokens.empty")}</p>
        ) : (
          tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{token.name}</span>
                  <code className="font-mono text-[11px] text-muted-foreground">
                    {token.token_prefix}…
                  </code>
                  {token.scopes.map((scope) => (
                    <Badge key={scope} variant="secondary" className="text-[10px]">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-destructive"
                aria-label={t("apiTokens.revoke")}
                disabled={revokeMutation.isPending}
                onClick={() => revokeMutation.mutate(token.id)}
              >
                <TrashIcon className="size-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
