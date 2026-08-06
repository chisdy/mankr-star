import * as React from "react"
import { useTranslation } from "react-i18next"
import { CheckIcon, IdentificationCardIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { buttonVariants } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { copyText } from "@/lib/clipboard"
import { useAuth } from "@/hooks/use-auth"
import type { Bookmark } from "@/lib/types"

interface BookmarkAccountCopyButtonProps {
  bookmark: Bookmark
  className?: string
}

/**
 * 网页收藏：一键复制账号 + 密码。
 * 密码按需解密，明文不进 React state / Query 缓存。
 * 可见条件与「有账号」筛选对齐：已注册且（有用户名或已设密码）。
 */
export function BookmarkAccountCopyButton({
  bookmark,
  className,
}: BookmarkAccountCopyButtonProps) {
  const { t } = useTranslation(["bookmarks", "errors"])
  const { isAuthenticated } = useAuth()
  const [copied, setCopied] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const username = bookmark.account_username?.trim() || ""
  const hasPassword = Boolean(bookmark.account_password_set)
  const canCopy =
    isAuthenticated &&
    bookmark.source_type === "url" &&
    Boolean(bookmark.account_registered) &&
    (Boolean(username) || hasPassword)

  if (!canCopy) return null

  const flash = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setCopied(true)
    timerRef.current = setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, 1500)
  }

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (pending) return
    setPending(true)
    try {
      let password = ""
      if (hasPassword) {
        password = await api.copyAccountPassword(bookmark.id)
      }

      const parts: string[] = []
      if (username) parts.push(username)
      if (password) parts.push(password)
      if (parts.length === 0) {
        toast.error(t("bookmarks:card.copyAccountEmpty"))
        return
      }

      const ok = await copyText(parts.join("\n"), {
        unsupportedMessage: t("bookmarks:detail.copyUnsupported"),
        silent: true,
      })
      if (ok) flash()
    } catch (err) {
      toast.error(
        formatApiError(err as Error, t) || t("bookmarks:detail.copyFailed"),
      )
    } finally {
      setPending(false)
    }
  }

  const label = copied
    ? t("bookmarks:detail.copied")
    : t("bookmarks:card.copyAccountTitle")

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={(e) => void handleClick(e)}
              disabled={pending}
              className={cn(
                buttonVariants({ variant: "ghost", size: "xs" }),
                "h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50",
                className,
              )}
              aria-label={t("bookmarks:card.copyAccountAria")}
            >
              {copied ? (
                <CheckIcon className="size-3.5 text-emerald-500" weight="bold" />
              ) : (
                <IdentificationCardIcon className="size-3.5" />
              )}
            </button>
          }
        />
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
