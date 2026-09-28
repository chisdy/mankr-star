import {
  bookmarks,
  browserImportItems,
  browserImportJobs,
  createDb,
  folders,
  type BrowserImportItem,
  type BrowserImportJob,
  type Db,
} from "@mankr/db"
import { IMPORT_JOB_LEASE_MS, IMPORT_JOB_TIME_BUDGET_MS } from "@mankr/shared"
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm"
import type { Env } from "../env"
import { getDeepSeekKey } from "./ai-service"
import { bumpBookmarkMatchRevision } from "./bookmark-match-revision"
import { classifyBrowserImportBatch } from "./browser-import-ai"
import {
  ensureBrowserFolderPath,
  type BrowserFolderCache,
} from "./browser-folder-path"
import { resolveBrowserImportIdentity } from "./browser-import-identity"
import { probeBookmarkUrl } from "./browser-import-probe"
import { normalizeFolderName } from "./deepseek"
import { buildPathLabel } from "./folder-utils"
import { nowIso } from "./utils"

const BATCH_ITEM_CAP = 200
const JOB_ITEM_CAP = 20_000
const SEQ_STRIDE = 1_000
const PROBE_CONCURRENCY = 6
const NORMALIZE_CHUNK = 40
const AI_CHUNK = 20
const WRITE_CHUNK = 12

const UNFINISHED = [
  "uploading",
  "probing",
  "awaiting_choice",
  "classifying",
  "importing",
] as const

const RESUMABLE = ["probing", "classifying", "importing"] as const

export class BrowserImportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message)
    this.name = "BrowserImportError"
  }
}

/** 单条写入失败。任务保持原状态，等租约过后续跑，不整次标失败。 */
class BrowserImportWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BrowserImportWriteError"
  }
}

export type BrowserImportInputItem = {
  title: string
  url: string
  folderPath: string[]
}

export type BrowserImportSummary = {
  ok: number
  dead: number
  unknown: number
  invalid: number
  duplicate: number
  original_folders: { label: string; count: number }[]
  suggested_folders: { label: string; count: number }[]
  dead_samples: { title: string; url: string }[]
  invalid_samples: { title: string; url: string }[]
}

export type BrowserImportJobPublic = {
  id: string
  status: string
  source: string
  placement: string | null
  dead_policy: string | null
  has_folders: boolean
  classified: boolean
  ai_available: boolean
  total: number
  processed: number
  imported: number
  skipped: number
  failed_count: number
  summary: BrowserImportSummary
  current_title: string | null
  last_error: string | null
  started_at: string | null
  updated_at: string
  finished_at: string | null
}

const EMPTY_SUMMARY: BrowserImportSummary = {
  ok: 0,
  dead: 0,
  unknown: 0,
  invalid: 0,
  duplicate: 0,
  original_folders: [],
  suggested_folders: [],
  dead_samples: [],
  invalid_samples: [],
}

export type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void
}

export type RunBrowserImportOpts = {
  renew?: boolean
  budgetMs?: number
  continueBaseUrl?: string
}

function leaseUntilIso(fromMs = Date.now()): string {
  return new Date(fromMs + IMPORT_JOB_LEASE_MS).toISOString()
}

function parseSummary(raw: string): BrowserImportSummary {
  try {
    const parsed = JSON.parse(raw) as Partial<BrowserImportSummary>
    return {
      ...EMPTY_SUMMARY,
      ...parsed,
      original_folders: Array.isArray(parsed.original_folders)
        ? parsed.original_folders
        : [],
      suggested_folders: Array.isArray(parsed.suggested_folders)
        ? parsed.suggested_folders
        : [],
      dead_samples: Array.isArray(parsed.dead_samples)
        ? parsed.dead_samples
        : [],
      invalid_samples: Array.isArray(parsed.invalid_samples)
        ? parsed.invalid_samples
        : [],
    }
  } catch {
    return { ...EMPTY_SUMMARY }
  }
}

