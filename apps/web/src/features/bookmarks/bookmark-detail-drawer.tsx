import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  ArchiveIcon,
  TrashIcon,
  ArrowClockwiseIcon,
  StarIcon,
  GitForkIcon,
  ClockIcon,
  HeartIcon,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { Badge } from "@workspace/ui/components/badge"
import { Switch } from "@workspace/ui/components/switch"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { FolderSelect } from "@/features/folders/folder-select"
import { HealthStatusBadge } from "./health-status-badge"
import { BookmarkOpenButton } from "./bookmark-open-button"
import { api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import { copyText } from "@/lib/clipboard"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"

interface BookmarkDetailDrawerProps {
  bookmarkId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BookmarkDetailDrawer({
  bookmarkId,
  open,
  onOpenChange,
}: BookmarkDetailDrawerProps) {
  const { t, i18n } = useTranslation(["bookmarks", "common", "errors"])
  const queryClient = useQueryClient()
  const { isAuthenticated } = useAuth()

  const { data: bookmark, isLoading } = useQuery({
    queryKey: queryKeys.bookmarks.detail(bookmarkId || ""),
    queryFn: () => api.getBookmark(bookmarkId!),
    enabled: !!bookmarkId && open,
    refetchInterval: (query) =>
      query.state.data?.ai_status === "pending" ? 2000 : false,
  })

  const lastSeenAiStatus = React.useRef<string | undefined>(undefined)
  const hydratedBookmarkId = React.useRef<string | null>(null)
  const formDirty = React.useRef(false)

  const { data: folders = [] } = useQuery({
    queryKey: queryKeys.folders.all,
    queryFn: () => api.getFolders(),
    enabled: open,
  })

  // Form state
  const [summaryAi, setSummaryAi] = React.useState("")
  const [folderId, setFolderId] = React.useState("")
  const [tagsInput, setTagsInput] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [trackUpdates, setTrackUpdates] = React.useState(true)
  const [accountRegistered, setAccountRegistered] = React.useState(false)
  const [accountUsername, setAccountUsername] = React.useState("")
  const [accountPassword, setAccountPassword] = React.useState("")
  const [passwordDirty, setPasswordDirty] = React.useState(false)
  const [copyingPassword, setCopyingPassword] = React.useState(false)
  const [usernameCopied, setUsernameCopied] = React.useState(false)
  const [passwordCopied, setPasswordCopied] = React.useState(false)
  const usernameCopyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const passwordCopyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const markDirty = () => {
    formDirty.current = true
  }

  const flashCopied = (
    setCopied: React.Dispatch<React.SetStateAction<boolean>>,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setCopied(true)
    timerRef.current = setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, 1500)
  }

  React.useEffect(() => {
    return () => {
      if (usernameCopyTimer.current) clearTimeout(usernameCopyTimer.current)
      if (passwordCopyTimer.current) clearTimeout(passwordCopyTimer.current)
    }
  }, [])

  const hydrateFromBookmark = (b: NonNullable<typeof bookmark>) => {
    setSummaryAi(b.summary_ai || "")
    setFolderId(b.folder_id || "")
    setTagsInput(b.tags ? b.tags.join(", ") : "")
    setNotes(b.notes || "")
    setTrackUpdates(b.track_updates ?? true)
    setAccountRegistered(Boolean(b.account_registered))
    setAccountUsername(b.account_username || "")
    setAccountPassword("")
    setPasswordDirty(false)
    setUsernameCopied(false)
    setPasswordCopied(false)
  }

  // 关闭抽屉时清 hydration，下次打开重新灌入；打开期间仅 id 切换或 AI 终态灌入
  React.useEffect(() => {
    if (!open) {
      hydratedBookmarkId.current = null
      lastSeenAiStatus.current = undefined
      formDirty.current = false
      return
    }
    if (!bookmark || !bookmarkId) return

    const idChanged = hydratedBookmarkId.current !== bookmarkId
    const prevStatus = lastSeenAiStatus.current
    const status = bookmark.ai_status
    const aiFinished =
      prevStatus === "pending" && Boolean(status) && status !== "pending"

    if (aiFinished) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
    }

    if (idChanged) {
      formDirty.current = false
      hydrateFromBookmark(bookmark)
      hydratedBookmarkId.current = bookmarkId
    } else if (aiFinished && !formDirty.current) {
      hydrateFromBookmark(bookmark)
    }

    lastSeenAiStatus.current = status
  }, [open, bookmark, bookmarkId, queryClient])

  const updateMutation = useMutation({
    mutationFn: () => {
      const parsedTags = tagsInput
        .split(/[,，]/)
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)

      const payload: Parameters<typeof api.updateBookmark>[1] = {
        summary_ai: summaryAi.trim() || null,
        folder_id: folderId || null,
        tags: parsedTags,
        notes: notes.trim() || null,
        track_updates: trackUpdates,
      }

      if (bookmark?.source_type === "url") {
        payload.account_registered = accountRegistered
        payload.account_username = accountUsername.trim() || null
        if (passwordDirty) {
          payload.account_password = accountPassword
        }
      }

      return api.updateBookmark(bookmarkId!, payload)
    },
    onSuccess: () => {
      formDirty.current = false
      setAccountPassword("")
      setPasswordDirty(false)
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.all })
      toast.success(t("detail.saved"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("detail.saveFailed"))
    },
  })

  const handleCopyUsername = async () => {
    const value = accountUsername.trim() || bookmark?.account_username || ""
    if (!value) {
      toast.error(t("detail.accountUsernameEmpty"))
      return
    }
    const ok = await copyText(value, {
      unsupportedMessage: t("detail.copyUnsupported"),
      silent: true,
    })
    if (ok) {
      flashCopied(setUsernameCopied, usernameCopyTimer)
    }
  }

  const handleCopyPassword = async () => {
    if (!bookmarkId) return
    if (passwordDirty) {
      toast.error(t("detail.accountPasswordSaveFirst"))
      return
    }
    if (!bookmark?.account_password_set) {
      toast.error(t("detail.accountPasswordNotSet"))
      return
    }
    setCopyingPassword(true)
    try {
      const password = await api.copyAccountPassword(bookmarkId)
      // 明文仅作局部变量，立即写入剪贴板后丢弃
      const ok = await copyText(password, {
        unsupportedMessage: t("detail.copyUnsupported"),
        silent: true,
      })
      if (ok) {
        flashCopied(setPasswordCopied, passwordCopyTimer)
      }
    } catch (err) {
      toast.error(formatApiError(err as Error, t) || t("detail.copyFailed"))
    } finally {
      setCopyingPassword(false)
    }
  }

  const regenerateAiMutation = useMutation({
    mutationFn: () => api.regenerateAi(bookmarkId!),
    onSuccess: () => {
      formDirty.current = false
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("detail.regenerateSubmitted"))
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t) || t("detail.regenerateFailed"))
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) =>
      api.updateBookmark(bookmarkId!, { archived }),
    onSuccess: (_, archived) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(archived ? t("detail.archivedToast") : t("detail.unarchivedToast"))
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteBookmark(bookmarkId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
      toast.success(t("detail.deletedToast"))
      onOpenChange(false)
    },
    onError: (err: Error) => {
      toast.error(formatApiError(err, t))
    },
  })

  if (!open) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-md md:max-w-lg"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b border-border p-4 md:p-6">
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle className="text-base md:text-lg font-semibold truncate text-foreground">
              {bookmark?.external_id || bookmark?.title || t("detail.titleFallback")}
            </SheetTitle>
            {bookmark?.canonical_url && (
              <BookmarkOpenButton bookmark={bookmark} />
            )}
          </div>
          {bookmark?.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {bookmark.description}
            </p>
          )}
        </SheetHeader>

        {isLoading || !bookmark ? (
          <div className="p-6 space-y-4">
            <div className="h-4 w-32 bg-muted animate-pulse rounded" />
            <div className="h-20 w-full bg-muted animate-pulse rounded" />
            <div className="h-10 w-full bg-muted animate-pulse rounded" />
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4 text-sm md:p-6">
              {/* Metadata Bar */}
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border/50 bg-muted/30 p-2.5 text-xs text-muted-foreground">
                {bookmark.favicon_url ? (
                  <img
                    src={bookmark.favicon_url}
                    alt=""
                    className="size-4 rounded-sm"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                {(bookmark.site_name || bookmark.owner) &&
                bookmark.source_type !== "github" ? (
                  <span className="truncate text-[11px]">
                    {bookmark.site_name || bookmark.owner}
                  </span>
                ) : null}
                {bookmark.language && (
                  <span className="flex items-center gap-1 font-mono text-[11px]">
                    <span className="size-2 rounded-full bg-primary" />
                    {bookmark.language}
                  </span>
                )}
                {(bookmark.source_type === "github" ||
                  bookmark.source_type === "twitter") &&
                  bookmark.stars !== undefined && (
                  <span className="flex items-center gap-1 font-mono text-[11px]">
                    {bookmark.source_type === "twitter" ? (
                      <HeartIcon className="size-3.5 text-rose-500" weight="fill" />
                    ) : (
                      <StarIcon className="size-3.5 text-amber-500" />
                    )}
                    {bookmark.stars}
                  </span>
                )}
                {bookmark.source_type === "github" &&
                  bookmark.forks !== undefined && (
                  <span className="flex items-center gap-1 font-mono text-[11px]">
                    <GitForkIcon className="size-3.5" />
                    {bookmark.forks}
                  </span>
                )}
                {bookmark.source_type === "github" ? (
                  <HealthStatusBadge status={bookmark.health_status} />
                ) : null}
                {bookmark.pushed_at && (
                  <span className="ml-auto flex items-center gap-1 font-mono text-[11px]">
                    <ClockIcon className="size-3" />
                    {new Date(bookmark.pushed_at).toLocaleDateString(i18n.language)}
                  </span>
                )}
              </div>

              {bookmark.source_type === "twitter" && bookmark.image_url ? (
                <img
                  src={bookmark.image_url}
                  alt=""
                  className="max-h-48 w-full rounded-lg border border-border/40 object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : null}

              {(bookmark.sync_status || bookmark.last_synced_at) && (
                <p className="text-[11px] text-muted-foreground">
                  {t("detail.syncPrefix", {
                    status: bookmark.sync_status || "—",
                  })}
                  {bookmark.last_synced_at
                    ? ` · ${new Date(bookmark.last_synced_at).toLocaleString(i18n.language)}`
                    : ""}
                  {bookmark.last_sync_error
                    ? ` · ${bookmark.last_sync_error}`
                    : ""}
                </p>
              )}

              {bookmark.content_excerpt ? (
                <details className="group rounded-lg border border-border/50 bg-muted/20">
                  <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground marker:content-none">
                    {t("detail.excerptLabel")}
                  </summary>
                  <p className="max-h-40 overflow-y-auto border-t border-border/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                    {bookmark.content_excerpt}
                  </p>
                </details>
              ) : null}

              {/* AI Summary (Editable) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">{t("detail.summaryLabel")}</Label>
                  {isAuthenticated ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => regenerateAiMutation.mutate()}
                      disabled={regenerateAiMutation.isPending}
                      className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <ArrowClockwiseIcon
                        className={`size-3 ${regenerateAiMutation.isPending ? "animate-spin" : ""}`}
                      />
                      <span>{t("detail.regenerate")}</span>
                    </Button>
                  ) : null}
                </div>
                {isAuthenticated ? (
                  <Textarea
                    value={summaryAi}
                    onChange={(e) => {
                      markDirty()
                      setSummaryAi(e.target.value)
                    }}
                    placeholder={t("detail.summaryPlaceholder")}
                    className="min-h-[80px] resize-none text-xs leading-relaxed"
                  />
                ) : (
                  <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                    {bookmark.summary_ai || t("detail.noSummary")}
                  </p>
                )}
              </div>

              {/* Folder Select */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t("detail.folderLabel")}</Label>
                {isAuthenticated ? (
                  <FolderSelect
                    folders={folders}
                    value={folderId || null}
                    onValueChange={(id) => {
                      markDirty()
                      setFolderId(id || "")
                    }}
                    noneLabel={t("detail.folderNone")}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {bookmark.folder?.path_label ||
                      bookmark.folder?.name ||
                      t("detail.uncategorized")}
                  </p>
                )}
              </div>

              {/* Tags Input */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {isAuthenticated ? t("detail.tagsEditable") : t("detail.tagsReadonly")}
                </Label>
                {isAuthenticated ? (
                  <Input
                    value={tagsInput}
                    onChange={(e) => {
                      markDirty()
                      setTagsInput(e.target.value)
                    }}
                    placeholder="react, ui, components"
                    className="h-9 text-xs"
                  />
                ) : null}
                {bookmark.tags && bookmark.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {bookmark.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        #{tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Private Notes — 仅登录可见 */}
              {isAuthenticated ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{t("detail.notesLabel")}</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => {
                      markDirty()
                      setNotes(e.target.value)
                    }}
                    placeholder={t("detail.notesPlaceholder")}
                    className="min-h-[100px] resize-none text-xs leading-relaxed"
                  />
                </div>
              ) : null}

              {/* 站点账号备忘 — 仅登录 + url 来源 */}
              {isAuthenticated && bookmark.source_type === "url" ? (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div className="space-y-0.5">
                      <div className="text-xs font-medium">
                        {t("detail.accountSection")}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {t("detail.accountHint")}
                      </p>
                    </div>

                    <div className="flex items-center justify-between py-1">
                      <div className="space-y-0.5">
                        <Label
                          htmlFor="account-registered"
                          className="text-xs font-medium"
                        >
                          {t("detail.accountRegistered")}
                        </Label>
                      </div>
                      <Switch
                        id="account-registered"
                        checked={accountRegistered}
                        onCheckedChange={(v) => {
                          markDirty()
                          setAccountRegistered(v)
                        }}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">
                        {t("detail.accountUsername")}
                      </Label>
                      <div className="relative flex items-center">
                        <Input
                          value={accountUsername}
                          onChange={(e) => {
                            markDirty()
                            setAccountUsername(e.target.value)
                            if (e.target.value.trim()) {
                              setAccountRegistered(true)
                            }
                          }}
                          placeholder={t("detail.accountUsernamePlaceholder")}
                          className="h-9 pr-9 text-xs"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCopyUsername()}
                          disabled={!accountUsername.trim()}
                          className="absolute right-2.5 flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-40"
                          aria-label={t("detail.copy")}
                          tabIndex={-1}
                        >
                          {usernameCopied ? (
                            <CheckIcon
                              className="size-4 text-emerald-500"
                              weight="bold"
                            />
                          ) : (
                            <CopyIcon className="size-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs font-medium">
                          {t("detail.accountPassword")}
                        </Label>
                        <span className="text-[11px] text-muted-foreground">
                          {bookmark.account_password_set
                            ? t("detail.accountPasswordSet")
                            : t("detail.accountPasswordUnset")}
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <Input
                          type="password"
                          value={accountPassword}
                          onChange={(e) => {
                            markDirty()
                            setPasswordDirty(true)
                            setAccountPassword(e.target.value)
                            if (e.target.value) {
                              setAccountRegistered(true)
                            }
                          }}
                          placeholder={
                            bookmark.account_password_set
                              ? t("detail.accountPasswordReplacePlaceholder")
                              : t("detail.accountPasswordPlaceholder")
                          }
                          className="h-9 pr-9 text-xs"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCopyPassword()}
                          disabled={
                            passwordDirty ||
                            !bookmark.account_password_set ||
                            copyingPassword
                          }
                          className="absolute right-2.5 flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-40"
                          aria-label={
                            passwordDirty
                              ? t("detail.accountPasswordSaveFirst")
                              : t("detail.copy")
                          }
                          tabIndex={-1}
                        >
                          {passwordCopied ? (
                            <CheckIcon
                              className="size-4 text-emerald-500"
                              weight="bold"
                            />
                          ) : (
                            <CopyIcon className="size-4" />
                          )}
                        </button>
                      </div>
                      {passwordDirty ? (
                        <p className="text-[11px] text-muted-foreground">
                          {accountPassword === ""
                            ? t("detail.accountPasswordClearHint")
                            : t("detail.accountPasswordSaveFirst")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}

              {isAuthenticated && bookmark.source_type === "github" ? (
                <>
              <Separator />

              {/* Track Updates Switch */}
              <div className="flex items-center justify-between py-1">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium">{t("detail.trackUpdates")}</div>
                  <p className="text-[11px] text-muted-foreground">
                    {t("detail.trackUpdatesDescription")}
                  </p>
                </div>
                <Switch
                  checked={trackUpdates}
                  onCheckedChange={(v) => {
                    markDirty()
                    setTrackUpdates(v)
                  }}
                />
              </div>
                </>
              ) : null}

              {isAuthenticated ? (
                <>
              <Separator />

              {/* Actions: Save / Archive / Delete */}
              <div className="flex flex-col gap-2 pt-2 pb-2">
                <Button
                  onClick={() => updateMutation.mutate()}
                  disabled={updateMutation.isPending}
                  className="h-9 w-full text-xs font-medium"
                >
                  {updateMutation.isPending
                    ? t("common:actions.wait")
                    : t("common:actions.saveChanges")}
                </Button>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      archiveMutation.mutate(!bookmark.archived_at)
                    }
                    disabled={archiveMutation.isPending}
                    className="gap-1.5 text-xs"
                  >
                    <ArchiveIcon className="size-3.5" />
                    <span>
                      {bookmark.archived_at
                        ? t("detail.unarchive")
                        : t("detail.archive")}
                    </span>
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (confirm(t("detail.deleteConfirm"))) {
                        deleteMutation.mutate()
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="gap-1.5 text-xs"
                  >
                    <TrashIcon className="size-3.5" />
                    <span>{t("detail.delete")}</span>
                  </Button>
                </div>
              </div>
                </>
              ) : null}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  )
}
