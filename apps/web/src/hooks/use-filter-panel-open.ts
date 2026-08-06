import * as React from "react"

const FILTER_PANEL_OPEN_KEY = "mankr_filter_panel_open"
const FILTER_PANEL_OPEN_EVENT = "mankr:filter-panel-open"

function readStoredOpen(): boolean {
  if (typeof window === "undefined") return true
  return localStorage.getItem(FILTER_PANEL_OPEN_KEY) !== "false"
}

export function useFilterPanelOpen() {
  const [open, setOpenState] = React.useState(readStoredOpen)

  React.useEffect(() => {
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key !== FILTER_PANEL_OPEN_KEY) return
      setOpenState(event.newValue !== "false")
    }
    const syncFromEvent = (event: Event) => {
      setOpenState((event as CustomEvent<boolean>).detail)
    }

    window.addEventListener("storage", syncFromStorage)
    window.addEventListener(FILTER_PANEL_OPEN_EVENT, syncFromEvent)
    return () => {
      window.removeEventListener("storage", syncFromStorage)
      window.removeEventListener(FILTER_PANEL_OPEN_EVENT, syncFromEvent)
    }
  }, [])

  const setOpen = React.useCallback((next: boolean) => {
    localStorage.setItem(FILTER_PANEL_OPEN_KEY, String(next))
    setOpenState(next)
    window.dispatchEvent(
      new CustomEvent(FILTER_PANEL_OPEN_EVENT, { detail: next }),
    )
  }, [])

  return { open, setOpen }
}
