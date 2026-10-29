/**
 * Mankr Star 浏览器扩展弹窗逻辑
 * 强类型状态机、精美卡片渲染、视图平滑切换与后台通信
 */
import "./popup.css"
import { savedStatusText } from "../source-label.ts"

const STORAGE_KEY = "instanceUrl"

interface MatchItem {
  id: string
  source_type: string
  canonical_url: string
  archived: boolean
}

interface MatchState {
  origin: string | null
  url: string
  match: MatchItem | null
}

interface FlatBookmark {
  title: string
  url: string
  folderPath: string[]
}

// DOM 元素引用
const viewMain = document.getElementById("view-main") as HTMLElement
const viewSettings = document.getElementById("view-settings") as HTMLElement

const btnOpenSettings = document.getElementById(
  "btn-open-settings"
) as HTMLButtonElement
const btnBack = document.getElementById("btn-back") as HTMLButtonElement
const connDot = document.getElementById("conn-dot") as HTMLElement

const siteFavicon = document.getElementById("site-favicon") as HTMLImageElement
const siteFaviconFallback = document.getElementById(
  "site-favicon-fallback"
) as HTMLElement
const siteDomain = document.getElementById("site-domain") as HTMLElement
const statusPill = document.getElementById("status-pill") as HTMLElement
const statusPillText = document.getElementById(
  "status-pill-text"
) as HTMLElement

const pageTitle = document.getElementById("page-title") as HTMLElement
const pageUrl = document.getElementById("page-url") as HTMLElement
const btnAction = document.getElementById("btn-action") as HTMLButtonElement
const btnActionIcon = document.getElementById("btn-action-icon") as HTMLElement
const btnActionText = document.getElementById("btn-action-text") as HTMLElement

const instanceInput = document.getElementById("instance") as HTMLInputElement
const btnSaveInstance = document.getElementById(
  "btn-save-instance"
) as HTMLButtonElement
const instanceFeedback = document.getElementById(
  "instance-feedback"
) as HTMLElement

const btnImportBookmarks = document.getElementById(
  "btn-import-bookmarks"
) as HTMLButtonElement
const importProgressContainer = document.getElementById(
  "import-progress-container"
) as HTMLElement
const importProgressBar = document.getElementById(
  "import-progress-bar"
) as HTMLElement
const importStatus = document.getElementById("import-status") as HTMLElement

// 图标模版
const ICON_PLUS = `
<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 12h14"/>
  <path d="M12 5v14"/>
</svg>`

const ICON_EXTERNAL = `
<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M15 3h6v6"/>
  <path d="M10 14 21 3"/>
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
</svg>`

const ICON_SETTINGS = `
<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`

// 状态管理
let currentTab: chrome.tabs.Tab | null = null
let currentUrl = ""
let viewState: MatchState = { origin: null, url: "", match: null }
let isPermitted = false

