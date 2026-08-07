import type * as React from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import {
  tagFilterHref,
  withTagFilter,
} from "../bookmark-detail-params"
import { BookmarkDetailMeta } from "./bookmark-detail-meta"
import { CopyIconButton } from "./copy-icon-button"
import { useBookmarkAccountCopy } from "./use-bookmark-account-copy"
import type { Bookmark } from "@/lib/types"

function Field({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  )
}

function Readout({
  children,
  muted,
}: {
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <p
      className={
        muted
          ? "text-xs leading-relaxed text-muted-foreground"
          : "rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-foreground"
      }
    >
      {children}
    </p>
  )
}

export function BookmarkDetailView({
  bookmark,
  isAuthenticated,
  onRegenerate,
  regenerating,
}: {
  bookmark: Bookmark
  isAuthenticated: boolean
  onRegenerate: () => void
  regenerating: boolean
}) {
  const { t, i18n } = useTranslation(["bookmarks", "common"])
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const accountCopy = useBookmarkAccountCopy({
    bookmarkId: bookmark.id,
    username: bookmark.account_username || "",
    passwordSet: Boolean(bookmark.account_password_set),
  })

  const showAccount = isAuthenticated && bookmark.source_type === "url"
  const showTrackUpdates = isAuthenticated && bookmark.source_type === "github"

  const filterByTag = (tag: string) => {
    if (location.pathname === "/") {
      const next = withTagFilter(searchParams, tag)
      navigate({ search: `?${next.toString()}` })
      return
    }
    navigate(tagFilterHref(tag))
  }

  return (
    <div className="space-y-5 p-4 text-sm md:p-6">
      <BookmarkDetailMeta bookmark={bookmark} />

      {bookmark.source_type === "twitter" && bookmark.image_url ? (
        <img
          src={bookmark.image_url}
          alt=""
          className="max-h-48 w-full rounded-lg border border-border/40 object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}

      {bookmark.sync_status || bookmark.last_synced_at ? (
        <p className="text-[11px] text-muted-foreground">
          {t("detail.syncPrefix", { status: bookmark.sync_status || "-" })}
          {bookmark.last_synced_at
            ? ` · ${new Date(bookmark.last_synced_at).toLocaleString(i18n.language)}`
            : ""}
          {bookmark.last_sync_error ? ` · ${bookmark.last_sync_error}` : ""}
        </p>
      ) : null}

      {bookmark.content_excerpt ? (
        <details className="group rounded-lg border border-border/50 bg-muted/20">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground marker:content-none">
            {t("detail.excerptLabel")}
          </summary>
          <p className="max-h-40 overflow-y-auto border-t border-border/40 px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {bookmark.content_excerpt}
          </p>
        </details>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">
            {t("detail.summaryLabel")}
          </Label>
          {isAuthenticated ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={onRegenerate}
              disabled={regenerating}
              className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ArrowClockwiseIcon
                className={`size-3 ${regenerating ? "animate-spin" : ""}`}
              />
              <span>{t("detail.regenerate")}</span>
            </Button>
          ) : null}
        </div>
        <Readout>{bookmark.summary_ai || t("detail.noSummary")}</Readout>
      </div>

      <Field label={t("detail.folderLabel")}>
        <Readout muted>
          {bookmark.folder?.path_label ||
            bookmark.folder?.name ||
            t("detail.uncategorized")}
        </Readout>
      </Field>

      <Field label={t("detail.tagsReadonly")}>
        {bookmark.tags && bookmark.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {bookmark.tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="cursor-pointer text-xs hover:bg-secondary/70 hover:text-secondary-foreground"
                render={
                  <button
                    type="button"
                    onClick={() => filterByTag(tag)}
                    aria-label={t("detail.filterByTag", { tag })}
                  />
                }
              >
                #{tag}
              </Badge>
            ))}
          </div>
        ) : (
          <Readout muted>{t("detail.noTags")}</Readout>
        )}
      </Field>

      {isAuthenticated ? (
        <Field label={t("detail.notesLabel")}>
          {bookmark.notes ? (
            <Readout>{bookmark.notes}</Readout>
          ) : (
            <Readout muted>{t("detail.noNotes")}</Readout>
          )}
        </Field>
      ) : null}

      {showAccount ? (
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

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {t("detail.accountRegistered")}
              </span>
              <span className="text-xs font-medium text-foreground">
                {bookmark.account_registered
                  ? t("detail.valueYes")
                  : t("detail.valueNo")}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {t("detail.accountUsername")}
              </span>
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-xs font-medium text-foreground">
                  {bookmark.account_username || t("detail.accountUsernameEmpty")}
                </span>
                <CopyIconButton
                  copied={accountCopy.usernameCopied}
                  onClick={() => void accountCopy.copyUsername()}
                  disabled={!bookmark.account_username}
                  label={t("detail.copy")}
                />
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {t("detail.accountPassword")}
              </span>
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-xs font-medium text-foreground">
                  {bookmark.account_password_set
                    ? t("detail.accountPasswordSet")
                    : t("detail.accountPasswordUnset")}
                </span>
                <CopyIconButton
                  copied={accountCopy.passwordCopied}
                  onClick={() => void accountCopy.copyPassword()}
                  disabled={
                    !bookmark.account_password_set || accountCopy.copyingPassword
                  }
                  label={t("detail.copy")}
                />
              </span>
            </div>
          </div>
        </>
      ) : null}

      {showTrackUpdates ? (
        <>
          <Separator />
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="text-xs font-medium">
                {t("detail.trackUpdates")}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("detail.trackUpdatesDescription")}
              </p>
            </div>
            <span className="shrink-0 text-xs font-medium text-foreground">
              {bookmark.track_updates
                ? t("detail.trackUpdatesOn")
                : t("detail.trackUpdatesOff")}
            </span>
          </div>
        </>
      ) : null}
    </div>
  )
}
