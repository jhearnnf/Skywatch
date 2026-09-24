// Admin-only: pretend to be a player in another country, to see the CBAT hub and
// the Aptitude Report the way they do. '' (the default) means "use my own", and
// otherwise it is a region code from cbatBatteries.json (GB, CA, AU).
//
// Same arrangement as cbatAdminView.js: the preference is only ever a REQUEST.
// The server honours `simRegion` for admins alone, so nothing here can change
// what a player is scored against.
//
// Simulating a region is simulating a NEW player there: if the admin's own role
// belongs to another country it is set aside while the simulation is on, so the
// report opens on that country's "Which role are you aiming for?" question.

import { useSyncExternalStore } from 'react'
import { CBAT_ADMIN_REGION_KEY } from './storageKeys'
import { REGIONS } from '../data/cbatBatteries'

const listeners = new Set()

export function cbatAdminRegion() {
  try {
    const v = localStorage.getItem(CBAT_ADMIN_REGION_KEY) ?? ''
    return REGIONS[v] ? v : ''
  } catch { return '' }
}

export function setCbatAdminRegion(region) {
  try {
    if (REGIONS[region]) localStorage.setItem(CBAT_ADMIN_REGION_KEY, region)
    else localStorage.removeItem(CBAT_ADMIN_REGION_KEY)
  } catch { /* storage unavailable */ }
  listeners.forEach(fn => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// '' for a non-admin whatever is stored, so a leftover value on a shared
// browser can never reach a player's requests.
export function useCbatAdminRegion(isAdmin) {
  const region = useSyncExternalStore(subscribe, cbatAdminRegion, () => '')
  return isAdmin ? region : ''
}

// Appends the simulated region to a CBAT API URL. Adds nothing when none is set.
export function withCbatRegion(url, region) {
  if (!region) return url
  return `${url}${url.includes('?') ? '&' : '?'}simRegion=${region}`
}
