import * as React from "react"
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { PlusIcon, MagnifyingGlassIcon, ListIcon } from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { AppSidebar } from "@/components/app-sidebar"
import { AddBookmarkDialog } from "@/features/bookmarks/add-bookmark-dialog"
import { BookmarkFilterPanel } from "@/features/bookmarks/bookmark-filter-panel"
import { FolderBreadcrumb } from "@/features/folders/folder-breadcrumb"
import { FolderTreePanel } from "@/features/folders/folder-tree-panel"
import { LoginDialog } from "@/features/auth/login-dialog"
import { LoginDialogProvider } from "@/hooks/login-dialog-context"
import { useRefreshFoldersOnAiComplete } from "@/hooks/use-refresh-folders-on-ai-complete"
import { useRequireAuthAction } from "@/hooks/use-auth"

const FOLDER_TREE_HIDDEN_PATHS = new Set(["/feed", "/insights", "/settings"])

export function AppShell() {
  return (
    <LoginDialogProvider>
      <AppShellContent />
      <LoginDialog />
    </LoginDialogProvider>
  )
}

function AppShellContent() {
  const { t } = useTranslation("nav")
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const requireAuth = useRequireAuthAction()

  const [addDialogOpen, setAddDialogOpen] = React.useState(false)
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)

  useRefreshFoldersOnAiComplete()

  const showFolderTree = !FOLDER_TREE_HIDDEN_PATHS.has(location.pathname)

  const searchQuery = searchParams.get("q") || ""
  const [searchInput, setSearchInput] = React.useState(searchQuery)

  React.useEffect(() => {
    setSearchInput(searchQuery)
  }, [searchQuery])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newParams = new URLSearchParams(searchParams)
    if (searchInput.trim()) {
      newParams.set("q", searchInput.trim())
    } else {
      newParams.delete("q")
    }
    setSearchParams(newParams)
    if (window.location.pathname !== "/") {
      navigate("/?" + newParams.toString())
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground antialiased">
      <AppSidebar
        mobileOpen={mobileNavOpen}
        onMobileOpenChange={setMobileNavOpen}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-card/50 px-4 backdrop-blur-sm md:gap-4 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground md:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t("common:accessibility.openNavMenu")}
            >
              <ListIcon className="size-5" />
            </Button>

            {showFolderTree ? <FolderBreadcrumb /> : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <form
              onSubmit={handleSearchSubmit}
              className="relative w-40 sm:w-52 md:w-64 lg:w-80"
            >
              <MagnifyingGlassIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t("searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-8 w-full border-muted bg-muted/40 pr-3 pl-8 text-xs md:text-sm"
              />
            </form>

            <Button
              size="sm"
              onClick={() => requireAuth(() => setAddDialogOpen(true))}
              className="gap-1.5 text-xs font-medium"
            >
              <PlusIcon className="size-4" />
              <span className="hidden sm:inline">{t("addButton")}</span>
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1">
          {showFolderTree ? (
            <FolderTreePanel className="hidden md:flex" resizable />
          ) : null}

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
            <Outlet />
          </main>

          {showFolderTree ? (
            <BookmarkFilterPanel className="hidden md:flex" resizable />
          ) : null}
        </div>
      </div>

      <AddBookmarkDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  )
}
