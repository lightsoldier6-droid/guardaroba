// Service worker: rende l'app installabile e utilizzabile con rete scarsa.
// File dell'app: rete prima (con timeout breve), poi copia locale. Font: copia locale.
// Le chiamate a Supabase, AI e meteo NON passano dalla cache: le gestisce l'app.
const VERSION = 'guardaroba-v5'
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './vendor/supabase.js',
  './js/app.js', './js/config.js', './js/store.js', './js/idb.js', './js/images.js', './js/weather.js', './js/ai.js',
  './js/ui.js', './js/taxonomy.js', './js/outfit.js', './js/sizes.js', './js/shopping.js',
  './js/views/today.js', './js/views/wardrobe.js', './js/views/itemForm.js', './js/views/shop.js',
  './js/views/measures.js', './js/views/settings.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
]
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

self.addEventListener('install', (e) => {
  // 'reload' scavalca la cache HTTP del browser: una nuova versione installa sempre i file appena pubblicati
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'fonts').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open('fonts').then(async (c) => {
      const hit = await c.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok || res.type === 'opaque') c.put(req, res.clone())
      return res
    }))
    return
  }
  if (url.origin !== self.location.origin) return

  e.respondWith((async () => {
    const cache = await caches.open(VERSION)
    // 'no-cache' ricontrolla sempre col server (GitHub Pages fa durare la cache HTTP 10 minuti)
    const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(new Request(req, { cache: 'no-cache' }))
    const fromNet = fresh.then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    const timeout = new Promise((resolve) => setTimeout(resolve, 3500, null))
    try {
      const res = await Promise.race([fromNet, timeout])
      if (res) return res
    } catch { /* offline: usa la cache */ }
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null)
    if (hit) return hit
    return fromNet // nessuna copia: aspetta comunque la rete
  })())
})
