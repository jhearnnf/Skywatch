// Warm the offline asset caches while online so CBAT works after going offline.
//
// The service worker caches Cloudinary cutouts and GLBs on first request. This
// proactively fetches the small set needed offline (the cutout images for the
// offline aircraft + their GLB models) so a user who never opened those games
// online still has them cached. GLBs are also precached by the SW; fetching
// here is a cheap belt-and-suspenders that also covers the native WebView.

import { isOnline } from './net'
import { cacheGet } from './offlineStore'
import { OFFLINE_AIRCRAFT_SLUGS, OFFLINE_AIRCRAFT_GLBS } from './offlineAircraft'
import { titleToSlug } from '../data/aircraftModels'
import { transformCutoutUrl } from './offlineRoster'

let warmed = false

export async function warmOfflineAssets() {
  if (warmed || !isOnline()) return
  warmed = true
  try {
    const roster = await cacheGet('roster:aircraft-cutouts')
    const allowed = new Set(OFFLINE_AIRCRAFT_SLUGS)
    const cutouts = (roster || [])
      .filter((a) => a?.title && allowed.has(titleToSlug(a.title)) && a.cutoutUrl)
      .map((a) => transformCutoutUrl(a.cutoutUrl))

    const urls = [
      ...cutouts,
      ...OFFLINE_AIRCRAFT_GLBS.map((f) => `/models/${f}`),
    ]
    // Fire all fetches; failures are non-fatal (asset simply won't be cached).
    await Promise.all(urls.map((u) => fetch(u).catch(() => {})))
  } catch {
    warmed = false // let a later online session retry
  }
}
