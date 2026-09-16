// Which Amazon store the hardware cabinet should send a player to.
//
// We are enrolled in two Associates programmes, amazon.co.uk and amazon.ca,
// and a link into the wrong one is useless: the UK listing will not ship to
// Canada, and the sale would not be credited to us if it did. So the cabinet
// asks here, and everyone who is not in Canada gets the UK store, which is
// where nearly all of our players are.
//
// The answer comes from the same three signals the heartbeat already gathers
// (utils/geoHint.js), read the same way the server reconciles them
// (backend/constants/geo.js), with one difference in emphasis. The server
// wants to know which market someone came from, so on a disagreement it
// trusts the device's timezone over the IP. This wants to know which shop
// can deliver to their door right now, and that is the IP: a Canadian on a UK
// VPN is rarer than a Canadian with a stale timezone, and either way the
// wrong answer costs one click, not a sale. The timezone and then the browser
// language are only consulted when the IP lookup gave nothing, which is every
// dev server and any moment Vercel's edge header is missing.

import { useEffect, useState } from 'react'
import { getGeoHint, peekGeoHint } from '../geoHint'

export const HARDWARE_STORES = {
  uk: { id: 'uk', domain: 'amazon.co.uk' },
  ca: { id: 'ca', domain: 'amazon.ca' },
}

export const DEFAULT_STORE = 'uk'

// The Canadian zones from the server's table. Kept short on purpose: the
// timezone is only the fallback, and a zone missing from here just means the
// UK store, which is the default anyway.
const CANADIAN_TIME_ZONES = new Set([
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
// with any of the three null, or null altogether. Returns a store id.
export function storeForGeo(hint) {
  if (!hint) return DEFAULT_STORE
  const country = hint.country ? String(hint.country).toUpperCase() : null
  if (country) return country === 'CA' ? 'ca' : DEFAULT_STORE
  if (hint.timeZone) return CANADIAN_TIME_ZONES.has(hint.timeZone) ? 'ca' : DEFAULT_STORE
  if (hint.language && /-CA$/i.test(String(hint.language))) return 'ca'
  return DEFAULT_STORE
}

// The store for the current player. Starts from whatever the heartbeat has
// already found out (it begins the lookup on sign-in, long before anyone
// reaches a game page), and settles once the lookup lands. Until then it says
// UK, which is also what it says for everyone outside Canada, so the common
// case never flickers.
export function useHardwareStore() {
  const [store, setStore] = useState(() => storeForGeo(peekGeoHint()))

  useEffect(() => {
    let cancelled = false
    getGeoHint().then(hint => { if (!cancelled) setStore(storeForGeo(hint)) })
    return () => { cancelled = true }
  }, [])

  return store
}
