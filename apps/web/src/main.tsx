import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@workspace/ui/globals.css"
import "@/i18n"
import { App } from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { LocaleSync } from "@/components/locale-switcher"

// 只在生产注册：开发时 SW 会拦住 Vite 的模块请求，改一行代码要清缓存才生效
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined)
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <LocaleSync />
      <App />
    </ThemeProvider>
  </StrictMode>
)
