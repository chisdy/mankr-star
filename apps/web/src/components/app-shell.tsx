import * as React from "react"
import { Outlet, useLocation, useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
import {
  CaretLeftIcon,
  CaretRightIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ListIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Sheet, SheetContent, SheetTitle } from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"
import { AppSidebar } from "@/components/app-sidebar"
import { GithubImportBanner } from "@/components/github-import-banner"
import { AddBookmarkDialog } from "@/features/bookmarks/add-bookmark-dialog"
import { FilterPanelBody } from "@/features/bookmarks/filter-panel-body"
import { getHorizontalScrollStep } from "@/features/bookmarks/horizontal-scroll"
import { BookmarkDetailDialog } from "@/features/bookmarks/detail/bookmark-detail-dialog"
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
import { useAuth, useRequireAuthAction } from "@/hooks/use-auth"
import { BOOKMARK_PAGE_PARAM } from "@/features/bookmarks/bookmark-pagination"
import { APP_SCROLL_ROOT_ID } from "@/lib/scroll-root"
import { toReadableSearch, useReadableSearchParams } from "@/lib/search-params"

/** 浏览器扩展用的一次性入口参数：`/?add=<encoded url>` */
const ADD_PARAM = "add"

const FOLDER_TREE_HIDDEN_PATHS = new Set([
  "/tags",
  "/feed",
  "/insights",
  "/settings",
])

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
  const [searchParams, setSearchParams] = useReadableSearchParams()
  const requireAuth = useRequireAuthAction()
  const { isAuthenticated } = useAuth()

  const [addDialogOpen, setAddDialogOpen] = React.useState(false)
  const [addUrl, setAddUrl] = React.useState("")
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)
  const { open: kbOpen, setOpen: setKbOpen } = useKbPanelOpen()
  const isMobile = useIsMobile()
  const filterScrollViewportRef = React.useRef<HTMLDivElement>(null)

  useRefreshFoldersOnAiComplete()

  // 浏览器扩展跳转来的 `?add=<url>`：弹出新增框并预填，未登录时先走登录引导
  const requireAuthRef = React.useRef(requireAuth)
  requireAuthRef.current = requireAuth

  React.useEffect(() => {
    const pending = searchParams.get(ADD_PARAM)
    if (!pending) return

    // 访客会被引导去登录，参数留着，登录回来后 isAuthenticated 变化再补弹一次
    const opened = requireAuthRef.current(() => {
      setAddUrl(pending)
      setAddDialogOpen(true)
    })
    if (!opened) return

    // 参数只是一次性入口，留在地址栏里刷新会重复弹窗
    const next = new URLSearchParams(searchParams)
    next.delete(ADD_PARAM)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, isAuthenticated])

  const showFolderTree = !FOLDER_TREE_HIDDEN_PATHS.has(location.pathname)

  const searchQuery = searchParams.get("q") || ""
  const [searchInput, setSearchInput] = React.useState(searchQuery)

  React.useEffect(() => {
    setSearchInput(searchQuery)
  }, [searchQuery])

  const applySearchParams = (query: string) => {
    const newParams = new URLSearchParams(searchParams)
    if (query) {
      newParams.set("q", query)
    } else {
      newParams.delete("q")
    }
    // 换了搜索词就换了结果集，旧页码不再有意义
    newParams.delete(BOOKMARK_PAGE_PARAM)
    const search = toReadableSearch(newParams)
    if (window.location.pathname !== "/") {
      navigate(`/${search}`, { flushSync: true })
      return
    }
    setSearchParams(newParams)
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    applySearchParams(searchInput.trim())
  }

  const handleSearchClear = () => {
    setSearchInput("")
    // 同步清掉 URL 搜索状态，避免只清空输入框但结果仍按旧关键词过滤
    if (searchQuery) applySearchParams("")
  }

  const scrollFilterToolbar = (direction: "left" | "right") => {
    const viewport = filterScrollViewportRef.current
    if (!viewport) return

    viewport.scrollBy({
      left: getHorizontalScrollStep(viewport.clientWidth, direction),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    })
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
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t("searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-8 w-full border-muted bg-muted/40 pr-8 pl-8 text-xs md:text-sm [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={handleSearchClear}
                  aria-label={t("clearSearch")}
                  className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
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
              className="shrink-0 text-muted-foreground aria-pressed:text-foreground transition-colors duration-200"
            >
              <SparkleIcon
                className={cn(
                  "size-4.5 transition-transform duration-300 ease-in-out",
                  kbOpen && "scale-110"
                )}
                weight="duotone"
              />
            </Button>
          </div>
        </header>

        {isAuthenticated ? <GithubImportBanner /> : null}

        <div className="flex min-h-0 min-w-0 flex-1">
          {showFolderTree ? (
            <FolderTreePanel className="hidden md:flex" resizable />
          ) : null}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {location.pathname === "/" ? (
              <div className="group/filter-toolbar relative shrink-0 border-b border-border/50 bg-card/50 px-4 pt-[13px] pb-0 md:px-6">
                <ScrollArea
                  className="min-w-0 pb-[11px]"
                  viewportRef={filterScrollViewportRef}
                  scrollbars="horizontal"
                  scrollbarClassName="hidden"
                  overflowEdgeThreshold={1}
                >
                  <FilterPanelBody className="w-max min-w-full" />
                </ScrollArea>

                <div className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-20 items-center bg-linear-to-r from-card/60 via-card/40 to-transparent pl-2 group-has-data-[overflow-x-start]/filter-toolbar:flex md:pl-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    tabIndex={-1}
                    className="pointer-events-auto rounded-full border-border/60 bg-background/65 shadow-md backdrop-blur-xl supports-[backdrop-filter]:bg-background/50"
                    onClick={() => scrollFilterToolbar("left")}
                    aria-label={t("bookmarks:list.filterScrollLeftAria")}
                    title={t("bookmarks:list.filterScrollLeftAria")}
                  >
                    <CaretLeftIcon weight="bold" />
                  </Button>
                </div>

                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-20 items-center justify-end bg-linear-to-l from-card/60 via-card/40 to-transparent pr-2 group-has-data-[overflow-x-end]/filter-toolbar:flex md:pr-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    tabIndex={-1}
                    className="pointer-events-auto rounded-full border-border/60 bg-background/65 shadow-md backdrop-blur-xl supports-[backdrop-filter]:bg-background/50"
                    onClick={() => scrollFilterToolbar("right")}
                    aria-label={t("bookmarks:list.filterScrollRightAria")}
                    title={t("bookmarks:list.filterScrollRightAria")}
                  >
                    <CaretRightIcon weight="bold" />
                  </Button>
                </div>
              </div>
            ) : null}
            <ScrollArea
              className="min-h-0 flex-1"
              viewportId={APP_SCROLL_ROOT_ID}
              contentClassName="p-4 md:p-6"
            >
              <Outlet />
            </ScrollArea>
          </main>

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

      <AddBookmarkDialog
        open={addDialogOpen}
        onOpenChange={(next) => {
          setAddDialogOpen(next)
          // 关闭即丢弃扩展带来的链接，下次手动新增不该被上一次的地址污染
          if (!next) setAddUrl("")
        }}
        initialUrl={addUrl}
      />

      {/* 由 ?bookmark 驱动，任何子路由都能原地弹出收藏详情 */}
      <BookmarkDetailDialog />
    </div>
  )
}
