import * as React from "react"
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router"

import { AppShell } from "@/components/app-shell"
import { BrandLogo } from "@/components/brand-logo"
import { RootLayout } from "@/app/root-layout"
import { LoginPage } from "@/features/auth/login-page"
import { RegisterPage } from "@/features/auth/register-page"
import { BookmarksPage } from "@/features/bookmarks/bookmarks-page"
import { BookmarkDetailPage } from "@/features/bookmarks/bookmark-detail-page"
import { FeedPage } from "@/features/feed/feed-page"
import { TagsPage } from "@/features/tags/tags-page"
import { RankingsPage } from "@/features/rankings/rankings-page"
import { InsightsPage } from "@/features/insights/insights-page"
import { SettingsPage } from "@/features/settings/settings-page"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { loginUrlWithNext, useAuth } from "@/hooks/use-auth"
import { useOptionalLoginDialog } from "@/hooks/login-dialog-context"

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <div className="flex flex-col items-center gap-3">
        <BrandLogo
          variant="flat"
          className="size-10 rounded-lg bg-primary text-primary-foreground"
          iconClassName="size-6"
        />
        <Skeleton className="h-4 w-28" />
      </div>
    </div>
  )
}

/** 必须登录（设置 / 洞察）；公开浏览下弹窗引导，并退回首页 */
function RequireAuth() {
  const location = useLocation()
  const { isAuthenticated, isLoading, publicBrowsingEnabled } = useAuth()
  const loginDialog = useOptionalLoginDialog()

  React.useEffect(() => {
    if (
      !isLoading &&
      !isAuthenticated &&
      publicBrowsingEnabled &&
      loginDialog
    ) {
      loginDialog.openLogin()
    }
  }, [isLoading, isAuthenticated, publicBrowsingEnabled, loginDialog])

  if (isLoading) return <AuthLoading />

  if (!isAuthenticated) {
    if (publicBrowsingEnabled) {
      return <Navigate to="/" replace />
    }
    return (
      <Navigate
        to={loginUrlWithNext(`${location.pathname}${location.search}`)}
        replace
      />
    )
  }

  return <Outlet />
}

/**
 * 已登录放行全部；访客仅在公开浏览开启时可进壳（设置/洞察仍由 RequireAuth 拦）。
 * 访客且关闭公开浏览 → /login。
 */
function AppAccessGate() {
  const { isAuthenticated, isLoading, publicBrowsingEnabled } = useAuth()

  if (isLoading) return <AuthLoading />

  if (isAuthenticated) return <Outlet />

  if (publicBrowsingEnabled) return <Outlet />

  return <Navigate to="/login" replace />
}

function RedirectIfAuth() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) return null

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: <RedirectIfAuth />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
        ],
      },
      {
        element: <AppAccessGate />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: "/", element: <BookmarksPage /> },
              { path: "/folders", element: <Navigate to="/" replace /> },
              { path: "/tags", element: <TagsPage /> },
              { path: "/rankings", element: <RankingsPage /> },
              { path: "/feed", element: <FeedPage /> },
              { path: "/bookmarks/:id", element: <BookmarkDetailPage /> },
              {
                element: <RequireAuth />,
                children: [
                  { path: "/insights", element: <InsightsPage /> },
                  { path: "/settings", element: <SettingsPage /> },
                ],
              },
            ],
          },
        ],
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
])
