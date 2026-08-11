import { Outlet } from "react-router"

import { GoogleAnalytics } from "@/components/google-analytics"

/** Router 顶层布局：全站挂载 GA，覆盖 login/register 与 AppShell */
export function RootLayout() {
  return (
    <>
      <GoogleAnalytics />
      <Outlet />
    </>
  )
}
