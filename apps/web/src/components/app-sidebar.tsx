import * as React from "react"
import { Link, NavLink, useNavigate } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  StarIcon,
  RssIcon,
  GearIcon,
  SunIcon,
  MoonIcon,
  SignOutIcon,
  UserIcon,
  ChartBarIcon,
  type Icon,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { BrandLogo } from "@/components/brand-logo"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { api } from "@/lib/api"
import { useTheme } from "@/components/theme-provider"
import { FolderTreePanel } from "@/features/folders/folder-tree-panel"
import { useAuth } from "@/hooks/use-auth"
import { useLoginDialog } from "@/hooks/login-dialog-context"

type NavItem = {
  to: string
  labelKey: "bookmarks" | "feed" | "insights" | "settings"
  icon: Icon
  /** 未登录时是否可见；默认 true */
  guestVisible?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "bookmarks", icon: StarIcon },
  { to: "/feed", labelKey: "feed", icon: RssIcon },
  {
    to: "/insights",
    labelKey: "insights",
    icon: ChartBarIcon,
    guestVisible: false,
  },
]

export const SETTINGS_ITEM: NavItem = {
  to: "/settings",
  labelKey: "settings",
  icon: GearIcon,
  guestVisible: false,
}

function useVisibleNavItems(includeSettings = false) {
  const { isAuthenticated } = useAuth()
  return React.useMemo(() => {
    const base = isAuthenticated
      ? NAV_ITEMS
      : NAV_ITEMS.filter((item) => item.guestVisible !== false)
    if (!includeSettings) return base
    if (!isAuthenticated) return base
    return [...base, SETTINGS_ITEM]
  }, [isAuthenticated, includeSettings])
}

const railLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex size-10 items-center justify-center rounded-md text-sm font-medium transition-colors ${
    isActive
      ? "bg-accent font-semibold text-accent-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`

const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? "bg-accent font-semibold text-accent-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`

function RailTooltip({
  label,
  children,
}: {
  label: string
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function UserMenu() {
  const { t } = useTranslation("nav")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, isAuthenticated, publicBrowsingEnabled } = useAuth()
  const { openLogin } = useLoginDialog()

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      queryClient.clear()
      navigate("/login")
    },
  })

  if (!isAuthenticated) {
    return (
      <RailTooltip label={t("loginTooltip")}>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full text-muted-foreground hover:text-foreground"
          aria-label={t("loginTooltip")}
          onClick={() => {
            if (publicBrowsingEnabled) {
              openLogin()
            } else {
              navigate("/login")
            }
          }}
        >
          <UserIcon className="size-5" />
        </Button>
      </RailTooltip>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-muted-foreground hover:text-foreground"
            aria-label={t("userMenuAria")}
          />
        }
      >
        <UserIcon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="font-medium text-foreground">
              {user?.username || t("fallbackName")}
            </div>
            {user?.email && (
              <div className="truncate text-xs text-muted-foreground">
                {user.email}
              </div>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/settings")}>
          <GearIcon className="mr-2 size-4" />
          <span>{t("settings")}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => logoutMutation.mutate()}
        >
          <SignOutIcon className="mr-2 size-4" />
          <span>{t("common:actions.logout")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DesktopRail() {
  const { t } = useTranslation("nav")
  const { theme, setTheme } = useTheme()
  const { isAuthenticated } = useAuth()
  const navItems = useVisibleNavItems(false)

  return (
    <TooltipProvider delay={300}>
      <aside className="hidden h-full w-16 shrink-0 flex-col items-center justify-between border-r border-border/50 bg-card py-4 md:flex">
        <div className="flex w-full flex-col items-center gap-6">
          <RailTooltip label={t("brand")}>
            <Link
              to="/"
              className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              <BrandLogo iconClassName="size-8" title={t("brand")} />
            </Link>
          </RailTooltip>

          <nav className="flex w-full flex-col items-center gap-2 px-2">
            {navItems.map((item) => {
              const Icon = item.icon
              const label = t(item.labelKey)
              return (
                <RailTooltip key={item.to} label={label}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    className={railLinkClass}
                  >
                    <Icon className="size-5" />
                    <span className="sr-only">{label}</span>
                  </NavLink>
                </RailTooltip>
              )
            })}
          </nav>
        </div>

        <div className="flex flex-col items-center gap-2 px-2">
          <LocaleSwitcher variant="menu" menuSide="right" />

          <RailTooltip label={t("common:accessibility.toggleTheme")}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={t("common:accessibility.toggleTheme")}
              className="text-muted-foreground hover:text-foreground"
            >
              {theme === "dark" ? (
                <SunIcon className="size-5" />
              ) : (
                <MoonIcon className="size-5" />
              )}
            </Button>
          </RailTooltip>

          {isAuthenticated ? (
            <RailTooltip label={t(SETTINGS_ITEM.labelKey)}>
              <NavLink to={SETTINGS_ITEM.to} className={railLinkClass}>
                <GearIcon className="size-5" />
                <span className="sr-only">{t(SETTINGS_ITEM.labelKey)}</span>
              </NavLink>
            </RailTooltip>
          ) : null}

          <UserMenu />
        </div>
      </aside>
    </TooltipProvider>
  )
}

function MobileNav({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("nav")
  const navItems = useVisibleNavItems(true)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[min(100%,20rem)] flex-col gap-0 p-0"
      >
        <SheetHeader className="shrink-0 border-b border-border/50 p-4 text-left">
          <div className="flex items-center justify-between gap-2 pr-8">
            <SheetTitle className="flex items-center gap-2 text-lg font-semibold">
              <BrandLogo
                className="size-7 rounded bg-primary text-primary-foreground"
                iconClassName="size-4"
                title={t("brand")}
              />
              {t("brand")}
            </SheetTitle>
            <LocaleSwitcher variant="menu" menuSide="bottom" />
          </div>
        </SheetHeader>
        <nav className="flex shrink-0 flex-col gap-1 border-b border-border/50 px-3 py-3">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={() => onOpenChange(false)}
                className={mobileLinkClass}
              >
                <Icon className="size-5" />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            )
          })}
        </nav>
        <FolderTreePanel
          className="min-h-0 w-full flex-1 border-r-0"
          onNavigate={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}

export function AppSidebar({
  mobileOpen,
  onMobileOpenChange,
}: {
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
}) {
  return (
    <>
      <DesktopRail />
      <MobileNav open={mobileOpen} onOpenChange={onMobileOpenChange} />
    </>
  )
}
