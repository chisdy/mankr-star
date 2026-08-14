import type * as React from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { toReadableSearch } from "@/lib/search-params"
import { useTranslation } from "react-i18next"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { tagFilterHref, withTagFilter } from "../bookmark-detail-params"
import { BookmarkDetailMeta } from "./bookmark-detail-meta"
import { CopyIconButton } from "./copy-icon-button"
import { useBookmarkAccountCopy } from "./use-bookmark-account-copy"
import type { Bookmark } from "@/lib/types"

/** 详情里只做预览，缓存的 README 全文（约 8KB）不必一次铺满面板 */
const README_PREVIEW_CHARS = 2000

function Field({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

function Readout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
      {children}
    </div>
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

  const showAccount =
    isAuthenticated &&
    bookmark.source_type === "url" &&
    bookmark.account_registered

  const filterByTag = (tag: string) => {
    if (location.pathname === "/") {
      const next = withTagFilter(searchParams, tag)
      navigate(
        { search: toReadableSearch(next) },
        { flushSync: true },
      )
      return
    }
    navigate(tagFilterHref(tag), { flushSync: true })
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
        <p className="text-xs text-muted-foreground">
          {t("detail.syncPrefix", { status: bookmark.sync_status || "-" })}
          {bookmark.last_synced_at
            ? ` · ${new Date(bookmark.last_synced_at).toLocaleString(i18n.language)}`
            : ""}
          {bookmark.last_sync_error ? ` · ${bookmark.last_sync_error}` : ""}
        </p>
      ) : null}

      {bookmark.content_excerpt ||
      (bookmark.source_type === "github" && bookmark.readme_excerpt) ? (
        <Accordion multiple className="gap-3">
          {bookmark.content_excerpt ? (
            <AccordionItem
              value="excerpt"
              className="rounded-lg border border-border/50 bg-muted/20 px-3 not-last:border-b-0"
            >
              <AccordionTrigger className="py-2 text-xs hover:no-underline">
                {t("detail.excerptLabel")}
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <ScrollArea className="max-h-40" contentClassName="pr-2">
                  <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {bookmark.content_excerpt}
                  </p>
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          ) : null}

          {bookmark.source_type === "github" && bookmark.readme_excerpt ? (
            <AccordionItem
              value="readme"
              className="rounded-lg border border-border/50 bg-muted/20 px-3 not-last:border-b-0"
            >
              <AccordionTrigger className="py-2 text-xs hover:no-underline">
                {t("detail.readmeLabel")}
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <ScrollArea className="max-h-64" contentClassName="pr-2">
                  <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {bookmark.readme_excerpt.slice(0, README_PREVIEW_CHARS)}
                    {bookmark.readme_excerpt.length > README_PREVIEW_CHARS
                      ? "…"
                      : ""}
                  </p>
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          ) : null}
        </Accordion>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground">
            {t("detail.summaryLabel")}
          </Label>
          {isAuthenticated ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={onRegenerate}
              disabled={regenerating}
              className="h-6 gap-1 text-xs text-muted-foreground hover:text-foreground"
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
        <Readout>
          {bookmark.folder?.path_label ||
            bookmark.folder?.name ||
            t("detail.uncategorized")}
        </Readout>
      </Field>

      <Field label={t("detail.tagsReadonly")}>
        {bookmark.tags && bookmark.tags.length > 0 ? (
          <Readout>
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
          </Readout>
        ) : (
          <Readout>{t("detail.noTags")}</Readout>
        )}
      </Field>

      {isAuthenticated ? (
        <Field label={t("detail.notesLabel")}>
          <Readout>
            {bookmark.notes ? (
              bookmark.notes
            ) : (
              <span className="text-muted-foreground">
                {t("detail.noNotes")}
              </span>
            )}
          </Readout>
        </Field>
      ) : null}

      {showAccount ? (
        <Field label={t("detail.accountSection")}>
          <Readout>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("detail.accountUsername")}
                </span>
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-xs font-medium text-foreground">
                    {bookmark.account_username ||
                      t("detail.accountUsernameEmpty")}
                  </span>
                  <CopyIconButton
                    copied={accountCopy.usernameCopied}
                    onClick={() => void accountCopy.copyUsername()}
                    disabled={!bookmark.account_username}
                    label={t("detail.copy")}
                  />
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">
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
                      !bookmark.account_password_set ||
                      accountCopy.copyingPassword
                    }
                    label={t("detail.copy")}
                  />
                </span>
              </div>
            </div>
          </Readout>
        </Field>
      ) : null}
    </div>
  )
}
