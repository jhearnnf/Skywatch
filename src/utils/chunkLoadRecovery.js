// What to do when a piece of the app's code fails to load.
//
// Each deploy gives the app's code files new names and the old ones stop existing. A tab opened
// before the deploy still asks for the old names the first time it needs a page it has not
// loaded yet, and gets nothing back. Vite reports that as `vite:preloadError` (main.jsx), for a
// failed import as well as a failed preload.
//
// The cure is a fresh copy of the page, which asks for the new names. Two rules on top of that:
//
//   • Once a minute at most. A reload that did not fix it (the file is missing on the new build
//     too) must not become a reload loop. It used to be once per tab, EVER, which left a tab open
//     across two deploys stuck on the second one: a player's Mock Assessment froze on Trace 1
//     that way (2026-09-30).
//   • During a Mock Assessment, go back to the assessment screen rather than reload the game.
//     The screen says SkyWatch was updated and Continue carries on, so the player knows what
//     happened and lands in the test through the usual door.

import { MOCK_ROUTE } from '../lib/cbatMockSession'

export const RELOAD_KEY = 'skywatch-reload-on-preload-error'
export const RELOAD_COOLDOWN_MS = 60 * 1000
// ?updated=1 on the assessment screen: the notice that the page was refreshed for an update.
export const MOCK_UPDATED_PARAM = 'updated'
export const MOCK_UPDATED_PATH = `${MOCK_ROUTE}?${MOCK_UPDATED_PARAM}=1`

// Returns what it did: 'reloaded', 'mock' (sent to the assessment screen) or 'gave-up' (already
// tried within the last minute; the error is left to surface).
export function recoverFromChunkError({ storage, now = Date.now(), mockActive = false, reload, goTo }) {
  let last = 0
  try { last = Number(storage?.getItem(RELOAD_KEY)) || 0 } catch { /* storage blocked */ }
  // A stamp in the future (the clock was put back) counts as long ago, not as just now.
  const since = now - last
  if (since >= 0 && since < RELOAD_COOLDOWN_MS) return 'gave-up'
  try { storage?.setItem(RELOAD_KEY, String(now)) } catch { /* storage blocked */ }
  if (mockActive) {
    goTo(MOCK_UPDATED_PATH)
    return 'mock'
  }
  reload()
  return 'reloaded'
}
