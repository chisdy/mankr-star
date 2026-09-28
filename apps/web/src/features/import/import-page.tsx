import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { UploadSimpleIcon } from "@phosphor-icons/react"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { ApiError, api } from "@/lib/api"
import { formatApiError } from "@/lib/api-error"
import i18n from "@/i18n"
import { queryKeys } from "@/lib/query-keys"
import type {
  BrowserImportDeadPolicy,
  BrowserImportJob,
  BrowserImportPlacement,
  BrowserImportSummary,
} from "@/lib/types"
import { parseNetscapeBookmarks } from "./parse-netscape-bookmarks"

const BATCH_SIZE = 200

function importErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError && err.code) {
    const keyed = t(`errors.${err.code}`)
    if (keyed && keyed !== `errors.${err.code}`) return keyed
  }
  return formatApiError(err, i18n.getFixedT(null, "errors"))
}

function isWorking(status: string | undefined): boolean {
  return (
    status === "uploading" ||
    status === "probing" ||
    status === "classifying" ||
    status === "importing"
  )
}

function ProgressBar({
  processed,
  total,
}: {
  processed: number
  total: number
}) {
  const pct =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-primary transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-2">
      <div className="text-lg font-medium tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function ResultCard({
  title,
  count,
  children,
  footer,
}: {
  title: string
  count?: number
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          {count != null ? (
            <Badge variant="secondary" className="tabular-nums">
              {count}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {children}
        {footer}
      </CardContent>
    </Card>
  )
}

function FolderCounts({
  title,
  rows,
  emptyLabel,
}: {
  title: string
  rows: { label: string; count: number }[]
  emptyLabel: string
}) {
  if (rows.length === 0) return null
  return (
    <ResultCard title={title}>
      <ScrollArea className={rows.length > 6 ? "h-52" : undefined}>
        <ul className="flex flex-col">
          {rows.map((row) => {
            const label = row.label || emptyLabel
            return (
              <li
                key={label}
                className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0"
              >
                <span className="min-w-0 truncate text-sm" title={label}>
                  {label}
                </span>
                <Badge variant="outline" className="tabular-nums">
                  {row.count}
                </Badge>
              </li>
            )
          })}
        </ul>
      </ScrollArea>
    </ResultCard>
  )
}

function Samples({
  title,
  rows,
  total,
  moreLabel,
}: {
  title: string
  rows: { title: string; url: string }[]
  total: number
  moreLabel: string
}) {
  if (rows.length === 0) return null
  return (
    <ResultCard
      title={title}
      count={total}
      footer={
        total > rows.length ? (
          <p className="text-xs text-muted-foreground">{moreLabel}</p>
        ) : null
      }
    >
      <ScrollArea className={rows.length > 4 ? "h-52" : undefined}>
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.url}
              className="flex min-w-0 flex-col gap-0.5 border-b border-border/60 py-2 last:border-b-0"
            >
              <span className="truncate text-sm" title={row.title}>
                {row.title}
              </span>
              <span
                className="truncate text-xs text-muted-foreground"
                title={row.url}
              >
                {row.url}
              </span>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </ResultCard>
  )
}

const EXPORT_STEPS = [
  "exportChrome",
  "exportEdge",
  "exportFirefox",
  "exportSafari",
] as const

function isBookmarkHtml(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith(".html") || name.endsWith(".htm") || file.type === "text/html"
  )
}

