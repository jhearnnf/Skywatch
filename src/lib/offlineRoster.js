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
import { OFFLINE_AIRCRAFT } from './offlineAircraft'
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

// Build the offline roster. ALWAYS returns both offline aircraft (their GLBs are
// bundled in the build/APK), so Trace 1 and the 3D games work offline even on a
// fresh install that never cached the dynamic roster. Each entry is enriched
// from the cached roster when present (real briefId) and its cutout image is the
// cached data URL (warmOfflineAssets) when present, else the transformed
// Cloudinary URL (web SW may have it) — never blocks the game on a missing
// cutout, since the model itself is local.
async function buildOfflineRoster(cachedList) {
  const bySlug = new Map(
    (cachedList || [])
      .filter((a) => a?.title)
      .map((a) => [titleToSlug(a.title), a]),
  )
  return Promise.all(
    OFFLINE_AIRCRAFT.map(async (def) => {
      const real = bySlug.get(def.slug)
      const dataUrl = await cacheGet(cutoutCacheKey(def.slug))
      return {
        briefId:   real?.briefId ?? null,
        title:     real?.title ?? def.title,
        cutoutUrl: dataUrl || (real ? transformCutoutUrl(real.cutoutUrl) : null),
      }
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
  return { data: await buildOfflineRoster(cached) }
}
