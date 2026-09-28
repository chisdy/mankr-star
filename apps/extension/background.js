"use strict";
(() => {
  // ../../packages/shared/src/tracking-params.ts
  var TRACKING_QUERY_PARAMS = [
    "fbclid",
    "gclid",
    "gbraid",
    "wbraid",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
    "ref_url"
  ];

  // ../../packages/shared/src/canonicalize-url.ts
  function isTrackingParam(key) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_")) return true;
    return TRACKING_QUERY_PARAMS.includes(lower);
  }
  function stripHash(url) {
    const i = url.indexOf("#");
    return i >= 0 ? url.slice(0, i) : url;
  }
  function canonicalizeUrl(input) {
    const raw = input.trim();
    if (!raw) {
      return { ok: false, code: "INVALID_URL", error: "\u8BF7\u8F93\u5165\u6709\u6548\u94FE\u63A5" };
    }
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const noHash = stripHash(withProto);
    const m = noHash.match(/^(https?):\/\/([^/?#]+)([^?#]*)?(?:\?([^#]*))?$/i);
    if (!m) {
      return { ok: false, code: "INVALID_URL", error: "\u65E0\u6548\u7684\u94FE\u63A5" };
    }
    const protocol = m[1].toLowerCase();
    if (protocol !== "http" && protocol !== "https") {
      return {
        ok: false,
        code: "UNSUPPORTED_PROTOCOL",
        error: "\u4EC5\u652F\u6301 http/https \u94FE\u63A5"
      };
    }
    let hostname = m[2].toLowerCase();
    if (hostname.endsWith(":80") && protocol === "http") {
      hostname = hostname.slice(0, -3);
    }
    if (hostname.endsWith(":443") && protocol === "https") {
      hostname = hostname.slice(0, -4);
    }
    let pathname = m[3] && m[3].length > 0 ? m[3] : "/";
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    const queryRaw = m[4] ?? "";
    const kept = [];
    if (queryRaw) {
      for (const part of queryRaw.split("&")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        const key = eq >= 0 ? part.slice(0, eq) : part;
        try {
          const decodedKey = decodeURIComponent(key.replace(/\+/g, " "));
          if (isTrackingParam(decodedKey)) continue;
        } catch {
          if (isTrackingParam(key)) continue;
        }
        kept.push(part);
      }
    }
    const search = kept.length > 0 ? `?${kept.join("&")}` : "";
    const canonicalUrl = `${protocol}://${hostname}${pathname}${search}`;
    return {
      ok: true,
      canonicalUrl,
      hostname,
      pathname
    };
  }

  // ../../packages/shared/src/source-detect-rules.ts
  var IMPLEMENTED_SOURCE_TYPES = ["github", "twitter", "url"];
  var SOURCE_DETECT_RULES = [
    { type: "github", match: /(?:^|\.)github\.com$/i, label: "GitHub" },
    {
      type: "twitter",
      match: /(?:^|\.)(?:x|twitter)\.com$/i,
      label: "X"
    },
    { type: "url", match: /^https?:\/\//i, label: "\u901A\u7528\u7F51\u9875" }
  ];

  // ../../packages/shared/src/detect-source.ts
  var OWNER_REPO_SHORT = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
  function isImplemented(type) {
    return IMPLEMENTED_SOURCE_TYPES.includes(type);
  }
  function labelFor(type) {
    return SOURCE_DETECT_RULES.find((r) => r.type === type)?.label ?? (type === "url" ? "\u901A\u7528\u7F51\u9875" : type);
  }
  function unsupportedMessage(_type, label) {
    return `\u8BC6\u522B\u4E3A${label}\uFF0C\u4E13\u9879\u80FD\u529B\u5C1A\u672A\u63A5\u5165`;
  }
  function extractHost(input) {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const m = withProto.match(/^https?:\/\/([^/?#]+)/i);
    if (!m?.[1]) return null;
    return m[1].toLowerCase();
  }
  function detectSourceType(input) {
    const raw = input.trim();
    if (!raw) {
      return {
        ok: false,
        code: "INVALID_URL",
        error: "\u8BF7\u8F93\u5165\u6709\u6548\u94FE\u63A5\u6216 owner/repo"
      };
    }
    if (!raw.includes("://") && !raw.toLowerCase().startsWith("github.com") && OWNER_REPO_SHORT.test(raw)) {
      return {
        ok: true,
        sourceType: "github",
        implemented: true,
        label: labelFor("github")
      };
    }
    const host = extractHost(raw);
    if (host) {
      for (const rule of SOURCE_DETECT_RULES) {
        if (rule.type === "url") continue;
        if (rule.match.test(host)) {
          const implemented = isImplemented(rule.type);
          if (!implemented) {
            return {
              ok: false,
              code: "UNSUPPORTED_SOURCE",
              error: unsupportedMessage(rule.type, rule.label),
              detectedType: rule.type,
              label: rule.label
            };
          }
          return {
            ok: true,
            sourceType: rule.type,
            implemented: true,
            label: rule.label
          };
        }
      }
      if (/^https?:\/\//i.test(raw) || host.includes(".")) {
        const implemented = isImplemented("url");
        if (!implemented) {
          return {
            ok: false,
            code: "UNSUPPORTED_SOURCE",
            error: unsupportedMessage("url", "\u901A\u7528\u7F51\u9875"),
            detectedType: "url",
            label: "\u901A\u7528\u7F51\u9875"
          };
        }
        return {
          ok: true,
          sourceType: "url",
          implemented: true,
          label: labelFor("url")
        };
      }
    }
    return {
      ok: false,
      code: "INVALID_URL",
      error: "\u65E0\u6548\u7684\u94FE\u63A5\u6216 owner/repo"
    };
  }

  // ../../packages/shared/src/twitter-url.ts
  var X_HOST = /(?:^|\.)(?:x|twitter)\.com$/i;
  var STATUS_PATH = /^(?:\/([A-Za-z0-9_]+))?\/status\/(\d+)\/?(?:\/.*)?$/i;
  var WEB_STATUS_PATH = /^\/i\/web\/status\/(\d+)\/?(?:\/.*)?$/i;
  var ARTICLE_PATH = /^\/i\/article\//i;
  var INVALID_STATUS_MSG = "\u8BF7\u7C98\u8D34 X \u5E16\u5B50\u94FE\u63A5\uFF08\u9700\u5305\u542B /status/\u2026\uFF09";
  function parseTwitterStatusInput(input) {
    const raw = input.trim();
    if (!raw) {
      return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG };
    }
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const hashIdx = withProto.indexOf("#");
    const noHash = hashIdx >= 0 ? withProto.slice(0, hashIdx) : withProto;
    const m = noHash.match(/^(https?):\/\/([^/?#]+)([^?#]*)/i);
    if (!m) {
      return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG };
    }
    const host = m[2].toLowerCase();
    if (!X_HOST.test(host)) {
      return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG };
    }
    let pathname = m[3] || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    if (ARTICLE_PATH.test(pathname)) {
      return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG };
    }
    const webStatus = pathname.match(WEB_STATUS_PATH);
    if (webStatus?.[1]) {
      const tweetId = webStatus[1];
      return {
        ok: true,
        data: {
          tweetId,
          handle: null,
          canonicalUrl: `https://x.com/i/web/status/${tweetId}`
        }
      };
    }
    const status = pathname.match(STATUS_PATH);
    if (status?.[2]) {
      const handleRaw = status[1] ?? null;
      const tweetId = status[2];
      if (!handleRaw || handleRaw.toLowerCase() === "i") {
        return {
          ok: true,
          data: {
            tweetId,
            handle: null,
            canonicalUrl: `https://x.com/i/web/status/${tweetId}`
          }
        };
      }
      const handle = handleRaw.replace(/^@/, "");
      return {
        ok: true,
        data: {
          tweetId,
          handle,
          canonicalUrl: `https://x.com/${handle}/status/${tweetId}`
        }
      };
    }
    return { ok: false, code: "INVALID_URL", error: INVALID_STATUS_MSG };
  }

  // ../web/src/worker/lib/github-url.ts
  function parseGithubRepoInput(input) {
    const raw = input.trim();
    if (!raw) return null;
    let owner;
    let repo;
    const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
    if (short && !raw.includes("://") && !raw.startsWith("github.com")) {
      owner = short[1];
      repo = short[2];
    } else {
      try {
        const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
        const url = new URL(withProto);
        if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
          return null;
        }
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return null;
        owner = parts[0];
        repo = parts[1].replace(/\.git$/, "");
      } catch {
        return null;
      }
    }
    if (!owner || !repo) return null;
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      return null;
    }
    const externalId = `${owner}/${repo}`;
    return {
      owner,
      repo,
      externalId,
      canonicalUrl: `https://github.com/${externalId}`
    };
  }

  // src/background.ts
  var INSTANCE_KEY = "instanceUrl";
  var INDEX_KEY = "bookmarkMatchIndex";
  var ALARM = "match-index";
  var ICON_PLAIN = {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png"
  };
  var ICON_SAVED = {
    16: "icons/icon-saved-16.png",
    32: "icons/icon-saved-32.png",
    48: "icons/icon-saved-48.png",
    128: "icons/icon-saved-128.png"
  };
  var stored = null;
  var byGithub = /* @__PURE__ */ new Map();
  var byTweet = /* @__PURE__ */ new Map();
  var byUrl = /* @__PURE__ */ new Map();
  function indexItems(items) {
    byGithub = /* @__PURE__ */ new Map();
    byTweet = /* @__PURE__ */ new Map();
    byUrl = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (item.source_type === "github") byGithub.set(item.canonical_url, item);
      else if (item.source_type === "twitter") byTweet.set(item.external_id, item);
      else if (item.source_type === "url") byUrl.set(item.canonical_url, item);
    }
  }
  function matchUrl(raw) {
    const detected = detectSourceType(raw);
    if (!detected.ok) return null;
    if (detected.sourceType === "github") {
      const parsed = parseGithubRepoInput(raw);
      return parsed ? byGithub.get(parsed.canonicalUrl) ?? null : null;
    }
    if (detected.sourceType === "twitter") {
      const parsed = parseTwitterStatusInput(raw);
      return parsed.ok ? byTweet.get(parsed.data.tweetId) ?? null : null;
    }
    if (detected.sourceType === "url") {
      const canonical = canonicalizeUrl(raw);
      return canonical.ok ? byUrl.get(canonical.canonicalUrl) ?? null : null;
    }
    return null;
  }
  async function readOrigin() {
    const data = await chrome.storage.sync.get(INSTANCE_KEY);
    const value = data[INSTANCE_KEY];
    return typeof value === "string" && value ? value : null;
  }
  async function loadIndexFromStorage() {
    const origin = await readOrigin();
    const data = await chrome.storage.local.get(INDEX_KEY);
    const saved = data[INDEX_KEY];
    if (!saved || !origin || saved.origin !== origin || !Array.isArray(saved.items)) {
      stored = null;
      indexItems([]);
      return;
    }
    stored = saved;
    indexItems(saved.items);
  }
  async function paintTab(tabId, url) {
    const saved = Boolean(url && /^https?:/i.test(url) && matchUrl(url));
    await chrome.action.setIcon({
      tabId,
      path: saved ? ICON_SAVED : ICON_PLAIN
    });
    await chrome.action.setBadgeText({ tabId, text: "" });
  }
  async function paintAllTabs() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map(
        (tab) => tab.id == null ? Promise.resolve() : paintTab(tab.id, tab.url)
      )
    );
  }
  async function clearAllBadges() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (tab.id == null) return Promise.resolve();
        return Promise.all([
          chrome.action.setBadgeText({ tabId: tab.id, text: "" }),
          chrome.action.setIcon({ tabId: tab.id, path: ICON_PLAIN })
        ]);
      })
    );
  }
  async function dropIndex() {
    stored = null;
    indexItems([]);
    await chrome.storage.local.remove(INDEX_KEY);
    await clearAllBadges();
  }
  async function refresh() {
    const origin = await readOrigin();
    if (!origin) return;
    const permitted = await chrome.permissions.contains({
      origins: [`${origin}/*`]
    });
    if (!permitted) return;
    if (stored && stored.origin !== origin) await dropIndex();
    const headers = {};
    if (stored && stored.origin === origin) {
      headers["If-None-Match"] = `"${stored.revision}"`;
    }
    let response;
    try {
      response = await fetch(`${origin}/api/bookmarks/match-index`, {
        credentials: "include",
        headers
      });
    } catch {
      return;
    }
    if (response.status === 401) {
      await dropIndex();
      return;
    }
    if (response.status === 304 || !response.ok) return;
    const body = await response.json();
    if (typeof body.revision !== "number" || !Array.isArray(body.items)) return;
    stored = { origin, revision: body.revision, items: body.items };
    indexItems(body.items);
    await chrome.storage.local.set({ [INDEX_KEY]: stored });
    await paintAllTabs();
  }
  async function currentState() {
    const origin = await readOrigin();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url && /^https?:/i.test(tab.url) ? tab.url : "";
    const hit = url ? matchUrl(url) : null;
    return {
      origin,
      url,
      match: hit ? {
        id: hit.id,
        source_type: hit.source_type,
        archived: hit.archived,
        canonical_url: hit.canonical_url
      } : null
    };
  }
  async function ensureAlarm() {
    const existing = await chrome.alarms.get(ALARM);
    if (!existing) {
      await chrome.alarms.create(ALARM, { periodInMinutes: 30 });
    }
  }
  var booted = null;
  function boot() {
    if (!booted) {
      booted = (async () => {
        await loadIndexFromStorage();
        await ensureAlarm();
        await paintAllTabs();
      })();
    }
    return booted;
  }
  chrome.runtime.onInstalled.addListener(() => {
    void boot().then(() => refresh());
  });
  chrome.runtime.onStartup.addListener(() => {
    void boot().then(() => refresh());
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void boot().then(() => refresh());
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url && changeInfo.status !== "complete") return;
    const url = changeInfo.url ?? tab.url;
    void boot().then(() => paintTab(tabId, url));
  });
  chrome.tabs.onActivated.addListener((info) => {
    void boot().then(async () => {
      const tab = await chrome.tabs.get(info.tabId);
      await paintTab(info.tabId, tab.url);
    });
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message && typeof message === "object" ? message.type : "";
    if (type === "getState" || type === "refreshAndGetState") {
      void (async () => {
        await boot();
        if (type === "refreshAndGetState") await refresh();
        sendResponse(await currentState());
      })();
      return true;
    }
    if (type === "importBookmarksStart" || type === "importBookmarksBatch" || type === "importBookmarksFinish") {
      void handleBookmarkImport(message).then(sendResponse).catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "\u5BFC\u5165\u5931\u8D25"
        });
      });
      return true;
    }
    return;
  });
  async function readOriginOrThrow() {
    const origin = await readOrigin();
    if (!origin) throw new Error("\u8BF7\u5148\u586B\u5199\u5B9E\u4F8B\u5730\u5740");
    const permitted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    if (!permitted) throw new Error("\u8FD8\u6CA1\u6709\u6388\u6743\u8FD9\u4E2A\u5B9E\u4F8B");
    return origin;
  }
  async function postImport(origin, path, body) {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
    }
    if (!response.ok) {
      throw new Error(parsed.error || text.slice(0, 180) || `HTTP ${response.status}`);
    }
    return parsed;
  }
  async function handleBookmarkImport(message) {
    const origin = await readOriginOrThrow();
    if (message.type === "importBookmarksStart") {
      const body = await postImport(origin, "/api/bookmarks/import/browser", {
        source: "extension"
      });
      const jobId = body.job?.id;
      if (!jobId) throw new Error("\u6CA1\u6709\u62FF\u5230\u5BFC\u5165\u4EFB\u52A1");
      return { ok: true, jobId };
    }
    if (message.type === "importBookmarksBatch") {
      if (!message.jobId) throw new Error("\u7F3A\u5C11\u5BFC\u5165\u4EFB\u52A1");
      await postImport(origin, `/api/bookmarks/import/browser/jobs/${message.jobId}/batches`, {
        batchIndex: message.batchIndex ?? 0,
        items: Array.isArray(message.items) ? message.items : []
      });
      return { ok: true, jobId: message.jobId };
    }
    if (!message.jobId) throw new Error("\u7F3A\u5C11\u5BFC\u5165\u4EFB\u52A1");
    await postImport(origin, `/api/bookmarks/import/browser/jobs/${message.jobId}/scan`, {});
    await chrome.tabs.create({ url: `${origin}/import` });
    return { ok: true, jobId: message.jobId };
  }
  void boot();
})();
