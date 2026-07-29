// Admin-only display preference for the CBAT boards: admin view (every row
// carries the player's email) or agent view (display names / agent numbers, the
// same thing every other user sees).
//
// The preference is only ever a REQUEST — the server decides what an account is
// allowed to see. Sending `adminView=0` asks it to answer as it would for a
// player; nothing here can make a non-admin see emails, and the toggle that
// writes it is admin-only in the UI.
//
// Asking the server rather than filtering emails out in the client is deliberate:
// the weekly reveal's neighbour names are composed server-side, and the injected
// demo rows are only labelled "demo" for admins. Both would still read as the
// admin view under a client-side filter.

import { useSyncExternalStore } from 'react'
import { CBAT_ADMIN_VIEW_KEY } from './storageKeys'

const listeners = new Set()

// Default ON: an admin who has never touched the toggle keeps the behaviour
// they've always had.
export function cbatAdminViewOn() {
  try { return localStorage.getItem(CBAT_ADMIN_VIEW_KEY) !== '0' } catch { return true }
}

export function setCbatAdminView(on) {
  try { localStorage.setItem(CBAT_ADMIN_VIEW_KEY, on ? '1' : '0') } catch { /* storage unavailable */ }
  listeners.forEach(fn => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Every CBAT surface that renders other people's names reads this, so flipping
// the hub's toggle updates the recent-scores column in place and the next board
// the admin opens is already in the chosen view.
export function useCbatAdminView() {
  return useSyncExternalStore(subscribe, cbatAdminViewOn, () => true)
}

// Appends the opt-out to a CBAT API URL. Admin view is the server's default for
// an admin, so it adds nothing in that case.
export function withCbatView(url, adminView) {
  if (adminView) return url
  return `${url}${url.includes('?') ? '&' : '?'}adminView=0`
}
