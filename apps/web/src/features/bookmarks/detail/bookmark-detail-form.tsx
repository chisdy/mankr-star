import { useTranslation } from "react-i18next"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { Button } from "@workspace/ui/components/button"
import { FolderSelect } from "@/features/folders/folder-select"
import { CopyIconButton } from "./copy-icon-button"
import { useBookmarkAccountCopy } from "./use-bookmark-account-copy"
import type { BookmarkFormValues } from "./use-bookmark-detail-form"
import type { Bookmark, Folder } from "@/lib/types"

type PricingFormValue = BookmarkFormValues["pricing"]

const PRICING_FORM_OPTIONS: PricingFormValue[] = [
  null,
  "free",
  "freemium",
  "paid",
]

export function BookmarkDetailForm({
  bookmark,
  folders,
  values,
  patch,
  onRegenerate,
  regenerating,
}: {
  bookmark: Bookmark
  folders: Folder[]
  values: BookmarkFormValues
  patch: (next: Partial<BookmarkFormValues>) => void
  onRegenerate: () => void
  regenerating: boolean
}) {
  const { t } = useTranslation(["bookmarks", "common"])
  const accountCopy = useBookmarkAccountCopy({
    bookmarkId: bookmark.id,
    username: values.accountUsername,
    passwordSet: Boolean(bookmark.account_password_set),
    passwordDirty: values.passwordDirty,
  })

  return (
    <div className="space-y-5 p-4 text-sm md:p-6">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">{t("detail.titleLabel")}</Label>
        <Input
          value={values.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={t("detail.titlePlaceholder")}
          className="h-9 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">
          {t("detail.descriptionLabel")}
        </Label>
        <Textarea
          value={values.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder={t("detail.descriptionPlaceholder")}
          className="min-h-[64px] resize-none text-sm leading-relaxed"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">
            {t("detail.summaryLabel")}
          </Label>
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
        </div>
        <Textarea
          value={values.summaryAi}
          onChange={(e) => patch({ summaryAi: e.target.value })}
          placeholder={t("detail.summaryPlaceholder")}
          className="min-h-[80px] resize-none text-xs leading-relaxed"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">{t("detail.folderLabel")}</Label>
        <FolderSelect
          folders={folders}
          value={values.folderId || null}
          onValueChange={(id) => patch({ folderId: id || "" })}
          noneLabel={t("detail.folderNone")}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">{t("detail.tagsEditable")}</Label>
        <Input
          value={values.tagsInput}
          onChange={(e) => patch({ tagsInput: e.target.value })}
          placeholder="react, ui, components"
          className="h-9 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">{t("detail.notesLabel")}</Label>
        <Textarea
          value={values.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder={t("detail.notesPlaceholder")}
          className="min-h-[100px] resize-none text-xs leading-relaxed"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">
          {t("detail.pricingLabel")}
        </Label>
        <Select
          items={PRICING_FORM_OPTIONS.map((value) => ({
            value,
            label:
              value === null
                ? t("detail.pricingUnset")
                : t(`pricing.${value}`),
          }))}
          value={values.pricing}
          onValueChange={(val) =>
            patch({ pricing: (val as PricingFormValue) ?? null })
          }
        >
          <SelectTrigger className="h-9 w-full text-xs">
            <SelectValue placeholder={t("detail.pricingUnset")} />
          </SelectTrigger>
          <SelectContent>
            {PRICING_FORM_OPTIONS.map((value) => (
              <SelectItem key={value ?? "unset"} value={value}>
                {value === null
                  ? t("detail.pricingUnset")
                  : t(`pricing.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between py-1">
        <Label htmlFor="bookmark-featured" className="text-xs font-medium">
          {t("detail.featuredLabel")}
        </Label>
        <Switch
          id="bookmark-featured"
          checked={values.featured}
          onCheckedChange={(v) => patch({ featured: v })}
        />
      </div>

      {bookmark.source_type === "url" ? (
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
              <Label
                htmlFor="account-registered"
                className="text-xs font-medium"
              >
                {t("detail.accountRegistered")}
              </Label>
              <Switch
                id="account-registered"
                checked={values.accountRegistered}
                onCheckedChange={(v) => patch({ accountRegistered: v })}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                {t("detail.accountUsername")}
              </Label>
              <div className="relative flex items-center">
                <Input
                  value={values.accountUsername}
                  onChange={(e) =>
                    patch({
                      accountUsername: e.target.value,
                      ...(e.target.value.trim()
                        ? { accountRegistered: true }
                        : {}),
                    })
                  }
                  placeholder={t("detail.accountUsernamePlaceholder")}
                  className="h-9 pr-9 text-xs"
                  autoComplete="off"
                />
                <CopyIconButton
                  copied={accountCopy.usernameCopied}
                  onClick={() => void accountCopy.copyUsername()}
                  disabled={!values.accountUsername.trim()}
                  label={t("detail.copy")}
                  className="absolute right-2.5"
                />
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
                  value={values.accountPassword}
                  onChange={(e) =>
                    patch({
                      accountPassword: e.target.value,
                      passwordDirty: true,
                      ...(e.target.value ? { accountRegistered: true } : {}),
                    })
                  }
                  placeholder={
                    bookmark.account_password_set
                      ? t("detail.accountPasswordReplacePlaceholder")
                      : t("detail.accountPasswordPlaceholder")
                  }
                  className="h-9 pr-9 text-xs"
                  autoComplete="new-password"
                />
                <CopyIconButton
                  copied={accountCopy.passwordCopied}
                  onClick={() => void accountCopy.copyPassword()}
                  disabled={
                    values.passwordDirty ||
                    !bookmark.account_password_set ||
                    accountCopy.copyingPassword
                  }
                  label={
                    values.passwordDirty
                      ? t("detail.accountPasswordSaveFirst")
                      : t("detail.copy")
                  }
                  className="absolute right-2.5"
                />
              </div>
              {values.passwordDirty ? (
                <p className="text-[11px] text-muted-foreground">
                  {values.accountPassword === ""
                    ? t("detail.accountPasswordClearHint")
                    : t("detail.accountPasswordSaveFirst")}
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {bookmark.source_type === "github" ? (
        <>
          <Separator />
          <div className="flex items-center justify-between py-1">
            <div className="space-y-0.5">
              <div className="text-xs font-medium">
                {t("detail.trackUpdates")}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("detail.trackUpdatesDescription")}
              </p>
            </div>
            <Switch
              checked={values.trackUpdates}
              onCheckedChange={(v) => patch({ trackUpdates: v })}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