function parseNames(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

async function loadJob(
  db: Db,
  jobId: string
): Promise<BrowserImportJob | null> {
  return (
    (await db
      .select()
      .from(browserImportJobs)
      .where(eq(browserImportJobs.id, jobId))
      .get()) ?? null
  )
}

export async function findActiveBrowserImportJob(
  db: Db
): Promise<BrowserImportJob | null> {
  return (
    (await db
      .select()
      .from(browserImportJobs)
      .where(inArray(browserImportJobs.status, [...UNFINISHED]))
      .orderBy(desc(browserImportJobs.createdAt))
      .get()) ?? null
  )
}

export async function serializeBrowserImportJob(
  db: Db,
  env: Env,
  job: BrowserImportJob
): Promise<BrowserImportJobPublic> {
  const key = await getDeepSeekKey(db, env)
  return {
    id: job.id,
    status: job.status,
    source: job.source,
    placement: job.placement,
    dead_policy: job.deadPolicy,
    has_folders: job.hasFolders,
    classified: job.classified,
    ai_available: Boolean(key),
    total: job.total,
    processed: job.processed,
    imported: job.imported,
    skipped: job.skipped,
    failed_count: job.failedCount,
    summary: parseSummary(job.summaryJson),
    current_title: job.currentTitle,
    last_error: job.lastError,
    started_at: job.startedAt,
    updated_at: job.updatedAt,
    finished_at: job.finishedAt,
  }
}

export async function createBrowserImportJob(
  db: Db,
  source: "html" | "extension"
): Promise<BrowserImportJob> {
  const active = await findActiveBrowserImportJob(db)
  if (active) {
    throw new BrowserImportError("已有未完成的书签导入", 409, "IMPORT_ACTIVE")
  }
  const now = nowIso()
  const id = crypto.randomUUID()
  await db.insert(browserImportJobs).values({
    id,
    status: "uploading",
    source,
    continueToken: crypto.randomUUID(),
    summaryJson: "{}",
    createdAt: now,
    updatedAt: now,
  })
  const job = await loadJob(db, id)
  if (!job) throw new BrowserImportError("创建导入任务失败", 500, "INTERNAL")
  return job
}

function sanitizeInput(raw: unknown): BrowserImportInputItem | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const url = typeof row.url === "string" ? row.url.trim().slice(0, 2000) : ""
  if (!url) return null
  const titleRaw = typeof row.title === "string" ? row.title.trim() : ""
  const folderPath = Array.isArray(row.folderPath)
    ? row.folderPath
        .filter((part): part is string => typeof part === "string")
        .map((part) => part.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 12)
    : []
  return { title: (titleRaw || url).slice(0, 500), url, folderPath }
}

export async function appendBrowserImportBatch(
  db: Db,
  jobId: string,
  batchIndex: number,
  rawItems: unknown[]
): Promise<{ accepted: number; duplicate: boolean }> {
  const job = await loadJob(db, jobId)
  if (!job) throw new BrowserImportError("导入任务不存在", 404, "NOT_FOUND")
  if (job.status !== "uploading") {
    throw new BrowserImportError("导入已经开始检查", 409, "IMPORT_CLOSED")
  }
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex > 9999) {
    throw new BrowserImportError("批次序号无效", 400, "VALIDATION_ERROR")
  }
  if (
    !Array.isArray(rawItems) ||
    rawItems.length === 0 ||
    rawItems.length > BATCH_ITEM_CAP
  ) {
    throw new BrowserImportError("每批 1 到 200 条", 400, "VALIDATION_ERROR")
  }

  const items = rawItems
    .map((item) => sanitizeInput(item))
    .filter((item): item is BrowserImportInputItem => item !== null)
  if (items.length === 0) {
    throw new BrowserImportError("没有可上传的书签", 400, "VALIDATION_ERROR")
  }

  const existing = await db
    .select({ seq: browserImportItems.seq })
    .from(browserImportItems)
    .where(
      and(
        eq(browserImportItems.jobId, jobId),
        eq(browserImportItems.batchIndex, batchIndex)
      )
    )
  if (existing.length >= items.length) {
    return { accepted: 0, duplicate: true }
  }

  const totalRow = await db
    .select({ n: count() })
    .from(browserImportItems)
    .where(eq(browserImportItems.jobId, jobId))
    .get()
  const already = totalRow?.n ?? 0
  if (already - existing.length + items.length > JOB_ITEM_CAP) {
    throw new BrowserImportError("单次最多导入 20000 条", 400, "TOO_MANY")
  }

  const have = new Set(existing.map((row) => row.seq))
  const now = nowIso()
  let accepted = 0
  for (let index = 0; index < items.length; index++) {
    const seq = batchIndex * SEQ_STRIDE + index
    if (have.has(seq)) continue
    const item = items[index]!
    try {
      await db.insert(browserImportItems).values({
        id: crypto.randomUUID(),
        jobId,
        batchIndex,
        seq,
        title: item.title,
        url: item.url,
        folderPathJson: JSON.stringify(item.folderPath),
        createdAt: now,
      })
      accepted += 1
    } catch {
      const winner = await db
        .select({ id: browserImportItems.id })
        .from(browserImportItems)
        .where(
          and(
            eq(browserImportItems.jobId, jobId),
            eq(browserImportItems.seq, seq)
          )
        )
        .get()
      if (!winner) throw new BrowserImportError("写入批次失败", 500, "INTERNAL")
    }
  }

  await db
    .update(browserImportJobs)
    .set({ updatedAt: nowIso() })
    .where(eq(browserImportJobs.id, jobId))

  return { accepted, duplicate: accepted === 0 }
}

