/**
 * 后台脚本源文件。运行时加载的是 esbuild 打出来的 background.js。
 * 匹配规则从共享包和 parseGithubRepoInput 打进来，不要在这里手抄一份。
 */
/// <reference types="chrome" />

import { canonicalizeUrl } from "../../../packages/shared/src/canonicalize-url.ts"
import { detectSourceType } from "../../../packages/shared/src/detect-source.ts"
import { parseTwitterStatusInput } from "../../../packages/shared/src/twitter-url.ts"
import { parseGithubRepoInput } from "../../web/src/worker/lib/github-url.ts"

const INSTANCE_KEY = "instanceUrl"
const INDEX_KEY = "bookmarkMatchIndex"
const ALARM = "match-index"

const ICON_PLAIN = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
}

const ICON_SAVED = {
  16: "icons/icon-saved-16.png",
  32: "icons/icon-saved-32.png",
  48: "icons/icon-saved-48.png",
  128: "icons/icon-saved-128.png",
}

type MatchItem = {
  id: string
  source_type: string
  canonical_url: string
  external_id: string
  archived: boolean
}

type StoredIndex = {
  origin: string
  revision: number
  items: MatchItem[]
}

type MatchState = {
  origin: string | null
  url: string
  match: {
    id: string
    source_type: string
    archived: boolean
    canonical_url: string
  } | null
}

let stored: StoredIndex | null = null
let byGithub = new Map<string, MatchItem>()
let byTweet = new Map<string, MatchItem>()
let byUrl = new Map<string, MatchItem>()

function indexItems(items: MatchItem[]) {
  byGithub = new Map()
  byTweet = new Map()
  byUrl = new Map()
  for (const item of items) {
    if (item.source_type === "github") byGithub.set(item.canonical_url, item)
    else if (item.source_type === "twitter") byTweet.set(item.external_id, item)
    else if (item.source_type === "url") byUrl.set(item.canonical_url, item)
  }
}

function matchUrl(raw: string): MatchItem | null {
  const detected = detectSourceType(raw)
  if (!detected.ok) return null
  if (detected.sourceType === "github") {
    const parsed = parseGithubRepoInput(raw)
    return parsed ? (byGithub.get(parsed.canonicalUrl) ?? null) : null
  }
  if (detected.sourceType === "twitter") {
    const parsed = parseTwitterStatusInput(raw)
    return parsed.ok ? (byTweet.get(parsed.data.tweetId) ?? null) : null
  }
  if (detected.sourceType === "url") {
    const canonical = canonicalizeUrl(raw)
    return canonical.ok ? (byUrl.get(canonical.canonicalUrl) ?? null) : null
  }
  return null
}

async function readOrigin(): Promise<string | null> {
  const data = await chrome.storage.sync.get(INSTANCE_KEY)
  const value = data[INSTANCE_KEY]
  return typeof value === "string" && value ? value : null
}

async function loadIndexFromStorage() {
  const origin = await readOrigin()
  const data = await chrome.storage.local.get(INDEX_KEY)
  const saved = data[INDEX_KEY] as StoredIndex | undefined
  if (
    !saved ||
    !origin ||
    saved.origin !== origin ||
    !Array.isArray(saved.items)
  ) {
    stored = null
    indexItems([])
    return
  }
  stored = saved
  indexItems(saved.items)
}

async function paintTab(tabId: number, url: string | undefined) {
  const saved = Boolean(url && /^https?:/i.test(url) && matchUrl(url))
  await chrome.action.setIcon({
    tabId,
    path: saved ? ICON_SAVED : ICON_PLAIN,
  })
  // 清掉旧版本留在这个标签上的 ★ 角标
  await chrome.action.setBadgeText({ tabId, text: "" })
}

async function paintAllTabs() {
  const tabs = await chrome.tabs.query({})
  await Promise.all(
    tabs.map((tab) =>
      tab.id == null ? Promise.resolve() : paintTab(tab.id, tab.url)
    )
  )
}

async function clearAllBadges() {
  const tabs = await chrome.tabs.query({})
  await Promise.all(
    tabs.map((tab) => {
      if (tab.id == null) return Promise.resolve()
      return Promise.all([
        chrome.action.setBadgeText({ tabId: tab.id, text: "" }),
        chrome.action.setIcon({ tabId: tab.id, path: ICON_PLAIN }),
      ])
    })
  )
}

async function dropIndex() {
  stored = null
  indexItems([])
  await chrome.storage.local.remove(INDEX_KEY)
  await clearAllBadges()
}

