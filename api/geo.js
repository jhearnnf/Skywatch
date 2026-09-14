// GET /api/geo — the country Vercel's edge worked out from the caller's IP,
// echoed back as JSON so the app can send it with its heartbeat.
//
// This lives on Vercel rather than on the backend because only Vercel sees the
// request from the edge: API calls go straight to Railway, which adds no
// geolocation headers, and a GeoIP database bundled into the backend would go
// stale. Vercel's data is maintained for us and free.
//
// Only the country is returned. Vercel also offers region and city headers,
// but country is all the app records (see backend/constants/geo.js), and
// nothing should reach the client that is not written down.
//
// CORS is open on purpose: the Android app calls this from the bundled WebView
// (origin https://localhost), and a two-letter country code about the caller's
// own IP is not something worth protecting from the caller.

const COUNTRY_PATTERN = /^[A-Z]{2}$/

export function countryFromHeaders(headers) {
  const raw = String(headers?.['x-vercel-ip-country'] ?? '').trim().toUpperCase()
  return COUNTRY_PATTERN.test(raw) ? raw : null
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  // Per-caller answer: must never be served from a shared cache.
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' })
  res.status(200).json({ country: countryFromHeaders(req.headers) })
}