export async function beginBrowserImportScan(
  db: Db,
  jobId: string
): Promise<BrowserImportJob> {
  const job = await loadJob(db, jobId)
  if (!job) throw new BrowserImportError("导入任务不存在", 404, "NOT_FOUND")
  if (job.status !== "uploading") {
    throw new BrowserImportError("导入不在等待上传", 409, "IMPORT_CLOSED")
  }

  const totalRow = await db
    .select({ n: count() })
    .from(browserImportItems)
    .where(eq(browserImportItems.jobId, jobId))
    .get()
  const total = totalRow?.n ?? 0
  const folderRow = await db.select({ n: count() }).from(folders).get()
  const hasFolders = (folderRow?.n ?? 0) > 0
  const now = nowIso()

  if (total === 0) {
    await db
      .update(browserImportJobs)
      .set({
        status: "completed",
        total: 0,
        hasFolders,
        startedAt: now,
        finishedAt: now,
        leaseUntil: null,
        updatedAt: now,
        summaryJson: JSON.stringify(EMPTY_SUMMARY),
      })
      .where(
        and(
          eq(browserImportJobs.id, jobId),
          eq(browserImportJobs.status, "uploading")
        )
      )
    const done = await loadJob(db, jobId)
    if (!done) throw new BrowserImportError("导入任务不存在", 404, "NOT_FOUND")
    return done
  }

  await db
    .update(browserImportJobs)
    .set({
      status: "probing",
      total,
      hasFolders,
      processed: 0,
      startedAt: now,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(browserImportJobs.id, jobId),
        eq(browserImportJobs.status, "uploading")
      )
    )
  const next = await loadJob(db, jobId)
  if (!next || next.status !== "probing") {
    throw new BrowserImportError("导入已经开始检查", 409, "IMPORT_CLOSED")
  }
  return next
}

export async function applyBrowserImportChoice(
  db: Db,
  env: Env,
  jobId: string,
  placement: string,
  deadPolicy: string
): Promise<BrowserImportJob> {
  const job = await loadJob(db, jobId)
  if (!job) throw new BrowserImportError("导入任务不存在", 404, "NOT_FOUND")
  if (job.status !== "awaiting_choice") {
    throw new BrowserImportError("请等检查结束后再选择", 409, "IMPORT_CLOSED")
  }
  if (
    placement !== "original" &&
    placement !== "existing" &&
    placement !== "ai_new"
  ) {
    throw new BrowserImportError("目录方式无效", 400, "VALIDATION_ERROR")
  }
  if (deadPolicy !== "skip" && deadPolicy !== "import") {
    throw new BrowserImportError("失效链接处理无效", 400, "VALIDATION_ERROR")
  }
  if (placement === "existing" && !job.hasFolders) {
    throw new BrowserImportError("库里还没有文件夹", 400, "NO_FOLDERS")
  }
  if (placement === "ai_new" && job.hasFolders) {
    throw new BrowserImportError(
      "库里已有文件夹，不能再整批新建",
      400,
      "HAS_FOLDERS"
    )
  }

  const wantsAi = placement === "existing" || placement === "ai_new"
  if (wantsAi && !job.classified) {
    const key = await getDeepSeekKey(db, env)
    if (!key) {
      throw new BrowserImportError(
        "还没有配置 DeepSeek，只能按原目录导入",
        400,
        "AI_UNAVAILABLE"
      )
    }
  }

  const now = nowIso()
  const nextStatus = wantsAi && !job.classified ? "classifying" : "importing"
  await db
    .update(browserImportJobs)
    .set({
      placement,
      deadPolicy,
      status: nextStatus,
      leaseUntil: null,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(browserImportJobs.id, jobId),
        eq(browserImportJobs.status, "awaiting_choice")
      )
    )
  const next = await loadJob(db, jobId)
  if (!next || (next.status !== "classifying" && next.status !== "importing")) {
    throw new BrowserImportError("请等检查结束后再选择", 409, "IMPORT_CLOSED")
  }
  return next
}

export async function cancelBrowserImportJob(
  db: Db,
  jobId: string
): Promise<BrowserImportJob | null> {
  const job = await loadJob(db, jobId)
  if (!job) return null
  if (!UNFINISHED.includes(job.status as (typeof UNFINISHED)[number]))
    return job
  const now = nowIso()
  await db
    .update(browserImportJobs)
    .set({
      status: "cancelled",
      finishedAt: now,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(browserImportJobs.id, jobId),
        inArray(browserImportJobs.status, [...UNFINISHED])
      )
    )
  await db.delete(browserImportItems).where(eq(browserImportItems.jobId, jobId))
  return loadJob(db, jobId)
}

async function claimJob(
  db: Db,
  jobId: string
): Promise<BrowserImportJob | null> {
  const now = nowIso()
  const existing = await loadJob(db, jobId)
  if (!existing) return null
  if (!RESUMABLE.includes(existing.status as (typeof RESUMABLE)[number]))
    return null
  if (existing.leaseUntil && existing.leaseUntil > now) return null

  const lease = leaseUntilIso()
  await db
    .update(browserImportJobs)
    .set({
      leaseUntil: lease,
      startedAt: existing.startedAt ?? now,
      updatedAt: now,
    })
    .where(
      and(
        eq(browserImportJobs.id, jobId),
        inArray(browserImportJobs.status, [...RESUMABLE]),
        or(
          isNull(browserImportJobs.leaseUntil),
          lt(browserImportJobs.leaseUntil, now)
        )
      )
    )
  const claimed = await loadJob(db, jobId)
  if (!claimed || claimed.leaseUntil !== lease) return null
  if (!RESUMABLE.includes(claimed.status as (typeof RESUMABLE)[number]))
    return null
  return claimed
}

