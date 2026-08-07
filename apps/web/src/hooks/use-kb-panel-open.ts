import * as React from "react"

const KB_PANEL_OPEN_KEY = "mankr_kb_panel_open"
const KB_PANEL_OPEN_EVENT = "mankr:kb-panel-open"

/** 与筛选面板不同，知识库面板默认折叠 */
function readStoredOpen(): boolean {
  if (typeof window === "undefined") return false
  return localStorage.getItem(KB_PANEL_OPEN_KEY) === "true"
}

export function useKbPanelOpen() {
  const [open, setOpenState] = React.useState(readStoredOpen)

  React.useEffect(() => {
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key !== KB_PANEL_OPEN_KEY) return
      setOpenState(event.newValue === "true")
    }
    const syncFromEvent = (event: Event) => {
      setOpenState((event as CustomEvent<boolean>).detail)
    }

    window.addEventListener("storage", syncFromStorage)
    window.addEventListener(KB_PANEL_OPEN_EVENT, syncFromEvent)
    return () => {
      window.removeEventListener("storage", syncFromStorage)
      window.removeEventListener(KB_PANEL_OPEN_EVENT, syncFromEvent)
    }
  }, [])

  const setOpen = React.useCallback((next: boolean) => {
    localStorage.setItem(KB_PANEL_OPEN_KEY, String(next))
    setOpenState(next)
    window.dispatchEvent(
      new CustomEvent(KB_PANEL_OPEN_EVENT, { detail: next }),
    )
  }, [])

  return { open, setOpen }
}
