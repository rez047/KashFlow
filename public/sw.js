const CACHE_NAME = 'kashflow-shell-v1'
const APP_SHELL = ['/', '/index.html', '/kashflow.svg', '/manifest.webmanifest'].map((path) => new URL(path, self.location.origin).href)

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  await cache.addAll(APP_SHELL)
  const shell = await cache.match(new URL('/index.html', self.location.origin).href) ?? await cache.match(new URL('/', self.location.origin).href)
  if (!shell) throw new Error('The KashFlow app shell could not be cached.')

  const html = await shell.text()
  const assetUrls = new Set()
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const isScript = /^<script\b/i.test(tag)
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1]?.toLowerCase().split(/\s+/) ?? []
    const isStylesheetOrModule = !isScript && (rel.includes('stylesheet') || rel.includes('modulepreload'))
    if (!isScript && !isStylesheetOrModule) continue
    const asset = tag.match(isScript ? /\bsrc=["']([^"']+)["']/i : /\bhref=["']([^"']+)["']/i)?.[1]
    if (!asset) continue
    const url = new URL(asset, self.location.origin)
    if (url.origin === self.location.origin) assetUrls.add(url.href)
  }

  const manifestUrl = new URL('/kashflow-assets-manifest.json', self.location.origin)
  const manifestResponse = await fetch(manifestUrl, { cache: 'reload' })
  if (manifestResponse.ok && manifestResponse.headers.get('content-type')?.includes('json')) {
    const manifest = await manifestResponse.clone().json()
    await cache.put(manifestUrl, manifestResponse)
    for (const entry of Object.values(manifest)) {
      if (!entry || typeof entry !== 'object') continue
      const files = [entry.file, ...(Array.isArray(entry.css) ? entry.css : []), ...(Array.isArray(entry.assets) ? entry.assets : [])]
      for (const file of files) {
        if (typeof file !== 'string') continue
        const url = new URL(file, `${self.location.origin}/`)
        if (url.origin === self.location.origin) assetUrls.add(url.href)
      }
    }
  }

  await Promise.all(Array.from(assetUrls, async (assetUrl) => {
    const response = await fetch(assetUrl, { cache: 'reload' })
    if (!response.ok) throw new Error(`Could not cache app asset: ${assetUrl}`)
    await cache.put(assetUrl, response)
  }))
  await self.skipWaiting()
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('kashflow-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/v1/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(new URL('/index.html', self.location.origin).href, response.clone()))
      return response
    }).catch(async () => (await caches.match(new URL('/index.html', self.location.origin).href)) ?? Response.error()))
    return
  }

  event.respondWith(caches.match(request).then(async (cached) => {
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok && response.type === 'basic') void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
    return response
  }))
})