function BookmarkFileDrop({
  inputRef,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  onPick: (file: File) => void
}) {
  const { t } = useTranslation("import")
  const [over, setOver] = React.useState(false)
  const depth = React.useRef(0)

  function accept(file: File | undefined) {
    if (!file) return
    if (!isBookmarkHtml(file)) {
      toast.error(t("notHtml"))
      return
    }
    onPick(file)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-balance">{t("exportTitle")}</h2>
        <p className="text-sm text-pretty text-muted-foreground">
          {t("exportLead")}
        </p>
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-pretty text-muted-foreground">
          {EXPORT_STEPS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </div>
      <label
        className={cn(
          "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-card px-6 py-10 text-center transition-[border-color,background-color] duration-150",
          "has-[:focus-visible]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40",
          over && "border-primary bg-primary/5"
        )}
        onDragEnter={(event) => {
          event.preventDefault()
          depth.current += 1
          setOver(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          depth.current -= 1
          if (depth.current <= 0) {
            depth.current = 0
            setOver(false)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          depth.current = 0
          setOver(false)
          accept(event.dataTransfer.files[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".html,.htm,text/html"
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files?.[0])
            event.target.value = ""
          }}
        />
        <UploadSimpleIcon className="size-8 text-muted-foreground" />
        <span className="text-sm font-medium">
          {over ? t("dropNow") : t("dropTitle")}
        </span>
        <span className="text-xs text-muted-foreground">{t("dropOr")}</span>
      </label>
    </div>
  )
}

export function ImportPage() {
  const { t } = useTranslation("import")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { publicBrowsingEnabled } = useAuth()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const startedHere = React.useRef(false)
  const invalidated = React.useRef<string | null>(null)
  const [jobId, setJobId] = React.useState<string | null>(null)
  const [upload, setUpload] = React.useState<{
    done: number
    total: number
  } | null>(null)
  const [placement, setPlacement] =
    React.useState<BrowserImportPlacement>("original")
  const [deadPolicy, setDeadPolicy] =
    React.useState<BrowserImportDeadPolicy>("skip")

  const activeQuery = useQuery({
    queryKey: queryKeys.import.browserActive,
    queryFn: () => api.getBrowserImportActive(),
  })

  React.useEffect(() => {
    const id = activeQuery.data?.job?.id
    if (id) setJobId(id)
  }, [activeQuery.data?.job?.id])

  const jobQuery = useQuery({
    queryKey: queryKeys.import.browserJob(jobId ?? "none"),
    queryFn: () => api.getBrowserImportJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      isWorking(query.state.data?.job.status) ? 1500 : false,
  })

  const job = jobQuery.data?.job ?? null

  React.useEffect(() => {
    if (
      job?.placement === "original" ||
      job?.placement === "existing" ||
      job?.placement === "ai_new"
    ) {
      setPlacement(job.placement)
    }
    if (job?.dead_policy === "skip" || job?.dead_policy === "import") {
      setDeadPolicy(job.dead_policy)
    }
  }, [job?.placement, job?.dead_policy])

  React.useEffect(() => {
    if (!job || job.status !== "completed" || invalidated.current === job.id)
      return
    invalidated.current = job.id
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
  }, [job, queryClient])

  const choose = useMutation({
    mutationFn: () => api.chooseBrowserImport(jobId!, placement, deadPolicy),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.import.browserJob(data.job.id), data)
    },
    onError: (err) => toast.error(importErrorMessage(err, t)),
  })

  const cancel = useMutation({
    mutationFn: () => api.cancelBrowserImport(jobId!),
    onSuccess: async () => {
      const id = jobId
      setJobId(null)
      if (id)
        queryClient.removeQueries({ queryKey: queryKeys.import.browserJob(id) })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.import.browserActive,
      })
    },
    onError: (err) => toast.error(importErrorMessage(err, t)),
  })

  async function onFile(file: File) {
    const items = parseNetscapeBookmarks(await file.text())
    if (items.length === 0) {
      toast.error(t("emptyFile"))
      return
    }
    setUpload({ done: 0, total: items.length })
    startedHere.current = true
    try {
      const created = await api.createBrowserImport("html")
      const id = created.job.id
      setJobId(id)
      for (let index = 0; index < items.length; index += BATCH_SIZE) {
        const batchIndex = index / BATCH_SIZE
        await api.appendBrowserImportBatch(
          id,
          batchIndex,
          items.slice(index, index + BATCH_SIZE)
        )
        setUpload({
          done: Math.min(items.length, index + BATCH_SIZE),
          total: items.length,
        })
      }
      const scanned = await api.scanBrowserImport(id)
      queryClient.setQueryData(queryKeys.import.browserJob(id), scanned)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.import.browserActive,
      })
    } catch (err) {
      toast.error(importErrorMessage(err, t))
    } finally {
      setUpload(null)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const summary: BrowserImportSummary | null = job?.summary ?? null
  const showAnalysis =
    job &&
    (job.status === "awaiting_choice" ||
      job.status === "classifying" ||
      job.status === "importing" ||
      job.status === "completed" ||
      job.status === "failed")
  const aiDisabled = Boolean(job && !job.ai_available && !job.classified)
  const needsClassify =
    (placement === "existing" || placement === "ai_new") && !job?.classified
  const canChoose = job?.status === "awaiting_choice" && !choose.isPending

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-6">
      <div className="space-y-2">
        <h1 className="text-lg font-medium">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
      </div>

      {!job && !upload ? (
        <BookmarkFileDrop
          inputRef={fileRef}
          onPick={(file) => void onFile(file)}
        />
      ) : null}

      {upload ? (
        <div className="space-y-2">
          <p className="text-sm">
            {t("uploading", { done: upload.done, total: upload.total })}
          </p>
          <ProgressBar processed={upload.done} total={upload.total} />
        </div>
      ) : null}

      {job && isWorking(job.status) && !upload ? (
        <div className="space-y-2">
          <p className="text-sm">
            {job.status === "probing"
              ? t("checking")
              : job.status === "classifying"
                ? t("classifying")
                : job.status === "importing"
                  ? t("importing")
                  : t("resume")}
          </p>
          <ProgressBar processed={job.processed} total={job.total} />
          <p className="text-xs text-muted-foreground">
            {t("progress", { processed: job.processed, total: job.total })}
            {job.current_title ? ` · ${job.current_title}` : ""}
          </p>
        </div>
      ) : null}

      {job && !startedHere.current && job.status !== "completed" && !upload ? (
        <p className="text-sm text-muted-foreground">{t("resume")}</p>
      ) : null}

      {showAnalysis && summary ? (
        <Analysis
          job={job}
          summary={summary}
          placement={placement}
          deadPolicy={deadPolicy}
          aiDisabled={aiDisabled}
          canChoose={canChoose}
          needsClassify={needsClassify}
          publicBrowsingEnabled={publicBrowsingEnabled}
          onPlacement={setPlacement}
          onDeadPolicy={setDeadPolicy}
          onConfirm={() => choose.mutate()}
          onCancel={() => cancel.mutate()}
          onAnother={() => setJobId(null)}
          onView={() => navigate("/")}
          cancelling={cancel.isPending}
        />
      ) : null}

      {job &&
      !upload &&
      job.status !== "awaiting_choice" &&
      job.status !== "completed" &&
      job.status !== "failed" &&
      job.status !== "cancelled" ? (
        <Button
          type="button"
          variant="outline"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          {t("cancel")}
        </Button>
      ) : null}
    </div>
  )
}