async function renewLease(
  db: Db,
  jobId: string
): Promise<BrowserImportJob | null> {
  const now = nowIso()
  const lease = leaseUntilIso()
  await db
    .update(browserImportJobs)
    .set({ leaseUntil: lease, updatedAt: now })
    .where(
      and(
        eq(browserImportJobs.id, jobId),
        inArray(browserImportJobs.status, [...RESUMABLE])
      )
    )
  const row = await loadJob(db, jobId)
  if (!row || row.leaseUntil !== lease) return null
  if (!RESUMABLE.includes(row.status as (typeof RESUMABLE)[number])) return null
  return row
}

const FOLDER_SAMPLE = 12

function placedItems(jobId: string) {
  return and(
    eq(browserImportItems.jobId, jobId),
    inArray(browserImportItems.linkStatus, ["ok", "dead", "unknown"])
  )
}

function topLabels(map: Map<string, number>) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, FOLDER_SAMPLE)
    .map(([label, n]) => ({ label, count: n }))
}

/** 按路径分组计数，只取前 12，避免把上万条书签读进内存。 */
async function loadFolderDistribution(
  db: Db,
  jobId: string
): Promise<
  Pick<BrowserImportSummary, "original_folders" | "suggested_folders">
> {
  const originalCount = count().as("original_n")
  const originalRows = await db
    .select({
      folderPathJson: browserImportItems.folderPathJson,
      n: originalCount,
    })
    .from(browserImportItems)
    .where(placedItems(jobId))
    .groupBy(browserImportItems.folderPathJson)
    .orderBy(desc(originalCount))
    .limit(FOLDER_SAMPLE)

  const original = new Map<string, number>()
  for (const row of originalRows) {
    const label = parseNames(row.folderPathJson).join(" / ")
    original.set(label, (original.get(label) ?? 0) + Number(row.n ?? 0))
  }

  const suggestedByIdCount = count().as("suggested_id_n")
  const suggestedById = await db
    .select({
      suggestedFolderId: browserImportItems.suggestedFolderId,
      n: suggestedByIdCount,
    })
    .from(browserImportItems)
    .where(
      and(placedItems(jobId), isNotNull(browserImportItems.suggestedFolderId))
    )
    .groupBy(browserImportItems.suggestedFolderId)
    .orderBy(desc(suggestedByIdCount))
    .limit(FOLDER_SAMPLE)

  const suggestedByJsonCount = count().as("suggested_json_n")
  const suggestedByJson = await db
    .select({
      suggestedFolderJson: browserImportItems.suggestedFolderJson,
      n: suggestedByJsonCount,
    })
    .from(browserImportItems)
    .where(
      and(
        placedItems(jobId),
        isNull(browserImportItems.suggestedFolderId),
        sql`${browserImportItems.suggestedFolderJson} not in ('', '[]')`
      )
    )
    .groupBy(browserImportItems.suggestedFolderJson)
    .orderBy(desc(suggestedByJsonCount))
    .limit(FOLDER_SAMPLE)

  const suggested = new Map<string, number>()
  if (suggestedById.length > 0) {
    const folderRows = await db.select().from(folders)
    const byId = new Map(folderRows.map((folder) => [folder.id, folder]))
    for (const row of suggestedById) {
      if (!row.suggestedFolderId) continue
      const folder = byId.get(row.suggestedFolderId)
      const label = folder ? buildPathLabel(folder, byId) : ""
      if (!label) continue
      suggested.set(label, (suggested.get(label) ?? 0) + Number(row.n ?? 0))
    }
  }
  for (const row of suggestedByJson) {
    const label = parseNames(row.suggestedFolderJson).join(" / ")
    if (!label) continue
    suggested.set(label, (suggested.get(label) ?? 0) + Number(row.n ?? 0))
  }

  return {
    original_folders: topLabels(original),
    suggested_folders: topLabels(suggested),
  }
}

async function refreshSummary(db: Db, jobId: string): Promise<void> {
  const counts = await db
    .select({
      status: browserImportItems.linkStatus,
      n: count(),
    })
    .from(browserImportItems)
    .where(eq(browserImportItems.jobId, jobId))
    .groupBy(browserImportItems.linkStatus)

  const summary: BrowserImportSummary = { ...EMPTY_SUMMARY }
  for (const row of counts) {
    const n = Number(row.n ?? 0)
    if (row.status === "ok") summary.ok = n
    else if (row.status === "dead") summary.dead = n
    else if (row.status === "unknown") summary.unknown = n
    else if (row.status === "invalid") summary.invalid = n
    else if (row.status === "duplicate") summary.duplicate = n
  }

  const deadSamples = await db
    .select({ title: browserImportItems.title, url: browserImportItems.url })
    .from(browserImportItems)
    .where(
      and(
        eq(browserImportItems.jobId, jobId),
        eq(browserImportItems.linkStatus, "dead")
      )
    )
    .orderBy(asc(browserImportItems.seq))
    .limit(12)
  summary.dead_samples = deadSamples

  const invalidSamples = await db
    .select({ title: browserImportItems.title, url: browserImportItems.url })
    .from(browserImportItems)
    .where(
      and(
        eq(browserImportItems.jobId, jobId),
        eq(browserImportItems.linkStatus, "invalid")
      )
    )
    .orderBy(asc(browserImportItems.seq))
    .limit(8)
  summary.invalid_samples = invalidSamples

  const distribution = await loadFolderDistribution(db, jobId)
  summary.original_folders = distribution.original_folders
  summary.suggested_folders = distribution.suggested_folders

  await db
    .update(browserImportJobs)
    .set({ summaryJson: JSON.stringify(summary), updatedAt: nowIso() })
    .where(eq(browserImportJobs.id, jobId))
}