/** 规范化实例 URL 字符串为 origin */
function normalizeInstance(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  try {
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`
    )
    return url.origin
  } catch {
    return null
  }
}

/** 切换界面面板 */
function switchView(target: "main" | "settings") {
  if (target === "settings") {
    viewMain.classList.remove("active")
    viewSettings.classList.add("active")
    instanceFeedback.textContent = ""
    instanceFeedback.className = "feedback-msg"
    instanceInput.focus()
  } else {
    viewSettings.classList.remove("active")
    viewMain.classList.add("active")
  }
}

/** 检查是否已拥有指定 origin 的权限 */
async function syncPermission(): Promise<boolean> {
  const origin = normalizeInstance(instanceInput.value)
  if (!origin) {
    isPermitted = false
    connDot.classList.remove("online")
    return false
  }
  try {
    isPermitted = await chrome.permissions.contains({
      origins: [`${origin}/*`],
    })
  } catch {
    isPermitted = false
  }
  if (isPermitted) {
    connDot.classList.add("online")
  } else {
    connDot.classList.remove("online")
  }
  return isPermitted
}

/** 更新主卡片与操作按钮界面 */
function renderMain() {
  const isHttp = currentUrl && /^https?:/i.test(currentUrl)

  // 处理 Favicon 与域名展示
  if (
    currentTab?.favIconUrl &&
    isHttp &&
    !currentTab.favIconUrl.startsWith("chrome://")
  ) {
    siteFavicon.src = currentTab.favIconUrl
    siteFavicon.onload = () => {
      siteFavicon.style.display = "block"
      siteFaviconFallback.style.display = "none"
    }
    siteFavicon.onerror = () => {
      siteFavicon.style.display = "none"
      siteFaviconFallback.style.display = "flex"
    }
  } else {
    siteFavicon.style.display = "none"
    siteFaviconFallback.style.display = "flex"
  }

  let domain = ""
  if (isHttp) {
    try {
      domain = new URL(currentUrl).hostname
    } catch {
      domain = "网页"
    }
  } else {
    domain = "受限协议"
  }
  siteDomain.textContent = domain

  // 标题与 URL 展示
  const initialTitle = currentTab?.title?.trim() || domain
  pageTitle.textContent = initialTitle
  pageUrl.textContent = currentUrl || "无可用链接"
  pageUrl.title = currentUrl

  const origin = normalizeInstance(instanceInput.value)
  const isConfiguredAndReady = Boolean(
    origin && isPermitted && viewState.origin === origin
  )

  // 情况 1: 系统受限页面 (chrome://, edge://, about:, file:)
  if (!isHttp) {
    statusPill.className = "status-pill alert"
    statusPillText.textContent = "系统页面"
    btnAction.disabled = true
    btnActionIcon.innerHTML = ICON_PLUS
    btnActionText.textContent = "无法在当前页面添加"
    return
  }

  // 情况 2: 未配置实例或尚未授权
  if (!isConfiguredAndReady) {
    statusPill.className = "status-pill"
    statusPillText.textContent = "未配置"
    btnAction.disabled = false
    btnActionIcon.innerHTML = ICON_SETTINGS
    btnActionText.textContent = "配置实例并授权"
    return
  }

  // 情况 3: 已在 Mankr Star 中匹配到收藏
  const match = viewState.match
  if (match) {
    statusPill.className = "status-pill saved"
    statusPillText.textContent = savedStatusText(match)
    btnAction.disabled = false
    btnActionIcon.innerHTML = ICON_EXTERNAL
    btnActionText.textContent = "在 Mankr Star 中打开"
    return
  }

  // 情况 4: 尚未收藏，可以一键添加
  statusPill.className = "status-pill"
  statusPillText.textContent = "未收藏"
  btnAction.disabled = false
  btnActionIcon.innerHTML = ICON_PLUS
  btnActionText.textContent = "添加至 Mankr Star"
}

/** 异步加载已收藏网页的详细标题 */
async function loadMatchedTitle(origin: string, id: string) {
  try {
    const res = await fetch(`${origin}/api/bookmarks/${id}`, {
      credentials: "include",
    })
    if (!res.ok) return
    const body = (await res.json()) as { title?: string }
    if (viewState.match && viewState.match.id === id && body.title) {
      pageTitle.textContent = body.title
    }
  } catch {
    // 标题加载失败时保持 tab.title
  }
}

/** 向后台查询最新比对状态并更新视图 */
async function refreshState() {
  try {
    const next = (await chrome.runtime.sendMessage({
      type: "refreshAndGetState",
    })) as MatchState | undefined
    if (next) viewState = next
    if (viewState.origin && document.activeElement !== instanceInput) {
      instanceInput.value = viewState.origin
    }
  } catch {
    // 离线或通信失败时沿用缓存状态
  }

  await syncPermission()
  renderMain()

  const origin = normalizeInstance(instanceInput.value)
  if (isPermitted && viewState.match && origin && viewState.origin === origin) {
    void loadMatchedTitle(origin, viewState.match.id)
  }
}

/** 扁平化 Chrome 书签树 */
function flattenBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[] | undefined,
  path: string[],
  out: FlatBookmark[]
) {
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

/** 书签 URL 去重 */
function dedupeBookmarks(items: FlatBookmark[]): FlatBookmark[] {
  const seen = new Set<string>()
  const kept: FlatBookmark[] = []
  for (const item of items) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    kept.push(item)
  }
  return kept
}

/** 初始化弹窗 */
async function init() {
  // 读取已保存的实例地址
  const stored = await chrome.storage.sync.get(STORAGE_KEY)
  const savedOrigin = stored[STORAGE_KEY] as string | undefined
  if (savedOrigin) {
    instanceInput.value = savedOrigin
  }

  // 读取当前激活的标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  currentTab = tab || null
  currentUrl = tab?.url || ""

  await syncPermission()

  // 若尚未配置任何实例，主动引导进入设置视图
  if (!savedOrigin || !isPermitted) {
    switchView("settings")
    instanceFeedback.textContent =
      "请填写并授权您的 Mankr Star 部署地址以开启识别。"
    instanceFeedback.className = "feedback-msg"
  } else {
    switchView("main")
  }

  renderMain()

  // 触发后台索引同步核对
  try {
    await refreshState()
  } catch {
    renderMain()
  }
}

// -----------------------------------------------------------------------------
// 事件绑定
// -----------------------------------------------------------------------------

btnOpenSettings.addEventListener("click", () => {
  switchView("settings")
})

btnBack.addEventListener("click", () => {
  switchView("main")
  renderMain()
})

instanceInput.addEventListener("input", () => {
  const trimmed = instanceInput.value.trim()
  if (trimmed) {
    const origin = normalizeInstance(trimmed)
    if (origin && instanceFeedback.classList.contains("error")) {
      instanceFeedback.textContent = ""
      instanceFeedback.className = "feedback-msg"
    }
  }
  void syncPermission().then(renderMain)
})

instanceInput.addEventListener("blur", () => {
  const origin = normalizeInstance(instanceInput.value)
  if (origin) {
    instanceInput.value = origin
  } else if (!instanceInput.value.trim()) {
    instanceInput.value = ""
  }
})

// 主操作按钮点击
btnAction.addEventListener("click", async () => {
  const origin = normalizeInstance(instanceInput.value)
  const isConfiguredAndReady = Boolean(origin && isPermitted)

  // 如果未配置或未授权，跳转至设置页面
  if (!isConfiguredAndReady) {
    switchView("settings")
    return
  }

  if (!origin || !currentUrl) return

  const match =
    viewState.match && viewState.origin === origin ? viewState.match : null
  const targetUrl = match
    ? `${origin}/?bookmark=${encodeURIComponent(match.id)}`
    : `${origin}/?add=${encodeURIComponent(currentUrl)}`

  await chrome.tabs.create({ url: targetUrl })
  window.close()
})

// 保存并授权实例按钮
btnSaveInstance.addEventListener("click", async () => {
  const origin = normalizeInstance(instanceInput.value)
  if (!origin) {
    instanceFeedback.textContent =
      "请输入合法的 URL 格式（如 https://star.example.com）。"
    instanceFeedback.className = "feedback-msg error"
    return
  }
  instanceInput.value = origin

  btnSaveInstance.disabled = true
  instanceFeedback.textContent = "正在发起浏览器权限授权…"
  instanceFeedback.className = "feedback-msg"

  try {
    const granted = await chrome.permissions.request({
      origins: [`${origin}/*`],
    })
    if (!granted) {
      instanceFeedback.textContent =
        "未授予该站点的访问权限，无法同步收藏状态。"
      instanceFeedback.className = "feedback-msg error"
      btnSaveInstance.disabled = false
      return
    }

    await chrome.storage.sync.set({ [STORAGE_KEY]: origin })
    await syncPermission()

    instanceFeedback.textContent = "授权成功，正在连接实例…"
    instanceFeedback.className = "feedback-msg success"

    await refreshState()

    // 稍后切回主卡片视图
    setTimeout(() => {
      btnSaveInstance.disabled = false
      switchView("main")
    }, 450)
  } catch (err) {
    instanceFeedback.textContent =
      err instanceof Error ? err.message : "授权过程出现异常。"
    instanceFeedback.className = "feedback-msg error"
    btnSaveInstance.disabled = false
  }
})

// 导入本机书签流程
btnImportBookmarks.addEventListener("click", async () => {
  const origin = normalizeInstance(instanceInput.value)
  if (!origin) {
    importStatus.textContent = "请先配置并授权实例地址。"
    importStatus.className = "feedback-msg error"
    return
  }

  const grantedHost = await chrome.permissions.request({
    origins: [`${origin}/*`],
  })
  if (!grantedHost) {
    importStatus.textContent = "请允许访问实例站点以进行数据上传。"
    importStatus.className = "feedback-msg error"
    return
  }
  await chrome.storage.sync.set({ [STORAGE_KEY]: origin })

  const grantedBookmarks = await chrome.permissions.request({
    permissions: ["bookmarks"],
  })
  if (!grantedBookmarks) {
    importStatus.textContent = "未授予读取书签权限，导入已取消。"
    importStatus.className = "feedback-msg error"
    return
  }

  if (!chrome.bookmarks?.getTree) {
    importStatus.textContent =
      "此浏览器环境不支持直接读取书签，请在网页端通过 HTML 文件导入。"
    importStatus.className = "feedback-msg error"
    return
  }

  btnImportBookmarks.disabled = true
  importProgressContainer.classList.add("active")
  importProgressBar.style.width = "5%"
  importStatus.textContent = "正在读取本机书签，请保持弹窗打开…"
  importStatus.className = "feedback-msg"

  try {
    const tree = await chrome.bookmarks.getTree()
    const flat: FlatBookmark[] = []
    flattenBookmarks(tree, [], flat)
    const items = dedupeBookmarks(flat)

    if (items.length === 0) {
      importStatus.textContent = "未检测到可导入的有效网页书签。"
      importProgressContainer.classList.remove("active")
      btnImportBookmarks.disabled = false
      return
    }

    importStatus.textContent = `准备上传 ${items.length} 个书签…`
    importProgressBar.style.width = "10%"

    const started = (await chrome.runtime.sendMessage({
      type: "importBookmarksStart",
    })) as { ok?: boolean; jobId?: string; error?: string } | undefined

    if (!started?.ok || !started.jobId) {
      importStatus.textContent =
        started?.error || "创建导入任务失败，请检查是否已在实例登录。"
      importStatus.className = "feedback-msg error"
      importProgressContainer.classList.remove("active")
      btnImportBookmarks.disabled = false
      return
    }

    const batchSize = 200
    const totalBatches = Math.ceil(items.length / batchSize)

    for (let i = 0; i < totalBatches; i++) {
      const startIdx = i * batchSize
      const endIdx = Math.min(startIdx + batchSize, items.length)
      const currentBatch = items.slice(startIdx, endIdx)

      const batchRes = (await chrome.runtime.sendMessage({
        type: "importBookmarksBatch",
        jobId: started.jobId,
        batchIndex: i,
        items: currentBatch,
      })) as { ok?: boolean; error?: string } | undefined

      if (!batchRes?.ok) {
        importStatus.textContent = batchRes?.error || "分批上传失败，请重试。"
        importStatus.className = "feedback-msg error"
        importProgressContainer.classList.remove("active")
        btnImportBookmarks.disabled = false
        return
      }

      const progressPercent = Math.round((endIdx / items.length) * 85) + 10
      importProgressBar.style.width = `${progressPercent}%`
      importStatus.textContent = `正在上传 ${endIdx} / ${items.length} 个书签…`
    }

    importStatus.textContent = "上传完成，正在向实例发起智能扫描…"
    importProgressBar.style.width = "98%"

    const finishRes = (await chrome.runtime.sendMessage({
      type: "importBookmarksFinish",
      jobId: started.jobId,
    })) as { ok?: boolean; error?: string } | undefined

    if (!finishRes?.ok) {
      importStatus.textContent =
        finishRes?.error || "扫描触发失败，请稍后在网页端检查。"
      importStatus.className = "feedback-msg error"
      importProgressContainer.classList.remove("active")
      btnImportBookmarks.disabled = false
      return
    }

    importProgressBar.style.width = "100%"
    importStatus.textContent = "书签导入任务已创建，正在打开网页…"
    importStatus.className = "feedback-msg success"

    setTimeout(() => {
      window.close()
    }, 600)
  } catch (error) {
    importStatus.textContent =
      error instanceof Error ? error.message : "书签导入失败。"
    importStatus.className = "feedback-msg error"
    importProgressContainer.classList.remove("active")
    btnImportBookmarks.disabled = false
  }
})

// 启动逻辑
void init()
