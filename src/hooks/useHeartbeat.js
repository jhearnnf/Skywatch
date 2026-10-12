import { useEffect, useRef } from 'react'
import { useAuth, authFetchOptions } from '../context/AuthContext'
import { getClientInfo, peekClientInfo } from '../utils/appVersion'
import { getGeoHint, peekGeoHint } from '../utils/geoHint'

const INTERVAL_MS = 30_000

// Must stay under the server's online window (PRESENCE_WINDOW_MS, 10 minutes —
// backend/constants/presence.js). When this was longer, someone reading a page
// without touching the mouse went quiet at 2 minutes and dropped out of the
// count, so the dashboard showed fewer people than were actually looking at it.
// Anything the server still counts as online must keep sending.
const IDLE_THRESHOLD_MS = 5 * 60 * 1000

// Fired on window once a beat sent because of a navigation has landed, so
// anything drawing presence (the CBAT hub's dots) can re-ask straight away
// instead of showing where this user was a page ago until its next poll.
export const HEARTBEAT_NAV_EVENT = 'skywatch:heartbeat-nav'

// `pathname` is the router's current path, passed in by App rather than read
// with useLocation() here so the hook still works outside a router. It is only
// a trigger: a change sends a beat at once, because on the timer alone the
// server kept reporting the previous page for up to 30s after someone left it,
// and the hub drew their dot on the game they had just finished.
export default function useHeartbeat(pathname) {
  const { user, API } = useAuth()
  const lastActivityRef = useRef(Date.now())
  const sendRef = useRef(null)

  useEffect(() => {
    if (!user) return

    const onActivity = () => { lastActivityRef.current = Date.now() }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))

    // Native needs a bridge round-trip for the app version; kick it off once so
    // peekClientInfo() has an answer by the second beat at the latest.
    getClientInfo()

    // Where they are goes up once per session, not on every beat: the server
    // does a little more work for it (see the heartbeat route), and the answer
    // does not change from one beat to the next.
    let geoSent = false

    const send = async ({ navigated = false } = {}) => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastActivityRef.current > IDLE_THRESHOLD_MS) return

      // The version rides along with presence rather than travelling on its own
      // request: it is recorded at exactly the moments lastSeen is, so "version
      // when last online" is true by construction. It is also strictly optional
      // — a heartbeat must still register presence if the version is unknown,
      // since presence is what the Users Online count depends on.
      const opts   = authFetchOptions()
      const client = peekClientInfo()

      // Which page they are on, for the admin presence strip in Community. Read
      // from location at send time rather than taken from a router hook: the
      // beat is on a timer, so "where are they now" is the only question worth
      // answering, and depending on the router would re-subscribe this effect on
      // every navigation to report something it would read again anyway.
      //
      // The pathname only — never the search or hash. The server maps it to a
      // label and stores that, so nothing here is kept verbatim; see
      // backend/constants/presenceLocations.js.
      let path = null
      try { path = window.location.pathname } catch { /* no location to read; presence still sends */ }

      // Claimed by this beat before the request leaves, so an overlapping
      // beat cannot also attach it; handed back if the request fails, so the
      // next beat tries again.
      const geo = geoSent ? null : peekGeoHint()
      if (geo) geoSent = true

      try {
        const res = await fetch(`${API}/api/users/heartbeat`, {
          method: 'POST',
          ...opts,
          headers: { ...(opts.headers ?? {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(client ? { client } : {}),
            ...(path ? { path } : {}),
            ...(geo ? { geo } : {}),
          }),
        })
        if (geo && !res?.ok) geoSent = false
        if (navigated && res?.ok) window.dispatchEvent(new Event(HEARTBEAT_NAV_EVENT))
      } catch {
        if (geo) geoSent = false
        // ignore network errors silently
      }
    }

    // The country lookup is a network round-trip, so the first beat almost
    // always goes up without it. Rather than wait for the next timer tick —
    // by which time someone who only glanced at the app has gone — beat again
    // the moment the answer arrives.
    let stopped = false
    getGeoHint().then(hint => { if (hint && !geoSent && !stopped) send() })

    // Coming back to the tab is itself activity — otherwise a tab left in the
    // background past the idle threshold stays silent until the user happens to
    // move the mouse, and they read as offline while staring at the page.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      onActivity()
      send()
    }
    document.addEventListener('visibilitychange', onVisibility)

    sendRef.current = send
    send()
    const id = setInterval(send, INTERVAL_MS)

    return () => {
      stopped = true
      sendRef.current = null
      events.forEach(e => window.removeEventListener(e, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(id)
    }
  }, [user, API])

  // Beat on navigation. Skips the first run: mounting the effect above has
  // already sent one for the page we start on. Navigating is activity too, so
  // it counts toward the idle check like a click would.
  const firstPathRef = useRef(true)
  useEffect(() => {
    if (firstPathRef.current) { firstPathRef.current = false; return }
    lastActivityRef.current = Date.now()
    sendRef.current?.({ navigated: true })
  }, [pathname])
}
