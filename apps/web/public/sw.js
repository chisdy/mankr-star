/**
 * 最小可用的离线兜底 Service Worker。
 *
 * 只做两件事：导航请求走「网络优先、失败回退缓存的应用外壳」，
 * 构建产物（带内容哈希的 /assets/*）走缓存优先。
 * /api/* 一律不碰——接口依赖 Cookie 会话，缓存只会让人看到别人的旧数据。
 */
const CACHE = "mankr-star-v1"
const SHELL = "/index.html"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, "/favicon.svg"]))
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE).then((cache) => cache.put(SHELL, copy))
          }
          return response
        })
        .catch(() => caches.match(SHELL).then((hit) => hit ?? Response.error())),
    )
    return
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              void caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})
