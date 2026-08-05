import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"
import { EXTERNAL_LINK_PROPS, toSafeExternalHref } from "@/lib/safe-url"

type ExternalLinkProps = Omit<React.ComponentProps<"a">, "href" | "target" | "rel" | "referrerPolicy"> & {
  href: string | null | undefined
}

/**
 * 安全外链：仅 http(s)、新标签打开、noopener + noreferrer、不发送 Referer。
 */
export function ExternalLink({ href, className, children, onClick, ...props }: ExternalLinkProps) {
  const safeHref = toSafeExternalHref(href)
  if (!safeHref) return null

  return (
    <a
      href={safeHref}
      {...EXTERNAL_LINK_PROPS}
      className={cn(className)}
      onClick={onClick}
      {...props}
    >
      {children}
    </a>
  )
}
