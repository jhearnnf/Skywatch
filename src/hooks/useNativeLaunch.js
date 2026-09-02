import { useEffect } from 'react'
import { SLIM_APP } from '../utils/appMode'
import { markNativeIntroSeen, nativeIntroSeen } from '../utils/storageKeys'

// Where a native launch at `/` should go.
//
// The landing page is worth seeing ONCE — it carries the proof wall (real
// players' score histories) and the signup ask, which is the whole job still
// outstanding for someone who has just installed the app and has no account.
// It is not worth seeing on every cold start: a returning player wants the
// games, not the pitch. So the app shows it on the first signed-out launch and
// opens on /cbat every launch after that.
//
// The state lives at module scope rather than in refs. It genuinely is
// per-app-process — one launch per process — and the render tree has to read it
// synchronously, which rules refs out (react-hooks/refs, rightly, forbids
// reading one during render, and deferring the read to an effect would flash
// the landing page on every launch before redirecting off it).

// null until auth settles, then 'intro' or 'app' for the life of the process.
let launchRoute = null
// Set once the app has navigated off `/`. The header logo routes there too, and
// a link to a page that redirects straight back is worse than no link at all.
let leftLanding = false

// Resolved once, on the first call after auth has settled. Deciding earlier
// would read every returning player as a signed-out first-timer and put the
// signup pitch in front of them.
function resolveLaunchRoute(user, ready) {
  if (!ready) return null
  if (launchRoute === null) {
    launchRoute = SLIM_APP && !user && !nativeIntroSeen() ? 'intro' : 'app'
  }
  return launchRoute
}

// Returns true when a launch at `/` should be sent to /cbat instead.
export function useNativeLaunchRoute(pathname, user, ready) {
  const route = resolveLaunchRoute(user, ready)

  // Burn the intro as soon as it is decided on, not when the user finishes
  // reading it. Someone who opens the app, sees the pitch and closes it again
  // has seen it; showing it a second time would be the behaviour this exists
  // to avoid.
  useEffect(() => {
    if (route === 'intro') markNativeIntroSeen()
  }, [route])

  useEffect(() => {
    if (pathname !== '/') leftLanding = true
  }, [pathname])

  return SLIM_APP && route === 'app' && !leftLanding
}