async function enterAwaiting(
  db: Db,
  jobId: string,
  classified: boolean
): Promise<void> {
  await refreshSummary(db, jobId)
  const now = nowIso()
  await db
    .update(browserImportJobs)
    .set({
      status: "awaiting_choice",
      classified,
      leaseUntil: null,
      currentTitle: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(browserImportJobs.id, jobId),
        inArray(browserImportJobs.status, ["probing", "classifying"])
      )
    )
}

async function markFailed(db: Db, jobId: string, error: string): Promise<void> {
  try {
    await refreshSummary(db, jobId)
  } catch {
    /* 失败时摘要可缺 */
  }
  const now = nowIso()
  await db
    .update(browserImportJobs)
    .set({
      status: "failed",
      lastError: error.slice(0, 500),
      finishedAt: now,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(browserImportJobs.id, jobId),
        inArray(browserImportJobs.status, [...RESUMABLE])
      )
    )
}

async function markCompleted(db: Db, jobId: string): Promise<void> {
  await refreshSummary(db, jobId)
  const existing = await loadJob(db, jobId)
  const now = nowIso()
  const updated = await db
    .update(browserImportJobs)
    .set({
      status: "completed",
      currentTitle: null,
      finishedAt: now,
      leaseUntil: null,
      updatedAt: now,
      processed: existing?.total ?? 0,
    })
    .where(
      and(
        eq(browserImportJobs.id, jobId),
        eq(browserImportJobs.status, "importing")
      )
    )
    .returning({ id: browserImportJobs.id })
  await db.delete(browserImportItems).where(eq(browserImportItems.jobId, jobId))
  if (updated.length > 0 && (existing?.imported ?? 0) > 0) {
    await bumpBookmarkMatchRevision(db)
  }
}

async function touchProgress(
  db: Db,
  jobId: string,
  currentTitle: string | null
): Promise<void> {
  const done = await db
    .select({ n: count() })
    .from(browserImportItems)
    .where(
      and(
        eq(browserImportItems.jobId, jobId),
        ne(browserImportItems.linkStatus, "pending")
      )
    )
    .get()
  await db
    .update(browserImportJobs)
    .set({
      processed: done?.n ?? 0,
      currentTitle,
      leaseUntil: leaseUntilIso(),
      updatedAt: nowIso(),
    })
    .where(eq(browserImportJobs.id, jobId))
}

async function normalizeChunk(db: Db, jobId: string): Promise<number> {
  const pending = await db
    .select()
    .from(browserImportItems)
    .where(
      and(
        eq(browserImportItems.jobId, jobId),
        eq(browserImportItems.linkStatus, "pending"),
        isNull(browserImportItems.canonicalUrl)
      )
    )
    .orderBy(asc(browserImportItems.seq))
    .limit(NORMALIZE_CHUNK)
  if (pending.length === 0) return 0

  const knownRows = await db
    .select({ canonicalUrl: browserImportItems.canonicalUrl })
    .from(browserImportItems)
    .where(
      and(
        eq(browserImportItems.jobId, jobId),
        isNotNull(browserImportItems.canonicalUrl),
        ne(browserImportItems.linkStatus, "invalid")
      )
    )
  const seen = new Set(
    knownRows
      .map((row) => row.canonicalUrl)
      .filter((url): url is string => Boolean(url))
  )

  for (const item of pending) {
    const identity = resolveBrowserImportIdentity(item.url)
    if (!identity) {
      await db
        .update(browserImportItems)
        .set({ linkStatus: "invalid" })
        .where(eq(browserImportItems.id, item.id))
      continue
    }

    if (seen.has(identity.canonicalUrl)) {
      await db
        .update(browserImportItems)
        .set({
          linkStatus: "duplicate",
          canonicalUrl: identity.canonicalUrl,
          sourceType: identity.sourceType,
          externalId: identity.externalId,
          owner: identity.owner,
        })
        .where(eq(browserImportItems.id, item.id))
      continue
    }

    const live = await db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.canonicalUrl, identity.canonicalUrl),
          isNull(bookmarks.deletedAt)
        )
      )
      .get()
    if (live) {
      seen.add(identity.canonicalUrl)
      await db
        .update(browserImportItems)
        .set({
          linkStatus: "duplicate",
          canonicalUrl: identity.canonicalUrl,
          sourceType: identity.sourceType,
          externalId: identity.externalId,
          owner: identity.owner,
        })
        .where(eq(browserImportItems.id, item.id))
      continue
    }

    seen.add(identity.canonicalUrl)
    await db
      .update(browserImportItems)
      .set({
        canonicalUrl: identity.canonicalUrl,
        sourceType: identity.sourceType,
        externalId: identity.externalId,
        owner: identity.owner,
      })
      .where(eq(browserImportItems.id, item.id))
  }

  return pending.length
}

