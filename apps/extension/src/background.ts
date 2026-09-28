/**
 * 后台脚本源文件。运行时加载的是 esbuild 打出来的 background.js。
 * 匹配规则从共享包和 parseGithubRepoInput 打进来，不要在这里手抄一份。
 */
import { canonicalizeUrl } from "../../../packages/shared/src/canonicalize-url.ts"
import { detectSourceType } from "../../../packages/shared/src/detect-source.ts"
import { parseTwitterStatusInput } from "../../../packages/shared/src/twitter-url.ts"
import { parseGithubRepoInput } from "../../web/src/worker/lib/github-url.ts"

const INSTANCE_KEY = "instanceUrl"
const INDEX_KEY = "bookmarkMatchIndex"
const ALARM = "match-index"

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
  if (!url || !/^https?:/i.test(url)) {
    await chrome.action.setBadgeText({ tabId, text: "" })
    return
  }
  const hit = matchUrl(url)
  if (!hit) {
    await chrome.action.setBadgeText({ tabId, text: "" })
    return
  }
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d97706" })
  await chrome.action.setBadgeText({ tabId, text: "★" })
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
    tabs.map((tab) =>
      tab.id == null
        ? Promise.resolve()
        : chrome.action.setBadgeText({ tabId: tab.id, text: "" })
    )
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
  if (type !== "getState" && type !== "refreshAndGetState") return
  void (async () => {
    await boot()
    if (type === "refreshAndGetState") await refresh()
    sendResponse(await currentState())
  })()
  return true
})

void boot()
