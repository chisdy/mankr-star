/**
 * 弹窗：授权实例、展示当前页是否已收藏，未收藏时跳到 `?add=`。
 * 匹配结果来自后台的本地身份表。打开弹窗会做一次版本检查。
 */
const STORAGE_KEY = "instanceUrl"

const instanceInput = document.getElementById("instance")
const submitButton = document.getElementById("submit")
const importButton = document.getElementById("import-bookmarks")
const currentLabel = document.getElementById("current")
const statusLabel = document.getElementById("status")
const titleLabel = document.getElementById("title")

let currentUrl = ""
let view = { origin: null, url: "", match: null }
let permitted = false

function normalizeInstance(raw) {
  const value = raw.trim()
  if (!value) return null
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.origin
  } catch {
    return null
  }
}

function sourceLabel(sourceType) {
  if (sourceType === "github") return "GitHub"
  if (sourceType === "twitter") return "X"
  return "网页"
}

function refreshEnabled() {
  submitButton.disabled = !currentUrl || !normalizeInstance(instanceInput.value)
}

function render() {
  const origin = normalizeInstance(instanceInput.value)
  const match = view.match
  const ready = Boolean(origin && permitted && view.origin === origin)
  importButton.hidden = typeof chrome.permissions?.request !== "function"
  importButton.disabled = !origin
  titleLabel.textContent = ready && match ? titleLabel.textContent : ""
  if (!ready) {
    statusLabel.textContent = ""
    submitButton.textContent = "授权并开始识别"
    return
  }
  if (match) {
    statusLabel.textContent = match.archived
      ? `已收藏 · ${sourceLabel(match.source_type)} · 已归档`
      : `已收藏 · ${sourceLabel(match.source_type)}`
    submitButton.textContent = "打开收藏"
    return
  }
  statusLabel.textContent = "尚未收藏"
  submitButton.textContent = "在 Mankr Star 中添加"
}

async function syncPermission() {
  const origin = normalizeInstance(instanceInput.value)
  permitted = origin
    ? await chrome.permissions.contains({ origins: [`${origin}/*`] })
    : false
}

async function loadTitle(origin, id) {
  try {
    const res = await fetch(`${origin}/api/bookmarks/${id}`, {
      credentials: "include",
    })
    if (!res.ok) return
    const body = await res.json()
    if (view.match && view.match.id === id && body.title) {
      titleLabel.textContent = body.title
    }
  } catch {
    // 标题拿不到时仍可打开收藏
  }
}

async function refreshView() {
  titleLabel.textContent = ""
  const next = await chrome.runtime.sendMessage({ type: "refreshAndGetState" })
  if (next) view = next
  if (view.origin && document.activeElement !== instanceInput) {
    instanceInput.value = view.origin
  }
  await syncPermission()
  render()
  const origin = normalizeInstance(instanceInput.value)
  if (permitted && view.match && origin && view.origin === origin) {
    void loadTitle(origin, view.match.id)
  }
}

async function init() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY)
  if (stored[STORAGE_KEY]) instanceInput.value = stored[STORAGE_KEY]

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.url && /^https?:/i.test(tab.url)) {
    currentUrl = tab.url
    currentLabel.textContent = tab.url
  } else {
    currentLabel.textContent = "当前标签页不是网页，无法收藏。"
  }

  refreshEnabled()
  try {
    await refreshView()
  } catch {
    render()
  }
}

instanceInput.addEventListener("input", () => {
  refreshEnabled()
  void syncPermission().then(render)
})

submitButton.addEventListener("click", async () => {
  const origin = normalizeInstance(instanceInput.value)
  if (!origin || !currentUrl) return

  const already = await chrome.permissions.contains({ origins: [`${origin}/*`] })
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) return

  await chrome.storage.sync.set({ [STORAGE_KEY]: origin })
  try {
    await refreshView()
  } catch {
    // 版本检查失败时仍按当前已知结果继续
  }

  // 第一次只完成授权和版本检查，留下弹窗让人看到是否已收藏。
  if (!already) return

  const match = view.match && view.origin === origin ? view.match : null
  const url = match
    ? `${origin}/?bookmark=${encodeURIComponent(match.id)}`
    : `${origin}/?add=${encodeURIComponent(currentUrl)}`
  await chrome.tabs.create({ url })
  window.close()
})

function flattenBookmarks(nodes, path, out) {
  for (const node of nodes || []) {
    const title = typeof node.title === "string" ? node.title.trim() : ""
    if (node.url) {
      if (/^https?:\/\//i.test(node.url)) {
        out.push({ title: title || node.url, url: node.url, folderPath: path })
      }
      continue
    }
    if (node.children) {
      flattenBookmarks(node.children, title ? path.concat(title) : path, out)
    }
  }
}

function dedupeBookmarks(items) {
  const seen = new Set()
  const kept = []
  for (const item of items) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    kept.push(item)
  }
  return kept
}

importButton.addEventListener("click", async () => {
  const origin = normalizeInstance(instanceInput.value)
  if (!origin) return

  const grantedHost = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!grantedHost) return
  await chrome.storage.sync.set({ [STORAGE_KEY]: origin })

  const grantedBookmarks = await chrome.permissions.request({ permissions: ["bookmarks"] })
  if (!grantedBookmarks) return
  if (!chrome.bookmarks?.getTree) {
    statusLabel.textContent = "这个浏览器不能直接读取书签，请在网页上导入 HTML。"
    return
  }

  importButton.disabled = true
  statusLabel.textContent = "正在读取书签…"
  try {
    const tree = await chrome.bookmarks.getTree()
    const flat = []
    flattenBookmarks(tree, [], flat)
    const items = dedupeBookmarks(flat)
    if (items.length === 0) {
      statusLabel.textContent = "没有可导入的网页书签。"
      importButton.disabled = false
      return
    }

    statusLabel.textContent = "正在上传…"
    const started = await chrome.runtime.sendMessage({ type: "importBookmarksStart" })
    if (!started?.ok) {
      statusLabel.textContent = started?.error || "上传失败"
      importButton.disabled = false
      return
    }

    const size = 200
    for (let index = 0; index < items.length; index += size) {
      const batch = await chrome.runtime.sendMessage({
        type: "importBookmarksBatch",
        jobId: started.jobId,
        batchIndex: index / size,
        items: items.slice(index, index + size),
      })
      if (!batch?.ok) {
        statusLabel.textContent = batch?.error || "上传失败"
        importButton.disabled = false
        return
      }
      statusLabel.textContent = `正在上传 ${Math.min(items.length, index + size)} / ${items.length}`
    }

    const finished = await chrome.runtime.sendMessage({
      type: "importBookmarksFinish",
      jobId: started.jobId,
    })
    if (!finished?.ok) {
      statusLabel.textContent = finished?.error || "检查失败"
      importButton.disabled = false
      return
    }
    window.close()
  } catch (error) {
    statusLabel.textContent = error instanceof Error ? error.message : "导入失败"
    importButton.disabled = false
  }
})

void init()
