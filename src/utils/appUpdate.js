// "Am I running the latest version, and how do I get it?" — answered
// differently on each platform, because the thing standing between the user and
// the newest build is different.
//
//   web     — the PWA service worker. It precaches the whole app shell and can
//             keep a device pinned to an old bundle indefinitely; registerType
//             'autoUpdate' usually fixes that on the next visit, but a tab left
//             open for days, or a browser that never re-checks, will not.
//             The fix is local: throw the caches away and reload.
//   android — the Play Store. Nothing the JS can do installs a new build, so
//             the honest answer is a link. We only show it when we know a newer
//             build exists (GET /api/users/latest-release).

// Play Store listing for the packaged app (appId in capacitor.config.ts).
// The https form rather than market:// so the same href works if it is ever
// opened in a browser: Android hands play.google.com links to the Play app.
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=academy.skywatch.app'

// ── Web: force the newest bundle ─────────────────────────────────────────────

// vite-plugin-pwa's registerSW() returns an updateSW(reload) that checks for a
// waiting worker and activates it. main.jsx hands it over here so the button
// can use it; it stays null in dev, in tests and on native, where no service
// worker is registered at all.
let updateSW = null

export function setUpdateSW(fn) {
  updateSW = typeof fn === 'function' ? fn : null
}

// Everything the service worker is holding on to. Unregistering alone is not
// enough — the Cache Storage entries outlive the registration, and a fresh
// worker would happily serve the same stale precache back.
//
// Best-effort throughout: a browser with service workers disabled, or one that
// refuses a cache delete, must still end up at the reload. A button that does
// nothing because one cleanup step threw is worse than a button that reloads
// having cleared most of what it could.
async function clearServiceWorkerState() {
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.getRegistrations) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister().catch(() => {})))
    } catch { /* SW API unavailable or blocked — fall through to the reload */ }
  }

  if (typeof caches !== 'undefined' && caches?.keys) {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k).catch(() => {})))
    } catch { /* Cache Storage unavailable — fall through to the reload */ }
  }
}

// Drop every cached asset and reload from the network.
//
// Deliberately NOT just updateSW(true): that only helps when the worker has
// already noticed a new deploy, which is precisely the case that self-heals
// anyway. Someone pressing this button has been failed by the polite path, so
// it does the thorough thing — ask the worker to update first (cheap, and often
// enough on its own), then clear regardless and reload.
//
// Cost is one re-download of the app shell and the offline aircraft models on
// the next load. That is paid online, by definition: the button reloads from
// the network. Offline CBAT works again as soon as the new worker precaches.
export async function forceUpdateWebApp({ reload = defaultReload } = {}) {
  try { await updateSW?.(false) } catch { /* no waiting worker — carry on */ }
  await clearServiceWorkerState()
  reload()
}

// Cache-busting reload. `location.reload()` may re-serve index.html from the
// HTTP cache; replacing the URL with a one-shot query forces a fresh document,
// and using replace() keeps the marker out of the back/forward history.
function defaultReload() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('sw-refresh', String(Date.now()))
  window.location.replace(url.toString())
}

// ── Web: is a newer deploy live? ─────────────────────────────────────────────

// The stamp of whatever is deployed right now, from the /version.json the build
// writes beside the bundle (vite.config.js liveVersionFile). no-store plus a
// one-shot query so neither the HTTP cache nor the service worker can answer
// with the same stale deploy we are trying to detect.
//
// Resolves null on any failure: offline, dev (no file, so the SPA fallback
// answers with HTML and the parse throws), or a malformed body.
export async function fetchLiveWebVersion({ fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res?.ok) return null
    const data = await res.json()
    const build = typeof data?.build === 'string' ? data.build.trim() : ''
    if (!build) return null
    return { version: typeof data.version === 'string' ? data.version : null, build }
  } catch {
    return null
  }
}

// A commit sha has no ordering, so "different from what is live" is the whole
// test: a web bundle can only ever be behind the deploy, never ahead of it.
// 'dev' (no git at build time) and a missing stamp on either side mean we
// cannot tell, and that is never reported as outdated.
export function isWebUpdateAvailable(clientInfo, live) {
  if (clientInfo?.platform !== 'web') return false
  const mine = typeof clientInfo.build === 'string' ? clientInfo.build.trim() : ''
  const newest = live?.build
  if (!mine || mine === 'dev' || !newest || newest === 'dev') return false
  return mine !== newest
}

// ── Native: is there a newer build in the store? ─────────────────────────────

// Compares the build this device is running against the newest one the server
// has seen. Both are the store's monotonic counter (Android versionCode, iOS
// build number) as a string, so a numeric compare is the whole test.
//
// Answers false whenever either side is missing or non-numeric. An unknown
// build must never be reported as outdated: telling someone to update when we
// cannot actually tell is worse than staying quiet, since they have no way to
// discover the prompt was wrong beyond a trip to the store.
export function isNativeUpdateAvailable(clientInfo, latest) {
  if (clientInfo?.platform !== 'android' && clientInfo?.platform !== 'ios') return false

  const mine   = buildNumber(clientInfo.build)
  const newest = buildNumber(latest?.[clientInfo.platform]?.build)
  if (mine === null || newest === null) return false

  return newest > mine
}

// Number() alone will not do: it maps null, undefined and '' to 0, and
// appVersion.js genuinely reports build: null when the Capacitor bridge cannot
// answer. Treated as 0 that device is behind every real release, so it would be
// nagged to update on a version we know nothing about. Absent means unknown.
function buildNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
