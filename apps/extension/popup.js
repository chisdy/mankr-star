/**
 * 弹窗只做一件事：把当前标签页地址交给 Web 应用的 `?add=` 入口。
 *
 * 不直接调 `/api/bookmarks`：那需要把会话 Cookie 带出扩展沙箱，
 * 要么给扩展发长期令牌，要么申请跨站 Cookie 权限，两条路都比这条重。
 */
const STORAGE_KEY = "instanceUrl"

const instanceInput = document.getElementById("instance")
const submitButton = document.getElementById("submit")
const currentLabel = document.getElementById("current")

let currentUrl = ""

function normalizeInstance(raw) {
  const value = raw.trim()
  if (!value) return null
  try {
    // 允许只填域名；末尾斜杠交给 URL 归一化
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.origin
  } catch {
    return null
  }
}

function refreshEnabled() {
  submitButton.disabled = !currentUrl || !normalizeInstance(instanceInput.value)
}

async function init() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY)
  if (stored[STORAGE_KEY]) instanceInput.value = stored[STORAGE_KEY]

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  // 内部页（chrome://、扩展页）没有可收藏的地址
  if (tab?.url && /^https?:/i.test(tab.url)) {
    currentUrl = tab.url
    currentLabel.textContent = tab.url
  } else {
    currentLabel.textContent = "当前标签页不是网页，无法收藏。"
  }

  refreshEnabled()
}

instanceInput.addEventListener("input", refreshEnabled)

submitButton.addEventListener("click", async () => {
  const origin = normalizeInstance(instanceInput.value)
  if (!origin || !currentUrl) return

  await chrome.storage.sync.set({ [STORAGE_KEY]: origin })
  await chrome.tabs.create({
    url: `${origin}/?add=${encodeURIComponent(currentUrl)}`,
  })
  window.close()
})

void init()
