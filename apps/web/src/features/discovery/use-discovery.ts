import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { DISCOVERY_CHANNEL_IDS } from "@mankr/shared"
import { api, ApiError } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import { patchAuthStatus, useAuth } from "@/hooks/use-auth"
import type {
  DiscoveryChannelId,
  DiscoveryItem,
  DiscoveryResponse,
} from "@/lib/types"
import { resolveDiscoveryAccess } from "./discovery-access"

export function resolveDiscoveryChannel(
  value: string | null
): DiscoveryChannelId {
  return (DISCOVERY_CHANNEL_IDS as readonly string[]).includes(value ?? "")
    ? (value as DiscoveryChannelId)
    : "ai"
}

function useDiscoveryAccess() {
  const auth = useAuth()
  return resolveDiscoveryAccess(auth)
}

function useDiscoveryUnauthorized(error: Error | null) {
  const queryClient = useQueryClient()
  React.useEffect(() => {
    if (!(error instanceof ApiError && error.status === 401)) return
    patchAuthStatus(queryClient, { authenticated: false })
    queryClient.removeQueries({ queryKey: queryKeys.auth.me })
    void queryClient.invalidateQueries({ queryKey: queryKeys.auth.status })
  }, [error, queryClient])
}

export function useDiscoveryChannels() {
  const { canRead, accessScope, publicReadEnabled } = useDiscoveryAccess()
  const query = useQuery({
    queryKey: queryKeys.discovery.channels(accessScope, publicReadEnabled),
    queryFn: () => api.getDiscoveryChannels(),
    enabled: canRead,
    staleTime: 300_000,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 401) && count < 1,
    refetchInterval: (current) =>
      current.state.data?.enabled &&
      !current.state.data.ready &&
      !current.state.error
        ? 15_000
        : false,
    refetchOnWindowFocus: "always",
  })
  useDiscoveryUnauthorized(query.error)
  const unauthorized =
    query.error instanceof ApiError && query.error.status === 401
  return { ...query, data: canRead && !unauthorized ? query.data : undefined }
}

export function useDiscovery(channel: DiscoveryChannelId) {
  const { canRead, accessScope, publicReadEnabled } = useDiscoveryAccess()
  const query = useQuery({
    queryKey: queryKeys.bookmarks.discovery(
      channel,
      accessScope,
      publicReadEnabled
    ),
    queryFn: () => api.getDiscovery(channel),
    enabled: canRead,
    staleTime: 300_000,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 401) && count < 1,
    // 内容缓存 5 分钟，但重进页面和窗口聚焦必须收敛扩展/导入的收藏写入。
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: (current) =>
      current.state.data?.state === "initializing" ||
      current.state.data?.state === "updating"
        ? 15_000
        : false,
  })
  useDiscoveryUnauthorized(query.error)
  const unauthorized =
    query.error instanceof ApiError && query.error.status === 401
  return {
    ...query,
    data: canRead && !unauthorized ? query.data : undefined,
    canRead,
    accessScope,
  }
}

export function useSaveDiscovery() {
  const queryClient = useQueryClient()
  const { t } = useTranslation(["discovery", "errors"])
  const { accessScope } = useDiscoveryAccess()
  const mutation = useMutation({
    mutationFn: async ({
      item,
    }: {
      item: DiscoveryItem
      accessScope: string
    }): Promise<{ id: string }> => {
      try {
        return await api.createBookmark({ url: item.url })
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.code === "DUPLICATE" &&
          typeof error.details?.id === "string"
        ) {
          return { id: error.details.id }
        }
        throw error
      }
    },
    onSuccess: (bookmark, variables) => {
      queryClient.setQueriesData<DiscoveryResponse>(
        {
          predicate: (query) =>
            query.queryKey[0] === "bookmarks" &&
            query.queryKey[1] === "discovery" &&
            query.queryKey[3] === variables.accessScope,
        },
        (response) =>
          response
            ? {
                ...response,
                items: response.items.map((item) =>
                  item.id === variables.item.id ||
                  item.url === variables.item.url
                    ? { ...item, savedBookmarkId: bookmark.id }
                    : item
                ),
              }
            : response
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      toast.success(t("savedToast"))
    },
    onError: (error) =>
      toast.error(formatApiError(error, t) || t("saveFailed")),
  })
  useDiscoveryUnauthorized(mutation.error)
  return {
    ...mutation,
    save: (item: DiscoveryItem) => mutation.mutate({ item, accessScope }),
  }
}
