import * as React from "react"

import { getAppScrollRoot } from "@/lib/scroll-root"

/** 滚动根在 AppShell 里，挂载后才拿得到 */
export function useAppScrollRoot(): HTMLElement | null {
  const [element, setElement] = React.useState<HTMLElement | null>(null)
  React.useLayoutEffect(() => {
    setElement(getAppScrollRoot())
  }, [])
  return element
}
