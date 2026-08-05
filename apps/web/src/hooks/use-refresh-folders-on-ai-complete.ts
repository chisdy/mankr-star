import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"

/**
 * 监听最近收藏的 AI 归类状态 / 文件夹归属变化。
 * 新增收藏默认先无 folder_id，AI 异步归类完成后需要再刷新左侧文件夹计数。
 */
export function useRefreshFoldersOnAiComplete() {
  const queryClient = useQueryClient()
  const { isAuthenticated } = useAuth()

  const { data } = useQuery({
    queryKey: [...queryKeys.bookmarks.all, "ai-watch"] as const,
    queryFn: () => api.getBookmarks({ page: 1, limit: 50, sort: "recent" }),
    enabled: isAuthenticated,
    refetchInterval: (query) => {
      const items = query.state.data?.items
      if (!items?.length) return false
      return items.some((b) => b.ai_status === "pending") ? 2000 : false
    },
  })

  const signature = React.useMemo(() => {
    const items = data?.items ?? []
    return items
      .map((b) => `${b.id}:${b.folder_id ?? ""}:${b.ai_status}`)
      .sort()
      .join("|")
  }, [data?.items])

  const prevSignature = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (prevSignature.current === null) {
      prevSignature.current = signature
      return
    }
    if (prevSignature.current === signature) return
    prevSignature.current = signature
    void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
  }, [signature, queryClient])
}
