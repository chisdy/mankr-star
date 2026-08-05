import * as React from "react"
import { useTranslation } from "react-i18next"
import { CheckIcon, TranslateIcon } from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { getLocale, setLocale, subscribeLocaleStorage } from "@/i18n"
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales"

type LocaleSwitcherProps = {
  /** compact: EN · 中文 text; cards: settings-style buttons; menu: icon + dropdown */
  variant?: "compact" | "cards" | "menu"
  className?: string
  /** Dropdown side (rail uses right) */
  menuSide?: "top" | "right" | "bottom" | "left"
}

export function LocaleSync() {
  const { i18n } = useTranslation()

  React.useEffect(() => {
    return subscribeLocaleStorage((locale) => {
      if (i18n.language !== locale) {
        void i18n.changeLanguage(locale)
      }
    })
  }, [i18n])

  return null
}

export function LocaleSwitcher({
  variant = "compact",
  className,
  menuSide = "bottom",
}: LocaleSwitcherProps) {
  const { t, i18n } = useTranslation("common")
  const current = (LOCALES as readonly string[]).includes(i18n.language)
    ? (i18n.language as Locale)
    : getLocale()

  const select = (locale: Locale) => {
    if (locale === current) return
    setLocale(locale)
  }

  if (variant === "cards") {
    return (
      <div className={cn("grid grid-cols-2 gap-3", className)}>
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            onClick={() => select(locale)}
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-lg border p-3 text-xs font-medium transition-all",
              current === locale
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            <span>{LOCALE_LABELS[locale]}</span>
          </button>
        ))}
      </div>
    )
  }

  if (variant === "menu") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("accessibility.switchLanguage")}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                className,
              )}
            />
          }
        >
          <TranslateIcon className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side={menuSide} align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {t("language.label")}
            </DropdownMenuLabel>
            {LOCALES.map((locale) => (
              <DropdownMenuItem
                key={locale}
                onClick={() => select(locale)}
                className="justify-between gap-2"
              >
                <span>{LOCALE_LABELS[locale]}</span>
                {current === locale ? (
                  <CheckIcon className="size-4 shrink-0 text-primary" />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
      role="group"
      aria-label={t("accessibility.switchLanguage")}
    >
      {LOCALES.map((locale, index) => (
        <React.Fragment key={locale}>
          {index > 0 ? (
            <span className="text-muted-foreground/50" aria-hidden>
              ·
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => select(locale)}
            className={cn(
              "rounded px-1 py-0.5 transition-colors hover:text-foreground",
              current === locale && "font-semibold text-foreground",
            )}
          >
            {locale === "en" ? "EN" : "中文"}
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}
