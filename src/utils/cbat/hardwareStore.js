// Which Amazon store the hardware cabinet should send a player to.
//
// We are enrolled in two Associates programmes, amazon.co.uk and amazon.ca,
// and a link into the wrong one is useless: the UK listing will not ship to
// Canada, and the sale would not be credited to us if it did. So the cabinet
// asks here, and everyone who is not in Canada gets the UK store, which is
// where nearly all of our players are.
//
// The answer is utils/region.js's "is this player in Canada". It reads the
// three signals the heartbeat gathers (utils/geoHint.js)
// with the IP first: the server (backend/constants/geo.js) wants to know which
// market someone came from and trusts the timezone on a disagreement, but
// this wants to know which shop can deliver to their door right now, and that
// is the IP. A Canadian on a UK VPN is rarer than a Canadian with a stale
// timezone, and either way the wrong answer costs one click, not a sale.

import { useEffect, useState } from 'react'
import { getGeoHint, peekGeoHint } from '../geoHint'
import { isCanadianHint } from '../region'

export const HARDWARE_STORES = {
  uk: { id: 'uk', domain: 'amazon.co.uk' },
  ca: { id: 'ca', domain: 'amazon.ca' },
}

export const DEFAULT_STORE = 'uk'

// `hint` is what getGeoHint() resolves to: `{ country, timeZone, language }`
// with any of the three null, or null altogether. Returns a store id.
export function storeForGeo(hint) {
  return isCanadianHint(hint) ? 'ca' : DEFAULT_STORE
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