async function probeChunk(db: Db, jobId: string): Promise<number> {
  const rows = await db
    .select()
    .from(browserImportItems)
    .where(
      and(
        eq(browserImportItems.jobId, jobId),
        eq(browserImportItems.linkStatus, "pending"),
        isNotNull(browserImportItems.canonicalUrl)
      )
    )
    .orderBy(asc(browserImportItems.seq))
    .limit(PROBE_CONCURRENCY)
  if (rows.length === 0) return 0

  await Promise.all(
    rows.map(async (row) => {
      const outcome = await probeBookmarkUrl(row.canonicalUrl!)
      await db
        .update(browserImportItems)
        .set({
          linkStatus: outcome.linkStatus,
          httpStatus: outcome.httpStatus,
        })
        .where(eq(browserImportItems.id, row.id))
    })
  )
  return rows.length
}

function eligibleStatuses(job: BrowserImportJob): string[] {
  const statuses = ["ok", "unknown"]
  if (!job.deadPolicy || job.deadPolicy === "import") statuses.push("dead")
  return statuses
}

async function classifyChunk(
  db: Db,
  env: Env,
  job: BrowserImportJob
): Promise<number> {
  const rows = await db
    .select()
    .from(browserImportItems)
    .where(
      and(
        eq(browserImportItems.jobId, job.id),
        eq(browserImportItems.aiDone, false),
        inArray(browserImportItems.linkStatus, eligibleStatuses(job))
      )
    )
    .orderBy(asc(browserImportItems.seq))
    .limit(AI_CHUNK)
  if (rows.length === 0) return 0

  try {
    await classifyBrowserImportBatch(
      db,
      env,
      job.hasFolders ? "existing" : "new",
      rows
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "归类失败"
    await db
      .update(browserImportJobs)
      .set({ lastError: message.slice(0, 500), updatedAt: nowIso() })
      .where(eq(browserImportJobs.id, job.id))
    await db
      .update(browserImportItems)
      .set({ aiDone: true })
      .where(
        inArray(
          browserImportItems.id,
          rows.map((row) => row.id)
        )
      )
  }
  return rows.length
}

async function stampDecisions(db: Db, job: BrowserImportJob): Promise<void> {
  const importDead = job.deadPolicy === "import"
  await db
    .update(browserImportItems)
    .set({ decision: "import" })
    .where(
      and(
        eq(browserImportItems.jobId, job.id),
        eq(browserImportItems.decision, "pending"),
        inArray(browserImportItems.linkStatus, ["ok", "unknown"])
      )
    )
  await db
    .update(browserImportItems)
    .set({ decision: importDead ? "import" : "skip" })
    .where(
      and(
        eq(browserImportItems.jobId, job.id),
        eq(browserImportItems.decision, "pending"),
        eq(browserImportItems.linkStatus, "dead")
      )
    )
  await db
    .update(browserImportItems)
    .set({ decision: "skip" })
    .where(
      and(
        eq(browserImportItems.jobId, job.id),
        eq(browserImportItems.decision, "pending")
      )
    )
}

async function findOtherFolderId(
  db: Db,
  cache: BrowserFolderCache
): Promise<string | null> {
  const cached = cache.get("preset:other")
  if (cached) return cached
  const rows = await db.select().from(folders)
  const other = rows.find(
    (folder) =>
      folder.slug === "other" ||
      normalizeFolderName(folder.name) === normalizeFolderName("其他")
  )
  if (!other) return null
  cache.set("preset:other", other.id)
  return other.id
}

async function resolveFolderId(
  db: Db,
  job: BrowserImportJob,
  item: BrowserImportItem,
  cache: BrowserFolderCache
): Promise<string | null> {
  if (job.placement === "original") {
    return ensureBrowserFolderPath(db, parseNames(item.folderPathJson), cache)
  }
  if (job.placement === "existing") {
    if (item.suggestedFolderId) {
      const folder = await db
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.id, item.suggestedFolderId))
        .get()
      if (folder) return folder.id
    }
    return findOtherFolderId(db, cache)
  }
  const names = parseNames(item.suggestedFolderJson)
  if (names.length === 0) return findOtherFolderId(db, cache)
  return ensureBrowserFolderPath(db, names, cache)
}

function isUniqueConflict(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current)
    const record = current as {
      message?: unknown
      code?: unknown
      cause?: unknown
    }
    const message = typeof record.message === "string" ? record.message : ""
    const code = typeof record.code === "string" ? record.code : ""
    if (
      /SQLITE_CONSTRAINT_UNIQUE/i.test(code) ||
      /unique constraint failed/i.test(message)
    ) {
      return true
    }
    current = record.cause
  }
  return false
}

