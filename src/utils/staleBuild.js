// Getting a tab that was open before a deploy onto the new build, without pulling the page out
// from under a player.
//
// The browser only looks for a new service worker when a page is fully loaded, and moving around
// inside the app never loads a page, so a tab left open could keep running an old build for days.
// On 2026-10-01 a tab two deploys behind sat a Mock Assessment whose Instruments step had been
// changed under it, and the player sat Instruments Reading over and over. So:
//
//   • Check regularly: every 15 minutes, and when the tab comes back into view.
//   • When a new build is ready, do not reload there and then. vite-plugin-pwa's autoUpdate would,
//     which can land in the middle of a game. Mark it ready instead (main.jsx passes
//     markUpdateReady as onNeedReload).
//   • Reload at the next safe moment: the player moving to a new page that is not a game, with
//     nothing riding on the navigation. During a Mock Assessment that is arriving back on the
//     assessment screen, which then says SkyWatch was updated (utils/chunkLoadRecovery.js).

import { MOCK_ROUTE } from '../lib/cbatMockSession'
import { MOCK_UPDATED_PATH } from './chunkLoadRecovery'
import { fetchLiveWebVersion, isWebUpdateAvailable } from './appUpdate'
import { peekClientInfo } from './appVersion'

export const CHECK_EVERY_MS = 15 * 60 * 1000
// Coming back to the tab checks again, but not more than once a minute.
export const MIN_CHECK_GAP_MS = 60 * 1000

let ready = false

export function markUpdateReady() { ready = true }
export function isUpdateReady() { return ready }
export function __resetStaleBuild() { ready = false }

// Where to reload to when the player has just arrived at `pathname`, or null to leave the page be.
//
//   • In a mock: only the assessment screen itself, and to its "SkyWatch was updated" form. The
//     game pages of a mock are opened with router state the site lock checks, which a reload
//     would drop.
//   • Otherwise: any page that is not a game, reached by a navigation carrying no router state
//     (state is lost on a reload, and pages use it to open on a particular brief or tab).
export function reloadTargetFor({ pathname, search = '', hash = '', state = null, mockActive = false, gamePaths }) {
  if (mockActive) return pathname === MOCK_ROUTE ? MOCK_UPDATED_PATH : null
  if (state != null) return null
  if (isGamePath(pathname, gamePaths)) return null
  return `${pathname}${search}${hash}`
}

function isGamePath(pathname, gamePaths) {
  for (const p of gamePaths) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return true
  }
  return false
}

// Start the regular checks. With a service worker, asking it to update is the whole job: a new
// build installs, activates and calls onNeedReload. Without one (unsupported, or it failed to
// register) compare against the live /version.json instead. Returns a stop function.
export function startUpdateChecks({
  registration = null,
  onStale = markUpdateReady,
  fetchLive = fetchLiveWebVersion,
  clientInfo = () => peekClientInfo(),
  doc = typeof document !== 'undefined' ? document : null,
  now = () => Date.now(),
  everyMs = CHECK_EVERY_MS,
} = {}) {
  let last = now()

  const check = () => {
    last = now()
    if (registration) {
      Promise.resolve().then(() => registration.update()).catch(() => { /* offline, or the worker is busy */ })
      return
    }
    fetchLive().then(live => {
      if (isWebUpdateAvailable(clientInfo(), live)) onStale()
    }).catch(() => {})
  }

  const onVisible = () => {
    if (doc?.visibilityState !== 'visible') return
    if (now() - last < MIN_CHECK_GAP_MS) return
    check()
  }

  const timer = setInterval(check, everyMs)
  doc?.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(timer)
    doc?.removeEventListener('visibilitychange', onVisible)
  }
}
