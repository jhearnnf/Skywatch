// Is this player in Canada?
//
// The hardware cabinet links to amazon.ca for a player in Canada
// (utils/cbat/hardwareStore.js). It reads the three signals the heartbeat
// gathers (utils/geoHint.js); anything else that needs the same answer should
// read it from here rather than re-derive it. (CLAN on the FLAG tile was gated
// on this for a day and then opened to everyone; see utils/cbat/clanOffer.js.)
//
// The IP wins whenever it answered: it says where the person is right now,
// which is what both questions ask. The device's timezone and then the
// browser language are consulted only when the IP lookup gave nothing —
// every dev server, and any moment Vercel's edge header is missing.

import { useEffect, useState } from 'react'
import { getGeoHint, peekGeoHint } from './geoHint'

// The Canadian zones from the server's table (backend/constants/geo.js). Kept
// short on purpose: the timezone is only the fallback, and a zone missing
// from here just means "not Canada", which is the default anyway.
export const CANADIAN_TIME_ZONES = new Set([
  'America/Toronto', 'America/Montreal', 'America/Vancouver', 'America/Edmonton',
  'America/Calgary', 'America/Winnipeg', 'America/Regina', 'America/Halifax',
  'America/St_Johns', 'America/Moncton', 'America/Yellowknife', 'America/Whitehorse',
  'America/Iqaluit', 'America/Dawson', 'America/Inuvik', 'America/Glace_Bay',
  'America/Goose_Bay', 'America/Thunder_Bay', 'America/Nipigon', 'America/Rainy_River',
  'America/Swift_Current', 'America/Cambridge_Bay', 'America/Rankin_Inlet',
  'America/Resolute', 'America/Fort_Nelson', 'America/Dawson_Creek', 'America/Creston',
  'America/Atikokan', 'America/Blanc-Sablon', 'America/Pangnirtung',
])

// `hint` is what getGeoHint() resolves to: `{ country, timeZone, language }`
// with any of the three null, or null altogether.
export function isCanadianHint(hint) {
  if (!hint) return false
  const country = hint.country ? String(hint.country).toUpperCase() : null
  if (country) return country === 'CA'
  if (hint.timeZone) return CANADIAN_TIME_ZONES.has(hint.timeZone)
  if (hint.language && /-CA$/i.test(String(hint.language))) return true
  return false
}

// Whether the current player is in Canada. Starts from whatever the heartbeat
// has already found out (it begins the lookup on sign-in, long before anyone
// reaches the hub) and settles once the lookup lands. Until then it says no,
// which is also the answer for nearly everyone, so the common case never
// flickers.
export function useIsCanada() {
  const [canada, setCanada] = useState(() => isCanadianHint(peekGeoHint()))

  useEffect(() => {
    let cancelled = false
    getGeoHint().then(hint => { if (!cancelled) setCanada(isCanadianHint(hint)) })
    return () => { cancelled = true }
  }, [])

  return canada
}