async function writeOne(
  db: Db,
  job: BrowserImportJob,
  item: BrowserImportItem,
  cache: BrowserFolderCache
): Promise<"imported" | "skipped"> {
  if (!item.canonicalUrl || !item.sourceType || !item.externalId) {
    await db
      .update(browserImportItems)
      .set({ decision: "skip" })
      .where(eq(browserImportItems.id, item.id))
    return "skipped"
  }

  const live = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.canonicalUrl, item.canonicalUrl),
        isNull(bookmarks.deletedAt)
      )
    )
    .get()
  if (live) {
    await db
      .update(browserImportItems)
      .set({ decision: "skip", bookmarkId: null })
      .where(eq(browserImportItems.id, item.id))
    return "skipped"
  }

  const canonicalUrl = item.canonicalUrl
  const sourceType = item.sourceType
  const now = nowIso()
  const healthStatus = item.linkStatus === "dead" ? "unavailable" : "unknown"

  try {
    const folderId = await resolveFolderId(db, job, item, cache)
    const same = await db
      .select()
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.sourceType, item.sourceType),
          eq(bookmarks.canonicalUrl, item.canonicalUrl)
        )
      )
      .get()

    if (same?.deletedAt) {
      await db
        .update(bookmarks)
        .set({
          title: item.title,
          folderId,
          owner: item.owner,
          externalId: item.externalId,
          aiStatus: "fallback",
          summaryAi: null,
          trackUpdates: false,
          syncStatus: "never",
          healthStatus,
          deletedAt: null,
          archivedAt: null,
          updatedAt: now,
        })
        .where(eq(bookmarks.id, same.id))
      await db
        .update(browserImportItems)
        .set({ bookmarkId: same.id, decision: "import" })
        .where(eq(browserImportItems.id, item.id))
      return "imported"
    }

    if (same && !same.deletedAt) {
      await db
        .update(browserImportItems)
        .set({ decision: "skip" })
        .where(eq(browserImportItems.id, item.id))
      return "skipped"
    }

    const id = crypto.randomUUID()
    await db.insert(bookmarks).values({
      id,
      sourceType: item.sourceType,
      canonicalUrl: item.canonicalUrl,
      externalId: item.externalId,
      owner: item.owner,
      title: item.title,
      stars: 0,
      forks: 0,
      topicsJson: "[]",
      platformMetaJson: "{}",
      folderId,
      siteName:
        item.sourceType === "url" ? hostnameOf(item.canonicalUrl) : null,
      aiStatus: "fallback",
      summaryAi: null,
      trackUpdates: false,
      syncStatus: "never",
      healthStatus,
      createdAt: now,
      updatedAt: now,
    })
    await db
      .update(browserImportItems)
      .set({ bookmarkId: id, decision: "import" })
      .where(eq(browserImportItems.id, item.id))
    return "imported"
  } catch (error) {
    if (isUniqueConflict(error)) {
      const winner = await db
        .select({ id: bookmarks.id, deletedAt: bookmarks.deletedAt })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.sourceType, sourceType),
            eq(bookmarks.canonicalUrl, canonicalUrl)
          )
        )
        .get()
      if (winner && !winner.deletedAt) {
        await db
          .update(browserImportItems)
          .set({ decision: "skip", bookmarkId: null })
          .where(eq(browserImportItems.id, item.id))
        return "skipped"
      }
    }
    const message = error instanceof Error ? error.message : "写入收藏失败"
    throw new BrowserImportWriteError(message)
  }
}

async function syncWriteCounts(
  db: Db,
  jobId: string,
  failedDelta: number
): Promise<void> {
  const row = await db
    .select({
      imported: sql<number>`sum(case when ${browserImportItems.bookmarkId} is not null then 1 else 0 end)`,
      skipped: sql<number>`sum(case when ${browserImportItems.decision} = 'skip' then 1 else 0 end)`,
    })
    .from(browserImportItems)
    .where(eq(browserImportItems.jobId, jobId))
    .get()
  const imported = Number(row?.imported ?? 0)
  const skipped = Number(row?.skipped ?? 0)
  await db
    .update(browserImportJobs)
    .set({
      imported,
      skipped,
      processed: imported + skipped,
      failedCount: sql`${browserImportJobs.failedCount} + ${failedDelta}`,
      leaseUntil: leaseUntilIso(),
      updatedAt: nowIso(),
    })
    .where(eq(browserImportJobs.id, jobId))
}

async function importChunk(
  db: Db,
  job: BrowserImportJob,
  cache: BrowserFolderCache
): Promise<number> {
  await stampDecisions(db, job)
  const rows = await db
    .select()
    .from(browserImportItems)
    .where(
      and(
        eq(browserImportItems.jobId, job.id),
        eq(browserImportItems.decision, "import"),
        isNull(browserImportItems.bookmarkId)
      )
    )
    .orderBy(asc(browserImportItems.seq))
    .limit(WRITE_CHUNK)
  if (rows.length === 0) return 0

  for (const row of rows) {
    await writeOne(db, job, row, cache)
  }
  await syncWriteCounts(db, job.id, 0)
  await db
    .update(browserImportJobs)
    .set({ currentTitle: rows[0]?.title ?? null })
    .where(eq(browserImportJobs.id, job.id))
  return rows.length
}

type SliceResult = "done" | "continue" | "failed"