async function refresh() {
  const origin = await readOrigin()
  if (!origin) return
  const permitted = await chrome.permissions.contains({
    origins: [`${origin}/*`],
  })
  if (!permitted) return

  if (stored && stored.origin !== origin) await dropIndex()

  const headers: Record<string, string> = {}
  if (stored && stored.origin === origin) {
    headers["If-None-Match"] = `"${stored.revision}"`
  }

  let response: Response
  try {
    response = await fetch(`${origin}/api/bookmarks/match-index`, {
      credentials: "include",
      headers,
    })
  } catch {
    return
  }

  if (response.status === 401) {
    await dropIndex()
    return
  }
  if (response.status === 304 || !response.ok) return

  const body = (await response.json()) as {
    revision?: number
    items?: MatchItem[]
  }
  if (typeof body.revision !== "number" || !Array.isArray(body.items)) return
  stored = { origin, revision: body.revision, items: body.items }
  indexItems(body.items)
  await chrome.storage.local.set({ [INDEX_KEY]: stored })
  await paintAllTabs()
}

async function currentState(): Promise<MatchState> {
  const origin = await readOrigin()
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url && /^https?:/i.test(tab.url) ? tab.url : ""
  const hit = url ? matchUrl(url) : null
  return {
    origin,
    url,
    match: hit
      ? {
          id: hit.id,
          source_type: hit.source_type,
          archived: hit.archived,
          canonical_url: hit.canonical_url,
        }
      : null,
  }
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM)
  if (!existing) {
    await chrome.alarms.create(ALARM, { periodInMinutes: 30 })
  }
}

let booted: Promise<void> | null = null
function boot() {
  if (!booted) {
    booted = (async () => {
      await loadIndexFromStorage()
      await ensureAlarm()
      await paintAllTabs()
    })()
  }
  return booted
}

chrome.runtime.onInstalled.addListener(() => {
  void boot().then(() => refresh())
})

chrome.runtime.onStartup.addListener(() => {
  void boot().then(() => refresh())
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void boot().then(() => refresh())
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return
  const url = changeInfo.url ?? tab.url
  void boot().then(() => paintTab(tabId, url))
})

chrome.tabs.onActivated.addListener((info) => {
  void boot().then(async () => {
    const tab = await chrome.tabs.get(info.tabId)
    await paintTab(info.tabId, tab.url)
  })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message && typeof message === "object" ? message.type : ""
  if (type === "getState" || type === "refreshAndGetState") {
    void (async () => {
      await boot()
      if (type === "refreshAndGetState") await refresh()
      sendResponse(await currentState())
    })()
    return true
  }
  if (
    type === "importBookmarksStart" ||
    type === "importBookmarksBatch" ||
    type === "importBookmarksFinish"
  ) {
    void handleBookmarkImport(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "导入失败",
        })
      })
    return true
  }
  return
})

type ImportItem = { title: string; url: string; folderPath: string[] }

async function readOriginOrThrow(): Promise<string> {
  const origin = await readOrigin()
  if (!origin) throw new Error("请先填写实例地址")
  const permitted = await chrome.permissions.contains({ origins: [`${origin}/*`] })
  if (!permitted) throw new Error("还没有授权这个实例")
  return origin
}

async function postImport(origin: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: { error?: string; job?: { id?: string } } = {}
  if (text) {
    try {
      parsed = JSON.parse(text) as { error?: string; job?: { id?: string } }
    } catch {
      parsed = {}
    }
  }
  if (!response.ok) {
    throw new Error(parsed.error || text.slice(0, 180) || `HTTP ${response.status}`)
  }
  return parsed
}

async function handleBookmarkImport(message: {
  type?: string
  jobId?: string
  batchIndex?: number
  items?: ImportItem[]
}): Promise<{ ok: true; jobId?: string }> {
  const origin = await readOriginOrThrow()
  if (message.type === "importBookmarksStart") {
    const body = (await postImport(origin, "/api/bookmarks/import/browser", {
      source: "extension",
    })) as { job?: { id?: string } }
    const jobId = body.job?.id
    if (!jobId) throw new Error("没有拿到导入任务")
    return { ok: true, jobId }
  }
  if (message.type === "importBookmarksBatch") {
    if (!message.jobId) throw new Error("缺少导入任务")
    await postImport(origin, `/api/bookmarks/import/browser/jobs/${message.jobId}/batches`, {
      batchIndex: message.batchIndex ?? 0,
      items: Array.isArray(message.items) ? message.items : [],
    })
    return { ok: true, jobId: message.jobId }
  }
  if (!message.jobId) throw new Error("缺少导入任务")
  await postImport(origin, `/api/bookmarks/import/browser/jobs/${message.jobId}/scan`, {})
  await chrome.tabs.create({ url: `${origin}/import` })
  return { ok: true, jobId: message.jobId }
}

void boot()
