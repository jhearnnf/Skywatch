// Warm the offline asset caches while online so CBAT works fully offline —
// crucially including the native Android build, which does NOT run a service
// worker (the PWA/SW path is web-only).
//
// GLB models are bundled in the APK (Android) and precached by the SW (web),
// so they already work offline. The gap is the aircraft cutout images, which
// live on Cloudinary (remote). Here we fetch the offline aircraft's cutouts
// and store them as data URLs in IndexedDB — readable in both the browser and
// the Android WebView with no service worker and no extra native plugin.
// offlineRoster then serves these data URLs when offline.

import { isOnline } from './net'
import { cacheGet, cacheSet } from './offlineStore'
import { OFFLINE_AIRCRAFT_SLUGS, OFFLINE_AIRCRAFT_GLBS } from './offlineAircraft'
import { titleToSlug } from '../data/aircraftModels'
import { transformCutoutUrl, cutoutCacheKey } from './offlineRoster'

let warmed = false

function fetchAsDataUrl(url) {
  return fetch(url)
    .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.blob() })
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    }))
}

export async function warmOfflineAssets() {
  if (warmed || !isOnline()) return
  warmed = true
  try {
    const roster = await cacheGet('roster:aircraft-cutouts')
    const allowed = new Set(OFFLINE_AIRCRAFT_SLUGS)
    const targets = (roster || []).filter(
      (a) => a?.title && allowed.has(titleToSlug(a.title)) && a.cutoutUrl,
    )

    await Promise.all(
      targets.map(async (a) => {
        const key = cutoutCacheKey(titleToSlug(a.title))
        if (await cacheGet(key)) return // already cached this session/install
        try {
          const dataUrl = await fetchAsDataUrl(transformCutoutUrl(a.cutoutUrl))
          await cacheSet(key, dataUrl)
        } catch {
          /* leave uncached — the web SW may still have the Cloudinary copy */
        }
      }),
    )

    // GLBs are bundled (Android) / precached (web); fetching also primes the
    // web runtime cache. Non-fatal if they fail.
    await Promise.all(OFFLINE_AIRCRAFT_GLBS.map((f) => fetch(`/models/${f}`).catch(() => {})))
  } catch {
    warmed = false // let a later online session retry
  }
}
