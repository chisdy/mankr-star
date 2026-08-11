import * as React from "react"
import { useLocation } from "react-router"

import { useAuth } from "@/hooks/use-auth"

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const GA_SCRIPT_ATTR = "data-mankr-ga"

/** 模块级去重：避免 Strict Mode 双挂载把同一路径打两次 */
let lastPageViewKey: string | null = null

function ensureGtag(measurementId: string) {
  if (typeof window === "undefined") return

  window.dataLayer = window.dataLayer || []
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer?.push(args)
    }
  }

  const existing = document.querySelector<HTMLScriptElement>(
    `script[${GA_SCRIPT_ATTR}]`,
  )
  if (existing?.dataset.gaId === measurementId) return

  if (existing) existing.remove()

  window.gtag("js", new Date())
  window.gtag("config", measurementId, { send_page_view: false })

  const script = document.createElement("script")
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
  script.setAttribute(GA_SCRIPT_ATTR, "")
  script.dataset.gaId = measurementId
  document.head.appendChild(script)
}

function removeGtag() {
  document
    .querySelectorAll(`script[${GA_SCRIPT_ATTR}]`)
    .forEach((node) => node.remove())
  lastPageViewKey = null
  try {
    delete window.gtag
  } catch {
    window.gtag = undefined
  }
  // 保留 dataLayer 引用但截断内容，避免清空后仍用旧队列续传
  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.length = 0
  }
}

/** 全站 GA 注入：由 RootLayout 挂载，覆盖登录页与业务壳 */
export function GoogleAnalytics() {
  const { status } = useAuth()
  const location = useLocation()
  const measurementId = status?.google_analytics_measurement_id ?? null

  React.useEffect(() => {
    if (!measurementId) {
      removeGtag()
      return
    }
    ensureGtag(measurementId)
  }, [measurementId])

  React.useEffect(() => {
    if (!measurementId || typeof window.gtag !== "function") return
    const pagePath = `${location.pathname}${location.search}`
    const key = `${measurementId}:${pagePath}`
    if (lastPageViewKey === key) return
    lastPageViewKey = key
    window.gtag("event", "page_view", {
      page_path: pagePath,
      page_location: window.location.href,
      page_title: document.title,
    })
  }, [measurementId, location.pathname, location.search])

  return null
}
