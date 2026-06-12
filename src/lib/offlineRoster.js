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

// Insert Cloudinary transforms so the offline-cached cutout is small (~20–60 KB
// instead of full-res). The warm step fetches this exact URL, so offline the
// game requests the same (cached) URL. No-op for non-Cloudinary URLs.
export function transformCutoutUrl(url) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url
  if (url.includes('/upload/w_')) return url // already transformed
  return url.replace('/upload/', '/upload/w_400,f_auto,q_auto/')
}

function filterToOffline(list) {
  const allowed = new Set(OFFLINE_AIRCRAFT_SLUGS)
  return (list || [])
    .filter((a) => a?.title && allowed.has(titleToSlug(a.title)))
    .map((a) => ({ ...a, cutoutUrl: transformCutoutUrl(a.cutoutUrl) }))
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
  return { data: filterToOffline(cached) }
}
