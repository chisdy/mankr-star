import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  type Locale,
  writeStoredLocale,
} from "./locales"

import enCommon from "./resources/en/common.json"
import enNav from "./resources/en/nav.json"
import enAuth from "./resources/en/auth.json"
import enSettings from "./resources/en/settings.json"
import enBookmarks from "./resources/en/bookmarks.json"
import enFolders from "./resources/en/folders.json"
import enFeed from "./resources/en/feed.json"
import enInsights from "./resources/en/insights.json"
import enErrors from "./resources/en/errors.json"

import zhCommon from "./resources/zh-CN/common.json"
import zhNav from "./resources/zh-CN/nav.json"
import zhAuth from "./resources/zh-CN/auth.json"
import zhSettings from "./resources/zh-CN/settings.json"
import zhBookmarks from "./resources/zh-CN/bookmarks.json"
import zhFolders from "./resources/zh-CN/folders.json"
import zhFeed from "./resources/zh-CN/feed.json"
import zhInsights from "./resources/zh-CN/insights.json"
import zhErrors from "./resources/zh-CN/errors.json"

const resources = {
  en: {
    common: enCommon,
    nav: enNav,
    auth: enAuth,
    settings: enSettings,
    bookmarks: enBookmarks,
    folders: enFolders,
    feed: enFeed,
    insights: enInsights,
    errors: enErrors,
  },
  "zh-CN": {
    common: zhCommon,
    nav: zhNav,
    auth: zhAuth,
    settings: zhSettings,
    bookmarks: zhBookmarks,
    folders: zhFolders,
    feed: zhFeed,
    insights: zhInsights,
    errors: zhErrors,
  },
} as const

function syncDocumentLang(locale: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale
  }
}

const initialLocale = readStoredLocale() ?? DEFAULT_LOCALE

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: "common",
  ns: [
    "common",
    "nav",
    "auth",
    "settings",
    "bookmarks",
    "folders",
    "feed",
    "insights",
    "errors",
  ],
  interpolation: { escapeValue: false },
  returnNull: false,
})

syncDocumentLang(i18n.language)

i18n.on("languageChanged", (lng) => {
  syncDocumentLang(lng)
})

export function setLocale(locale: Locale): void {
  writeStoredLocale(locale)
  void i18n.changeLanguage(locale)
}

export function getLocale(): Locale {
  return isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE
}

/** Cross-tab sync — call once from app root (e.g. LocaleSync) */
export function subscribeLocaleStorage(
  onLocale: (locale: Locale) => void,
): () => void {
  const handler = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return
    if (event.key !== LOCALE_STORAGE_KEY) return
    if (isLocale(event.newValue)) {
      onLocale(event.newValue)
      return
    }
    onLocale(DEFAULT_LOCALE)
  }
  window.addEventListener("storage", handler)
  return () => window.removeEventListener("storage", handler)
}

export { i18n }
export default i18n
