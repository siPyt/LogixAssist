// Logix Assistant service worker: makes the app installable and lets the shell
// load offline. API calls and non-GET requests are never cached.
const CACHE = 'logix-assist-v2'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/la-icon.svg']

// Also precache the hashed JS/CSS the page references, so the very first
// visit is already fully available offline.
async function precache() {
  const cache = await caches.open(CACHE)
  const html = await (await fetch('/index.html', { cache: 'reload' })).text()
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
  await cache.addAll([...SHELL, ...assets])
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Pages: network first so deploys show up, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match('/index.html', { ignoreVary: true })
          .then((r) => r || caches.match('/', { ignoreVary: true })),
      ),
    )
    return
  }

  // Assets: serve from cache, refresh in the background. ignoreVary because
  // module scripts send an Origin header the precache request did not.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreVary: true })
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone())
          return response
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
