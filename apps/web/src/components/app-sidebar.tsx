import * as React from "react"
import { Link, NavLink, useNavigate } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  BookmarksIcon,
  HashIcon,
  RssIcon,
  GearIcon,
  SunIcon,
  MoonIcon,
  DesktopIcon,
  SignOutIcon,
  TranslateIcon,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { getLocale, setLocale } from "@/i18n"
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales"

type NavItem = {
  to: string
  labelKey: "bookmarks" | "tags" | "feed" | "insights" | "settings"
  icon: Icon
  /** 未登录时是否可见；默认 true */
  guestVisible?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "bookmarks", icon: BookmarksIcon },
  { to: "/tags", labelKey: "tags", icon: HashIcon },
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
  const { t, i18n } = useTranslation("nav")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, isAuthenticated, publicBrowsingEnabled } = useAuth()
  const { openLogin } = useLoginDialog()
  const { theme, setTheme } = useTheme()

  const currentLocale = (LOCALES as readonly string[]).includes(i18n.language)
    ? (i18n.language as Locale)
    : getLocale()

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      queryClient.clear()
      navigate("/login")
    },
  })

  const handleLogin = () => {
    if (publicBrowsingEnabled) {
      openLogin()
    } else {
      navigate("/login")
    }
  }

  const tooltipLabel = isAuthenticated ? t("userMenuAria") : t("loginTooltip")

  return (
    <DropdownMenu>
      <RailTooltip label={tooltipLabel}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-muted-foreground hover:text-foreground"
              aria-label={tooltipLabel}
            />
          }
        >
          <UserIcon className="size-5" />
        </DropdownMenuTrigger>
      </RailTooltip>
      <DropdownMenuContent side="right" align="end" className="w-56">
        {isAuthenticated ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="font-medium text-foreground">
                {user?.username || t("fallbackName")}
              </div>
              {user?.email ? (
                <div className="truncate text-xs text-muted-foreground">
                  {user.email}
                </div>
              ) : null}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              {t("loginPrompt")}
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleLogin}>
              <UserIcon className="size-4" />
              <span>{t("common:actions.login")}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <TranslateIcon className="size-3.5" />
            {t("common:language.label")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={currentLocale}
            onValueChange={(value) => {
              if (value) setLocale(value as Locale)
            }}
          >
            {LOCALES.map((locale) => (
              <DropdownMenuRadioItem key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            {theme === "dark" ? (
              <MoonIcon className="size-3.5" />
            ) : theme === "light" ? (
              <SunIcon className="size-3.5" />
            ) : (
              <DesktopIcon className="size-3.5" />
            )}
            {t("common:theme.label")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              if (value === "light" || value === "dark" || value === "system") {
                setTheme(value)
              }
            }}
          >
            <DropdownMenuRadioItem value="system">
              <DesktopIcon className="size-4" />
              {t("common:theme.system")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <SunIcon className="size-4" />
              {t("common:theme.light")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <MoonIcon className="size-4" />
              {t("common:theme.dark")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        {isAuthenticated ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <GearIcon className="size-4" />
              <span>{t("settings")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => logoutMutation.mutate()}
            >
              <SignOutIcon className="size-4" />
              <span>{t("common:actions.logout")}</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DesktopRail() {
  const { t } = useTranslation("nav")
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
