import * as React from "react"
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import {
  PlusIcon,
  MagnifyingGlassIcon,
  ListIcon,
  SparkleIcon,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Sheet, SheetContent, SheetTitle } from "@workspace/ui/components/sheet"
import { AppSidebar } from "@/components/app-sidebar"
import { AddBookmarkDialog } from "@/features/bookmarks/add-bookmark-dialog"
import { BookmarkFilterPanel } from "@/features/bookmarks/bookmark-filter-panel"
import { KbChatBody } from "@/features/kb/kb-chat-body"
import { KbChatPanel } from "@/features/kb/kb-chat-panel"
import { KbChatProvider } from "@/features/kb/kb-chat-context"
import { useKbPanelOpen } from "@/hooks/use-kb-panel-open"
import { useIsMobile } from "@/hooks/use-mobile"
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
      <KbChatProvider>
        <AppShellContent />
      </KbChatProvider>
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
  const { open: kbOpen, setOpen: setKbOpen } = useKbPanelOpen()
  const isMobile = useIsMobile()

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

            <Button
              variant={kbOpen ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => requireAuth(() => setKbOpen(!kbOpen))}
              aria-pressed={kbOpen}
              aria-label={t("kb:toggleAria")}
              title={t("kb:toggleAria")}
              className="shrink-0 text-muted-foreground aria-pressed:text-foreground"
            >
              <SparkleIcon className="size-4.5" weight="duotone" />
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

          {!isMobile ? <KbChatPanel resizable /> : null}
        </div>
      </div>

      {/* 移动端改用全宽 Sheet；关闭仅收起面板，不清空会话 */}
      <Sheet open={isMobile && kbOpen} onOpenChange={(next) => setKbOpen(next)}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full gap-0 p-0 sm:max-w-none"
        >
          <SheetTitle className="sr-only">{t("kb:title")}</SheetTitle>
          <KbChatBody onCollapse={() => setKbOpen(false)} />
        </SheetContent>
      </Sheet>

      <AddBookmarkDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  )
}
