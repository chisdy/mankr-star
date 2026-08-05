import * as React from "react"
import { useQuery, type QueryClient } from "@tanstack/react-query"
import { useLocation, useNavigate } from "react-router"

import { api, ApiError } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { InstanceStatus } from "@/lib/types"
import { useOptionalLoginDialog } from "@/hooks/login-dialog-context"

/** 校验登录回跳目标：仅允许站内相对路径 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  if (raw.startsWith("/login") || raw.startsWith("/register")) return null
  return raw
}

export function loginUrlWithNext(next?: string): string {
  const path = safeNextPath(next)
  if (!path) return "/login"
  return `/login?next=${encodeURIComponent(path)}`
}

/**
 * 认证态以 /api/auth/status 的 authenticated 为准（始终 200），
 * 仅在已登录时再请求 /api/me，避免访客公开浏览时刷 401。
 */
export function useAuth() {
  const statusQuery = useQuery({
    queryKey: queryKeys.auth.status,
    queryFn: () => api.getInstanceStatus(),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  })

  const sessionOk = statusQuery.data?.authenticated === true

  const meQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => api.getMe(),
    retry: false,
    staleTime: 1000 * 60 * 5,
    enabled: sessionOk,
  })

  const isLoading =
    statusQuery.isLoading || (sessionOk && meQuery.isLoading && !meQuery.data)

  const isAuthenticated = sessionOk && Boolean(meQuery.data)
  const isGuest = !isLoading && !isAuthenticated

  return {
    user: meQuery.data ?? null,
    status: statusQuery.data ?? null,
    isLoading,
    isAuthenticated,
    isGuest,
    publicBrowsingEnabled: Boolean(statusQuery.data?.public_browsing_enabled),
    meQuery,
    statusQuery,
  }
}

/** 登录成功后同步 status，避免短暂再打 /api/me 前门禁抖动 */
export function patchAuthStatus(
  queryClient: QueryClient,
  patch: Partial<InstanceStatus>,
) {
  queryClient.setQueryData(
    queryKeys.auth.status,
    (prev: InstanceStatus | undefined) => ({
      initialized: prev?.initialized ?? true,
      public_browsing_enabled: prev?.public_browsing_enabled ?? false,
      authenticated: prev?.authenticated ?? false,
      ...patch,
    }),
  )
}

/** 访客写操作：公开浏览下弹窗登录，否则跳转登录页 */
export function useRequireAuthAction() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, publicBrowsingEnabled } = useAuth()
  const loginDialog = useOptionalLoginDialog()

  return (action?: () => void) => {
    if (isAuthenticated) {
      action?.()
      return true
    }
    if (publicBrowsingEnabled && loginDialog) {
      loginDialog.openLogin()
      return false
    }
    const next = `${location.pathname}${location.search}`
    navigate(loginUrlWithNext(next))
    return false
  }
}

/**
 * 业务 query 遇 401 且为访客：视为公开浏览已关闭（或会话失效），
 * 直接回登录页，不弹窗（避免 status 缓存导致误弹窗留在失败页）。
 */
export function useRedirectGuestOnUnauthorized(error: Error | null) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isGuest } = useAuth()

  React.useEffect(() => {
    if (!(isGuest && error instanceof ApiError && error.status === 401)) return

    navigate(loginUrlWithNext(`${location.pathname}${location.search}`), {
      replace: true,
    })
  }, [error, isGuest, location.pathname, location.search, navigate])
}
