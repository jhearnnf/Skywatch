// Aircraft roster fetch with offline fallback.
//
// The CBAT aircraft-select games (Target, DPT, Flag, Plane Turn) load their
// aircraft list from /aircraft-cutouts (or /fighter-aircraft for DPT). Those
// endpoints need auth + network. This wrapper:
//   • Online  — fetches the live roster, caches it, returns the full list.
//   • Offline — returns the cached roster, filtered to aircraft whose assets
//               are actually available offline (Typhoon + Hawk T2), so a game
//               never offers an aircraft whose 3D model can't load.
//
// Returns the same { data: [...] } shape the endpoints do, so call sites keep
// their existing `.then(d => d.data)` handling.

import { isOnline } from './net'
import { cacheGet, cacheSet } from './offlineStore'
import { OFFLINE_AIRCRAFT_SLUGS } from './offlineAircraft'
import { titleToSlug } from '../data/aircraftModels'

const cacheKey = (endpoint) => `roster:${endpoint}`

// Key under which warmOfflineAssets stores each aircraft's cutout image as a
// data URL (so the cutout renders offline on web AND the SW-less Android build).
export const cutoutCacheKey = (slug) => `cutout:${slug}`

// Insert Cloudinary transforms so the offline-cached cutout is small (~20–60 KB
// instead of full-res). The warm step fetches this exact URL. No-op for
// non-Cloudinary URLs.
export function transformCutoutUrl(url) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url
  if (url.includes('/upload/w_')) return url // already transformed
  return url.replace('/upload/', '/upload/w_400,f_auto,q_auto/')
}

// Offline: keep only aircraft whose assets are available offline, and swap each
// cutout URL for its cached data URL (warmOfflineAssets). Falls back to the
// transformed Cloudinary URL if a data URL wasn't cached — on web the SW may
// still have it; on Android it just won't render (graceful).
async function filterToOffline(list) {
  const allowed = new Set(OFFLINE_AIRCRAFT_SLUGS)
  const offline = (list || []).filter((a) => a?.title && allowed.has(titleToSlug(a.title)))
  return Promise.all(
    offline.map(async (a) => {
      const dataUrl = await cacheGet(cutoutCacheKey(titleToSlug(a.title)))
      return { ...a, cutoutUrl: dataUrl || transformCutoutUrl(a.cutoutUrl) }
    }),
  )
}

// endpoint — 'aircraft-cutouts' or 'fighter-aircraft'
export async function getAircraftRoster(endpoint, { apiFetch, API }) {
  if (isOnline()) {
    try {
      const res = await apiFetch(`${API}/api/games/cbat/${endpoint}`)
      const json = await res.json()
      const data = json?.data || []
      cacheSet(cacheKey(endpoint), data) // fire-and-forget snapshot for offline
      return { data }
    } catch {
      /* fall through to the cached copy */
    }
  }
  const cached = await cacheGet(cacheKey(endpoint))
  return { data: await filterToOffline(cached) }
}
