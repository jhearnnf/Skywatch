import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'

const INTERVAL_MS = 30_000
const IDLE_THRESHOLD_MS = 2 * 60 * 1000

export default function useHeartbeat() {
  const { user, API } = useAuth()
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    if (!user) return

    const onActivity = () => { lastActivityRef.current = Date.now() }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))

    const send = async () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastActivityRef.current > IDLE_THRESHOLD_MS) return
      try {
        await fetch(`${API}/api/users/heartbeat`, { method: 'POST', credentials: 'include' })
      } catch {
        // ignore network errors silently
      }
    }

    send()
    const id = setInterval(send, INTERVAL_MS)

    return () => {
      events.forEach(e => window.removeEventListener(e, onActivity))
      clearInterval(id)
    }
  }, [user, API])
}