function Analysis({
  job,
  summary,
  placement,
  deadPolicy,
  aiDisabled,
  canChoose,
  needsClassify,
  publicBrowsingEnabled,
  onPlacement,
  onDeadPolicy,
  onConfirm,
  onCancel,
  onAnother,
  onView,
  cancelling,
}: {
  job: BrowserImportJob
  summary: BrowserImportSummary
  placement: BrowserImportPlacement
  deadPolicy: BrowserImportDeadPolicy
  aiDisabled: boolean
  canChoose: boolean
  needsClassify: boolean
  publicBrowsingEnabled: boolean
  onPlacement: (value: BrowserImportPlacement) => void
  onDeadPolicy: (value: BrowserImportDeadPolicy) => void
  onConfirm: () => void
  onCancel: () => void
  onAnother: () => void
  onView: () => void
  cancelling: boolean
}) {
  const { t } = useTranslation("import")
  const importable = summary.ok + summary.unknown
  const choosing = job.status === "awaiting_choice"

  return (
    <div className="space-y-6">
      {job.status === "completed" ? (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">{t("doneTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("doneBody", { imported: job.imported, skipped: job.skipped })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onView}>
              {t("viewBookmarks")}
            </Button>
            <Button type="button" variant="outline" onClick={onAnother}>
              {t("importAnother")}
            </Button>
          </div>
        </div>
      ) : null}

      {job.status === "failed" ? (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">{t("failedTitle")}</h2>
          {job.last_error ? (
            <p className="text-sm text-muted-foreground">{job.last_error}</p>
          ) : null}
          <Button type="button" variant="outline" onClick={onAnother}>
            {t("importAnother")}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label={t("statsImportable")} value={importable} />
        <Stat label={t("statsDuplicate")} value={summary.duplicate} />
        <Stat label={t("statsDead")} value={summary.dead} />
        <Stat label={t("statsUnknown")} value={summary.unknown} />
        <Stat label={t("statsInvalid")} value={summary.invalid} />
      </div>

      <div className="grid items-start gap-4 md:grid-cols-2">
        <Samples
          title={t("deadSamples")}
          rows={summary.dead_samples}
          total={summary.dead}
          moreLabel={t("sampleMore", { count: summary.dead })}
        />
        <Samples
          title={t("invalidSamples")}
          rows={summary.invalid_samples}
          total={summary.invalid}
          moreLabel={t("sampleMore", { count: summary.invalid })}
        />
        <FolderCounts
          title={t("foldersOriginal")}
          rows={summary.original_folders}
          emptyLabel={t("uncategorized")}
        />
        <FolderCounts
          title={t("foldersSuggested")}
          rows={summary.suggested_folders}
          emptyLabel={t("uncategorized")}
        />
      </div>

      {choosing ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            onConfirm()
          }}
        >
          <div className="grid items-start gap-4 md:grid-cols-2">
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="text-sm font-medium">
                {t("placementLegend")}
              </legend>
              <RadioGroup
                value={placement}
                onValueChange={onPlacement}
                disabled={!canChoose}
              >
                <RadioChoice
                  value="original"
                  label={t("placementOriginal")}
                  hint={t("placementOriginalHint")}
                />
                {job.has_folders ? (
                  <RadioChoice
                    value="existing"
                    disabled={aiDisabled}
                    label={t("placementExisting")}
                    hint={t("placementExistingHint")}
                  />
                ) : (
                  <RadioChoice
                    value="ai_new"
                    disabled={aiDisabled}
                    label={t("placementAi")}
                    hint={t("placementAiHint")}
                  />
                )}
              </RadioGroup>
              {aiDisabled ? (
                <p className="text-xs text-pretty text-muted-foreground">
                  {t("aiUnavailable")}
                </p>
              ) : null}
            </fieldset>

            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="text-sm font-medium">{t("deadLegend")}</legend>
              <RadioGroup
                value={deadPolicy}
                onValueChange={onDeadPolicy}
                disabled={!canChoose}
              >
                <RadioChoice value="skip" label={t("deadSkip")} />
                <RadioChoice value="import" label={t("deadImport")} />
              </RadioGroup>
            </fieldset>
          </div>

          {publicBrowsingEnabled ? (
            <Alert>
              <AlertDescription>{t("publicWarning")}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!canChoose}>
              {needsClassify ? t("confirmClassify") : t("confirmImport")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={cancelling}
              onClick={onCancel}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

function RadioChoice({
  value,
  disabled,
  label,
  hint,
}: {
  value: string
  disabled?: boolean
  label: string
  hint?: string
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-card px-3 py-3 transition-[border-color,background-color] duration-150",
        "has-[[data-slot=radio-group-item][data-checked]]:border-primary has-[[data-slot=radio-group-item][data-checked]]:bg-primary/5",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
      )}
    >
      <RadioGroupItem value={value} disabled={disabled} className="mt-0.5" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint ? (
          <span className="text-xs text-pretty text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  )
}
