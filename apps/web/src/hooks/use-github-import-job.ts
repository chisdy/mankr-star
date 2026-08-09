import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"
import type { GithubImportJob } from "@/lib/types"

function isActiveJob(job: GithubImportJob | null | undefined): boolean {
  return job?.status === "queued" || job?.status === "running"
}

/**
 * 轮询 GitHub 导入任务；离开设置页仍可挂在 AppShell 上继续刷新。
 * 进度前进或结束时失效收藏/文件夹/标签缓存。
 */
export function useGithubImportJob() {
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const lastProcessed = React.useRef<number | null>(null)
  const lastStatus = React.useRef<string | null>(null)

  const query = useQuery({
    queryKey: queryKeys.import.githubActive,
    queryFn: () => api.getGithubImportActive(),
    enabled: isAuthenticated,
    refetchInterval: (q) =>
      isActiveJob(q.state.data?.job) ? 1500 : false,
  })

  const job = query.data?.job ?? null

  React.useEffect(() => {
    if (!job) return
    const processedAdvanced =
      lastProcessed.current != null && job.processed > lastProcessed.current
    const justFinished =
      (lastStatus.current === "queued" || lastStatus.current === "running") &&
      job.status !== "queued" &&
      job.status !== "running"

    if (processedAdvanced || justFinished || isActiveJob(job)) {
      if (processedAdvanced || justFinished) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      }
    }

    lastProcessed.current = job.processed
    lastStatus.current = job.status
  }, [job, queryClient])

  return {
    job,
    isActive: isActiveJob(job),
    isLoading: query.isLoading,
    refetch: query.refetch,
  }
}