async function processSlice(
  db: Db,
  env: Env,
  jobId: string,
  opts?: RunBrowserImportOpts
): Promise<SliceResult> {
  const job = opts?.renew
    ? await renewLease(db, jobId)
    : await claimJob(db, jobId)
  if (!job) return "done"

  const deadline = Date.now() + (opts?.budgetMs ?? IMPORT_JOB_TIME_BUDGET_MS)
  const cache: BrowserFolderCache = new Map()

  try {
    while (Date.now() < deadline) {
      const current = await loadJob(db, jobId)
      if (!current) return "done"
      if (!RESUMABLE.includes(current.status as (typeof RESUMABLE)[number])) {
        return "done"
      }

      if (current.status === "probing") {
        const normalized = await normalizeChunk(db, jobId)
        const probed = await probeChunk(db, jobId)
        const sample = await db
          .select({ title: browserImportItems.title })
          .from(browserImportItems)
          .where(eq(browserImportItems.jobId, jobId))
          .orderBy(asc(browserImportItems.seq))
          .limit(1)
          .get()
        await touchProgress(db, jobId, sample?.title ?? null)
        if (normalized === 0 && probed === 0) {
          const fresh = await loadJob(db, jobId)
          if (fresh && !fresh.hasFolders && !fresh.classified) {
            const key = await getDeepSeekKey(db, env)
            if (key) {
              await db
                .update(browserImportJobs)
                .set({
                  status: "classifying",
                  leaseUntil: leaseUntilIso(),
                  updatedAt: nowIso(),
                })
                .where(
                  and(
                    eq(browserImportJobs.id, jobId),
                    eq(browserImportJobs.status, "probing")
                  )
                )
              continue
            }
          }
          await enterAwaiting(db, jobId, fresh?.classified ?? false)
          return "done"
        }
        continue
      }

      if (current.status === "classifying") {
        const key = await getDeepSeekKey(db, env)
        if (!key) {
          await db
            .update(browserImportJobs)
            .set({
              lastError: "还没有配置 DeepSeek，可以改按原目录导入",
              updatedAt: nowIso(),
            })
            .where(eq(browserImportJobs.id, jobId))
          await enterAwaiting(db, jobId, false)
          return "done"
        }
        const classified = await classifyChunk(db, env, current)
        if (classified === 0) {
          await enterAwaiting(db, jobId, true)
          return "done"
        }
        continue
      }

      if (current.status === "importing") {
        const written = await importChunk(db, current, cache)
        if (written === 0) {
          await markCompleted(db, jobId)
          return "done"
        }
        continue
      }
    }
    return "continue"
  } catch (error) {
    if (error instanceof BrowserImportWriteError) {
      await db
        .update(browserImportJobs)
        .set({
          lastError: error.message.slice(0, 500),
          updatedAt: nowIso(),
        })
        .where(
          and(
            eq(browserImportJobs.id, jobId),
            inArray(browserImportJobs.status, [...RESUMABLE])
          )
        )
      return "done"
    }
    const message = error instanceof Error ? error.message : "导入失败"
    await markFailed(db, jobId, message)
    return "failed"
  }
}

async function scheduleContinue(
  env: Env,
  jobId: string,
  continueToken: string,
  ctx: WaitUntilContext,
  continueBaseUrl?: string
): Promise<void> {
  const nested = () =>
    ctx.waitUntil(
      runBrowserImportJob(env, jobId, ctx, { renew: true, continueBaseUrl })
    )

  if (!continueBaseUrl) {
    nested()
    return
  }

  const url = `${continueBaseUrl.replace(/\/$/, "")}/api/bookmarks/import/browser/jobs/${jobId}/continue`
  ctx.waitUntil(
    (async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Import-Continue-Token": continueToken,
          },
          body: JSON.stringify({ token: continueToken }),
        })
        if (!response.ok) nested()
      } catch {
        nested()
      }
    })()
  )
}

export async function runBrowserImportJob(
  env: Env,
  jobId: string,
  ctx: WaitUntilContext,
  opts?: RunBrowserImportOpts
): Promise<void> {
  const db = createDb(env)
  const outcome = await processSlice(db, env, jobId, opts)
  if (outcome !== "continue") return
  const job = await db
    .select({ continueToken: browserImportJobs.continueToken })
    .from(browserImportJobs)
    .where(eq(browserImportJobs.id, jobId))
    .get()
  if (!job) return
  await scheduleContinue(
    env,
    jobId,
    job.continueToken,
    ctx,
    opts?.continueBaseUrl
  )
}

export async function continueStaleBrowserImportJobs(
  env: Env,
  ctx?: WaitUntilContext
): Promise<{ resumed: number }> {
  const db = createDb(env)
  const now = nowIso()
  const stale = await db
    .select({ id: browserImportJobs.id })
    .from(browserImportJobs)
    .where(
      and(
        inArray(browserImportJobs.status, [...RESUMABLE]),
        or(
          isNull(browserImportJobs.leaseUntil),
          lt(browserImportJobs.leaseUntil, now)
        )
      )
    )
    .limit(1)
  const jobId = stale[0]?.id
  if (!jobId) return { resumed: 0 }

  const execCtx: WaitUntilContext = ctx ?? {
    waitUntil(promise: Promise<unknown>) {
      void promise
    },
  }
  const baseUrl = env.APP_URL
  if (ctx) {
    ctx.waitUntil(
      runBrowserImportJob(env, jobId, execCtx, { continueBaseUrl: baseUrl })
    )
  } else {
    await runBrowserImportJob(env, jobId, execCtx, { continueBaseUrl: baseUrl })
  }
  return { resumed: 1 }
}
