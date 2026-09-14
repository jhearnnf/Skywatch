// Where the user is, as far as the client can tell, for the heartbeat.
//
// Three signals, gathered once per page load and sent once per session:
//   - country:  what Vercel's edge worked out from the IP (GET /api/geo)
//   - timeZone: the device's IANA zone — set by the device, so it stays put
//               when the person travels or uses a VPN
//   - language: navigator.language (en-GB / en-AU / en-CA), a weak third vote
//
// The server reconciles them (backend/constants/geo.js). Nothing here decides
// anything; it only reports.
//
// The IP lookup runs against the site's own origin on the web. The Android
// app serves the bundle from its own origin, so it has to name the site
// explicitly. On a dev server /api/geo does not exist and the fetch simply
// yields no country; the timezone and language still go up.

import { SITE_URL } from './seoTitle'
import { isNative } from './isNative'

const COUNTRY_PATTERN = /^[A-Z]{2}$/

const GEO_ENDPOINT = isNative ? `${SITE_URL}/api/geo` : '/api/geo'

let pending  = null
let resolved = null

async function lookupCountry() {
  try {
    const res = await fetch(GEO_ENDPOINT, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return COUNTRY_PATTERN.test(data?.country) ? data.country : null
  } catch {
    return null
  }
}

function readTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { return null }
}

function readLanguage() {
  try { return navigator.language || null } catch { return null }
}

// Starts the lookup on first call and resolves to `{ country, timeZone,
// language }`, or null when none of the three could be read. Repeat calls
// share the one lookup.
export function getGeoHint() {
  if (!pending) {
    pending = (async () => {
      const [country, timeZone, language] = [await lookupCountry(), readTimeZone(), readLanguage()]
      resolved = country || timeZone || language ? { country, timeZone, language } : null
      return resolved
    })()
  }
  return pending
}

// Whatever getGeoHint() has already resolved to — null until it has.
export function peekGeoHint() {
  return resolved
}

// Test seam: forget the cached answer so a fresh lookup runs.
export function __resetGeoHint() {
  pending  = null
  resolved = null
}
