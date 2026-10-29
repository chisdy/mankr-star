"use strict";
(() => {
  // src/source-label.ts
  function sourceLabel(sourceType) {
    if (sourceType === "github") return "GitHub";
    if (sourceType === "twitter") return "X";
    if (sourceType === "wechat") return "\u5FAE\u4FE1\u516C\u4F17\u53F7";
    return "\u7F51\u9875";
  }
  function savedStatusText(match) {
    const label = sourceLabel(match.source_type);
    return match.archived ? `\u5DF2\u6536\u85CF \xB7 ${label} \xB7 \u5DF2\u5F52\u6863` : `\u5DF2\u6536\u85CF \xB7 ${label}`;
  }

  // src/popup/index.ts
  var STORAGE_KEY = "instanceUrl";
  var viewMain = document.getElementById("view-main");
  var viewSettings = document.getElementById("view-settings");
  var btnOpenSettings = document.getElementById(
    "btn-open-settings"
  );
  var btnBack = document.getElementById("btn-back");
  var connDot = document.getElementById("conn-dot");
  var siteFavicon = document.getElementById("site-favicon");
  var siteFaviconFallback = document.getElementById(
    "site-favicon-fallback"
  );
  var siteDomain = document.getElementById("site-domain");
  var statusPill = document.getElementById("status-pill");
  var statusPillText = document.getElementById(
    "status-pill-text"
  );
  var pageTitle = document.getElementById("page-title");
  var pageUrl = document.getElementById("page-url");
  var btnAction = document.getElementById("btn-action");
  var btnActionIcon = document.getElementById("btn-action-icon");
  var btnActionText = document.getElementById("btn-action-text");
  var instanceInput = document.getElementById("instance");
  var btnSaveInstance = document.getElementById(
    "btn-save-instance"
  );
  var instanceFeedback = document.getElementById(
    "instance-feedback"
  );
  var btnImportBookmarks = document.getElementById(
    "btn-import-bookmarks"
  );
  var importProgressContainer = document.getElementById(
    "import-progress-container"
  );
  var importProgressBar = document.getElementById(
    "import-progress-bar"
  );
  var importStatus = document.getElementById("import-status");
  var ICON_PLUS = `
<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 12h14"/>
  <path d="M12 5v14"/>
</svg>`;
  var ICON_EXTERNAL = `
<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M15 3h6v6"/>
  <path d="M10 14 21 3"/>
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
</svg>`;
  var ICON_SETTINGS = `
<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`;
  var currentTab = null;
  var currentUrl = "";
  var viewState = { origin: null, url: "", match: null };
  var isPermitted = false;
  function normalizeInstance(raw) {
    const value = raw.trim();
    if (!value) return null;
    try {
      const url = new URL(
        /^https?:\/\//i.test(value) ? value : `https://${value}`
      );
      return url.origin;
    } catch {
      return null;
    }
  }
  function switchView(target) {
    if (target === "settings") {
      viewMain.classList.remove("active");
      viewSettings.classList.add("active");
      instanceFeedback.textContent = "";
      instanceFeedback.className = "feedback-msg";
      instanceInput.focus();
    } else {
      viewSettings.classList.remove("active");
      viewMain.classList.add("active");
    }
  }
  async function syncPermission() {
    const origin = normalizeInstance(instanceInput.value);
    if (!origin) {
      isPermitted = false;
      connDot.classList.remove("online");
      return false;
    }
    try {
      isPermitted = await chrome.permissions.contains({
        origins: [`${origin}/*`]
      });
    } catch {
      isPermitted = false;
    }
    if (isPermitted) {
      connDot.classList.add("online");
    } else {
      connDot.classList.remove("online");
    }
    return isPermitted;
  }
  function renderMain() {
    const isHttp = currentUrl && /^https?:/i.test(currentUrl);
    if (currentTab?.favIconUrl && isHttp && !currentTab.favIconUrl.startsWith("chrome://")) {
      siteFavicon.src = currentTab.favIconUrl;
      siteFavicon.onload = () => {
        siteFavicon.style.display = "block";
        siteFaviconFallback.style.display = "none";
      };
      siteFavicon.onerror = () => {
        siteFavicon.style.display = "none";
        siteFaviconFallback.style.display = "flex";
      };
    } else {
      siteFavicon.style.display = "none";
      siteFaviconFallback.style.display = "flex";
    }
    let domain = "";
    if (isHttp) {
      try {
        domain = new URL(currentUrl).hostname;
      } catch {
        domain = "\u7F51\u9875";
      }
    } else {
      domain = "\u53D7\u9650\u534F\u8BAE";
    }
    siteDomain.textContent = domain;
    const initialTitle = currentTab?.title?.trim() || domain;
    pageTitle.textContent = initialTitle;
    pageUrl.textContent = currentUrl || "\u65E0\u53EF\u7528\u94FE\u63A5";
    pageUrl.title = currentUrl;
    const origin = normalizeInstance(instanceInput.value);
    const isConfiguredAndReady = Boolean(
      origin && isPermitted && viewState.origin === origin
    );
    if (!isHttp) {
      statusPill.className = "status-pill alert";
      statusPillText.textContent = "\u7CFB\u7EDF\u9875\u9762";
      btnAction.disabled = true;
      btnActionIcon.innerHTML = ICON_PLUS;
      btnActionText.textContent = "\u65E0\u6CD5\u5728\u5F53\u524D\u9875\u9762\u6DFB\u52A0";
      return;
    }
    if (!isConfiguredAndReady) {
      statusPill.className = "status-pill";
      statusPillText.textContent = "\u672A\u914D\u7F6E";
      btnAction.disabled = false;
      btnActionIcon.innerHTML = ICON_SETTINGS;
      btnActionText.textContent = "\u914D\u7F6E\u5B9E\u4F8B\u5E76\u6388\u6743";
      return;
    }
    const match = viewState.match;
    if (match) {
      statusPill.className = "status-pill saved";
      statusPillText.textContent = savedStatusText(match);
      btnAction.disabled = false;
      btnActionIcon.innerHTML = ICON_EXTERNAL;
      btnActionText.textContent = "\u5728 Mankr Star \u4E2D\u6253\u5F00";
      return;
    }
    statusPill.className = "status-pill";
    statusPillText.textContent = "\u672A\u6536\u85CF";
    btnAction.disabled = false;
    btnActionIcon.innerHTML = ICON_PLUS;
    btnActionText.textContent = "\u6DFB\u52A0\u81F3 Mankr Star";
  }
  async function loadMatchedTitle(origin, id) {
    try {
      const res = await fetch(`${origin}/api/bookmarks/${id}`, {
        credentials: "include"
      });
      if (!res.ok) return;
      const body = await res.json();
      if (viewState.match && viewState.match.id === id && body.title) {
        pageTitle.textContent = body.title;
      }
    } catch {
    }
  }
  async function refreshState() {
    try {
      const next = await chrome.runtime.sendMessage({
        type: "refreshAndGetState"
      });
      if (next) viewState = next;
      if (viewState.origin && document.activeElement !== instanceInput) {
        instanceInput.value = viewState.origin;
      }
    } catch {
    }
    await syncPermission();
    renderMain();
    const origin = normalizeInstance(instanceInput.value);
    if (isPermitted && viewState.match && origin && viewState.origin === origin) {
      void loadMatchedTitle(origin, viewState.match.id);
    }
  }
  function flattenBookmarks(nodes, path, out) {
    for (const node of nodes || []) {
      const title = typeof node.title === "string" ? node.title.trim() : "";
      if (node.url) {
        if (/^https?:\/\//i.test(node.url)) {
          out.push({ title: title || node.url, url: node.url, folderPath: path });
        }
        continue;
      }
      if (node.children) {
        flattenBookmarks(node.children, title ? path.concat(title) : path, out);
      }
    }
  }
  function dedupeBookmarks(items) {
    const seen = /* @__PURE__ */ new Set();
    const kept = [];
    for (const item of items) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      kept.push(item);
    }
    return kept;
  }
  async function init() {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    const savedOrigin = stored[STORAGE_KEY];
    if (savedOrigin) {
      instanceInput.value = savedOrigin;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab || null;
    currentUrl = tab?.url || "";
    await syncPermission();
    if (!savedOrigin || !isPermitted) {
      switchView("settings");
      instanceFeedback.textContent = "\u8BF7\u586B\u5199\u5E76\u6388\u6743\u60A8\u7684 Mankr Star \u90E8\u7F72\u5730\u5740\u4EE5\u5F00\u542F\u8BC6\u522B\u3002";
      instanceFeedback.className = "feedback-msg";
    } else {
      switchView("main");
    }
    renderMain();
    try {
      await refreshState();
    } catch {
      renderMain();
    }
  }
  btnOpenSettings.addEventListener("click", () => {
    switchView("settings");
  });
  btnBack.addEventListener("click", () => {
    switchView("main");
    renderMain();
  });
  instanceInput.addEventListener("input", () => {
    const trimmed = instanceInput.value.trim();
    if (trimmed) {
      const origin = normalizeInstance(trimmed);
      if (origin && instanceFeedback.classList.contains("error")) {
        instanceFeedback.textContent = "";
        instanceFeedback.className = "feedback-msg";
      }
    }
    void syncPermission().then(renderMain);
  });
  instanceInput.addEventListener("blur", () => {
    const origin = normalizeInstance(instanceInput.value);
    if (origin) {
      instanceInput.value = origin;
    } else if (!instanceInput.value.trim()) {
      instanceInput.value = "";
    }
  });
  btnAction.addEventListener("click", async () => {
    const origin = normalizeInstance(instanceInput.value);
    const isConfiguredAndReady = Boolean(origin && isPermitted);
    if (!isConfiguredAndReady) {
      switchView("settings");
      return;
    }
    if (!origin || !currentUrl) return;
    const match = viewState.match && viewState.origin === origin ? viewState.match : null;
    const targetUrl = match ? `${origin}/?bookmark=${encodeURIComponent(match.id)}` : `${origin}/?add=${encodeURIComponent(currentUrl)}`;
    await chrome.tabs.create({ url: targetUrl });
    window.close();
  });
  btnSaveInstance.addEventListener("click", async () => {
    const origin = normalizeInstance(instanceInput.value);
    if (!origin) {
      instanceFeedback.textContent = "\u8BF7\u8F93\u5165\u5408\u6CD5\u7684 URL \u683C\u5F0F\uFF08\u5982 https://star.example.com\uFF09\u3002";
      instanceFeedback.className = "feedback-msg error";
      return;
    }
    instanceInput.value = origin;
    btnSaveInstance.disabled = true;
    instanceFeedback.textContent = "\u6B63\u5728\u53D1\u8D77\u6D4F\u89C8\u5668\u6743\u9650\u6388\u6743\u2026";
    instanceFeedback.className = "feedback-msg";
    try {
      const granted = await chrome.permissions.request({
        origins: [`${origin}/*`]
      });
      if (!granted) {
        instanceFeedback.textContent = "\u672A\u6388\u4E88\u8BE5\u7AD9\u70B9\u7684\u8BBF\u95EE\u6743\u9650\uFF0C\u65E0\u6CD5\u540C\u6B65\u6536\u85CF\u72B6\u6001\u3002";
        instanceFeedback.className = "feedback-msg error";
        btnSaveInstance.disabled = false;
        return;
      }
      await chrome.storage.sync.set({ [STORAGE_KEY]: origin });
      await syncPermission();
      instanceFeedback.textContent = "\u6388\u6743\u6210\u529F\uFF0C\u6B63\u5728\u8FDE\u63A5\u5B9E\u4F8B\u2026";
      instanceFeedback.className = "feedback-msg success";
      await refreshState();
      setTimeout(() => {
        btnSaveInstance.disabled = false;
        switchView("main");
      }, 450);
    } catch (err) {
      instanceFeedback.textContent = err instanceof Error ? err.message : "\u6388\u6743\u8FC7\u7A0B\u51FA\u73B0\u5F02\u5E38\u3002";
      instanceFeedback.className = "feedback-msg error";
      btnSaveInstance.disabled = false;
    }
  });
  btnImportBookmarks.addEventListener("click", async () => {
    const origin = normalizeInstance(instanceInput.value);
    if (!origin) {
      importStatus.textContent = "\u8BF7\u5148\u914D\u7F6E\u5E76\u6388\u6743\u5B9E\u4F8B\u5730\u5740\u3002";
      importStatus.className = "feedback-msg error";
      return;
    }
    const grantedHost = await chrome.permissions.request({
      origins: [`${origin}/*`]
    });
    if (!grantedHost) {
      importStatus.textContent = "\u8BF7\u5141\u8BB8\u8BBF\u95EE\u5B9E\u4F8B\u7AD9\u70B9\u4EE5\u8FDB\u884C\u6570\u636E\u4E0A\u4F20\u3002";
      importStatus.className = "feedback-msg error";
      return;
    }
    await chrome.storage.sync.set({ [STORAGE_KEY]: origin });
    const grantedBookmarks = await chrome.permissions.request({
      permissions: ["bookmarks"]
    });
    if (!grantedBookmarks) {
      importStatus.textContent = "\u672A\u6388\u4E88\u8BFB\u53D6\u4E66\u7B7E\u6743\u9650\uFF0C\u5BFC\u5165\u5DF2\u53D6\u6D88\u3002";
      importStatus.className = "feedback-msg error";
      return;
    }
    if (!chrome.bookmarks?.getTree) {
      importStatus.textContent = "\u6B64\u6D4F\u89C8\u5668\u73AF\u5883\u4E0D\u652F\u6301\u76F4\u63A5\u8BFB\u53D6\u4E66\u7B7E\uFF0C\u8BF7\u5728\u7F51\u9875\u7AEF\u901A\u8FC7 HTML \u6587\u4EF6\u5BFC\u5165\u3002";
      importStatus.className = "feedback-msg error";
      return;
    }
    btnImportBookmarks.disabled = true;
    importProgressContainer.classList.add("active");
    importProgressBar.style.width = "5%";
    importStatus.textContent = "\u6B63\u5728\u8BFB\u53D6\u672C\u673A\u4E66\u7B7E\uFF0C\u8BF7\u4FDD\u6301\u5F39\u7A97\u6253\u5F00\u2026";
    importStatus.className = "feedback-msg";
    try {
      const tree = await chrome.bookmarks.getTree();
      const flat = [];
      flattenBookmarks(tree, [], flat);
      const items = dedupeBookmarks(flat);
      if (items.length === 0) {
        importStatus.textContent = "\u672A\u68C0\u6D4B\u5230\u53EF\u5BFC\u5165\u7684\u6709\u6548\u7F51\u9875\u4E66\u7B7E\u3002";
        importProgressContainer.classList.remove("active");
        btnImportBookmarks.disabled = false;
        return;
      }
      importStatus.textContent = `\u51C6\u5907\u4E0A\u4F20 ${items.length} \u4E2A\u4E66\u7B7E\u2026`;
      importProgressBar.style.width = "10%";
      const started = await chrome.runtime.sendMessage({
        type: "importBookmarksStart"
      });
      if (!started?.ok || !started.jobId) {
        importStatus.textContent = started?.error || "\u521B\u5EFA\u5BFC\u5165\u4EFB\u52A1\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u662F\u5426\u5DF2\u5728\u5B9E\u4F8B\u767B\u5F55\u3002";
        importStatus.className = "feedback-msg error";
        importProgressContainer.classList.remove("active");
        btnImportBookmarks.disabled = false;
        return;
      }
      const batchSize = 200;
      const totalBatches = Math.ceil(items.length / batchSize);
      for (let i = 0; i < totalBatches; i++) {
        const startIdx = i * batchSize;
        const endIdx = Math.min(startIdx + batchSize, items.length);
        const currentBatch = items.slice(startIdx, endIdx);
        const batchRes = await chrome.runtime.sendMessage({
          type: "importBookmarksBatch",
          jobId: started.jobId,
          batchIndex: i,
          items: currentBatch
        });
        if (!batchRes?.ok) {
          importStatus.textContent = batchRes?.error || "\u5206\u6279\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002";
          importStatus.className = "feedback-msg error";
          importProgressContainer.classList.remove("active");
          btnImportBookmarks.disabled = false;
          return;
        }
        const progressPercent = Math.round(endIdx / items.length * 85) + 10;
        importProgressBar.style.width = `${progressPercent}%`;
        importStatus.textContent = `\u6B63\u5728\u4E0A\u4F20 ${endIdx} / ${items.length} \u4E2A\u4E66\u7B7E\u2026`;
      }
      importStatus.textContent = "\u4E0A\u4F20\u5B8C\u6210\uFF0C\u6B63\u5728\u5411\u5B9E\u4F8B\u53D1\u8D77\u667A\u80FD\u626B\u63CF\u2026";
      importProgressBar.style.width = "98%";
      const finishRes = await chrome.runtime.sendMessage({
        type: "importBookmarksFinish",
        jobId: started.jobId
      });
      if (!finishRes?.ok) {
        importStatus.textContent = finishRes?.error || "\u626B\u63CF\u89E6\u53D1\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u5728\u7F51\u9875\u7AEF\u68C0\u67E5\u3002";
        importStatus.className = "feedback-msg error";
        importProgressContainer.classList.remove("active");
        btnImportBookmarks.disabled = false;
        return;
      }
      importProgressBar.style.width = "100%";
      importStatus.textContent = "\u4E66\u7B7E\u5BFC\u5165\u4EFB\u52A1\u5DF2\u521B\u5EFA\uFF0C\u6B63\u5728\u6253\u5F00\u7F51\u9875\u2026";
      importStatus.className = "feedback-msg success";
      setTimeout(() => {
        window.close();
      }, 600);
    } catch (error) {
      importStatus.textContent = error instanceof Error ? error.message : "\u4E66\u7B7E\u5BFC\u5165\u5931\u8D25\u3002";
      importStatus.className = "feedback-msg error";
      importProgressContainer.classList.remove("active");
      btnImportBookmarks.disabled = false;
    }
  });
  void init();
})();
