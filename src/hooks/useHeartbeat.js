import { useEffect, useRef } from 'react'
import { useAuth, authFetchOptions } from '../context/AuthContext'
import { getClientInfo, peekClientInfo } from '../utils/appVersion'

const INTERVAL_MS = 30_000

// Must stay >= the server's online window (5 minutes in GET /api/admin/stats).
// When this was shorter, someone reading a page without touching the mouse went
// quiet at 2 minutes and dropped out of the count at 5, so the dashboard showed
// fewer people than were actually looking at it. Anything the server still
// counts as online must keep sending.
const IDLE_THRESHOLD_MS = 5 * 60 * 1000

export default function useHeartbeat() {
  const { user, API } = useAuth()
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    if (!user) return

    const onActivity = () => { lastActivityRef.current = Date.now() }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))

    // Native needs a bridge round-trip for the app version; kick it off once so
    // peekClientInfo() has an answer by the second beat at the latest.
    getClientInfo()

    const send = async () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastActivityRef.current > IDLE_THRESHOLD_MS) return

      // The version rides along with presence rather than travelling on its own
      // request: it is recorded at exactly the moments lastSeen is, so "version
      // when last online" is true by construction. It is also strictly optional
      // — a heartbeat must still register presence if the version is unknown,
      // since presence is what the Users Online count depends on.
      const opts   = authFetchOptions()
      const client = peekClientInfo()

      try {
        await fetch(`${API}/api/users/heartbeat`, {
          method: 'POST',
          ...opts,
          headers: { ...(opts.headers ?? {}), 'Content-Type': 'application/json' },
          body: JSON.stringify(client ? { client } : {}),
        })
      } catch {
        // ignore network errors silently
      }
    }

    // Coming back to the tab is itself activity — otherwise a tab left in the
    // background past the idle threshold stays silent until the user happens to
    // move the mouse, and they read as offline while staring at the page.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      onActivity()
      send()
    }
    document.addEventListener('visibilitychange', onVisibility)

    send()
    const id = setInterval(send, INTERVAL_MS)

    return () => {
      events.forEach(e => window.removeEventListener(e, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(id)
    }
  }, [user, API])
}
