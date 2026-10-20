import type { KbOrganizeOp, KbOrganizeProposal } from "@mankr/shared"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Button } from "@workspace/ui/components/button"
import type { TFunction } from "i18next"
import * as React from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { ApiError } from "@/lib/api"

const GROUP_ORDER = [
  "rename_folder",
  "create_folder",
  "move_folder",
  "move_bookmarks",
  "merge_folders",
] as const

export function KbOrganizeCard({
  messageId,
  proposal,
  canApply,
  busy,
  onApply,
  onDismiss,
}: {
  messageId: string
  proposal: KbOrganizeProposal
  canApply: boolean
  busy: boolean
  onApply: (messageId: string, opIds: string[]) => Promise<void>
  onDismiss: (messageId: string) => void
}) {
  const { t } = useTranslation("kb")
  const pending = proposal.status === "pending"
  const [checked, setChecked] = React.useState(
    () => new Set(proposal.ops.map((op) => op.id))
  )
  const [applying, setApplying] = React.useState(false)

  const groups = GROUP_ORDER.map((type) => ({
    type,
    ops: proposal.ops.filter((op) => op.type === type),
  })).filter((group) => group.ops.length > 0)

  const toggle = (id: string, next: boolean) => {
    setChecked((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(id)
      else copy.delete(id)
      return copy
    })
  }

  const apply = async () => {
    const opIds = proposal.ops
      .filter((op) => checked.has(op.id))
      .map((op) => op.id)
    if (opIds.length === 0 || !canApply || applying) return
    setApplying(true)
    try {
      await onApply(messageId, opIds)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      toast.error(
        t(`errors.${code ?? "UNKNOWN"}`, { defaultValue: t("errors.UNKNOWN") })
      )
    } finally {
      setApplying(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground">
          {t("organize.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {proposal.status === "applied"
            ? t("organize.applied")
            : proposal.status === "dismissed"
              ? t("organize.dismissed")
              : proposal.ops.length === 0
                ? t("organize.noneWritten")
                : canApply
                  ? null
                  : t("organize.saving")}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.type}>
            <p className="mb-1 text-xs text-muted-foreground">
              {t(`organize.groups.${group.type}`)}
            </p>
            <ul className="flex flex-col gap-2">
              {group.ops.map((op) => (
                <li key={op.id} className="flex items-start gap-2">
                  {pending ? (
                    <Checkbox
                      className="mt-0.5"
                      checked={checked.has(op.id)}
                      disabled={busy || applying}
                      aria-label={t("organize.check")}
                      onCheckedChange={(value) => toggle(op.id, value === true)}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="leading-5">{describeOp(op, t)}</p>
                    {op.type === "move_bookmarks" && op.titles.length > 0 ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {op.titles.join("、")}
                        {op.extraCount > 0
                          ? ` ${t("organize.moreTitles", { count: op.extraCount })}`
                          : ""}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("organize.reason", { reason: op.reason })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {proposal.skipped && proposal.skipped.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-xs text-muted-foreground">
            {t("organize.skipped")}
          </p>
          <ul className="flex flex-col gap-1">
            {proposal.skipped.map((item) => (
              <li key={item.id} className="text-xs text-muted-foreground">
                {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pending ? (
        <div className="mt-3 flex items-center gap-2">
          {proposal.ops.length > 0 ? (
            <Button
              type="button"
              size="sm"
              disabled={!canApply || busy || applying || checked.size === 0}
              onClick={() => void apply()}
            >
              {applying ? t("organize.applying") : t("organize.apply")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || applying}
            onClick={() => onDismiss(messageId)}
          >
            {t("organize.dismiss")}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function describeOp(op: KbOrganizeOp, t: TFunction<"kb">): string {
  switch (op.type) {
    case "rename_folder":
      return t("organize.rename", { from: op.fromName, to: op.name })
    case "create_folder":
      return op.reuseId
        ? t("organize.reuse", { name: op.name, place: op.placeLabel })
        : t("organize.create", { name: op.name, place: op.placeLabel })
    case "move_folder":
      return t("organize.moveFolder", { from: op.fromLabel, to: op.toLabel })
    case "move_bookmarks":
      return t("organize.moveBookmarks", {
        count: op.bookmarkIds.length,
        from: op.fromLabel,
        to: op.toLabel,
      })
    case "merge_folders":
      return t("organize.merge", { from: op.fromLabel, to: op.toLabel })
  }
}
