import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { getLevelAtCoins } from '../data/mockData'

const AuthContext = createContext(null)

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export function AuthProvider({ children }) {
  const [user,       setUser]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [notifQueue, setNotifQueue] = useState([]) // [{ id, type, ...data }]
  const [isLoading,       setIsLoading]       = useState(false)
  const [loadingStartTime, setLoadingStartTime] = useState(null)
  const loadingCountRef = useRef(0)
  const userRef = useRef(null)
  useEffect(() => { userRef.current = user }, [user])

  // apiFetch — wraps fetch for user-triggered calls:
  //   • Shows a loading overlay after 400ms if still in-flight (suppresses flicker on fast responses)
  //   • Reports the duration to the backend for admin stats
  const apiFetch = useCallback(async (url, options) => {
    const t0 = Date.now()
    let overlayShown = false
    const showTimer = setTimeout(() => {
      overlayShown = true
      loadingCountRef.current += 1
      if (loadingCountRef.current === 1) {
        setIsLoading(true)
        setLoadingStartTime(t0)
      }
    }, 400)
    try {
      return await fetch(url, { credentials: 'include', ...options })
    } finally {
      clearTimeout(showTimer)
      if (overlayShown) {
        loadingCountRef.current = Math.max(0, loadingCountRef.current - 1)
        if (loadingCountRef.current === 0) setIsLoading(false)
      }
      // Fire-and-forget: report duration for admin stats (uses raw fetch to avoid recursion)
      fetch(`${API}/api/admin/loading-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ durationMs: Date.now() - t0 }),
      }).catch(() => {})
    }
  }, [])

  // Check session on mount
  useEffect(() => {
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 8000)
    console.log('[auth] checking session...')
    fetch(`${API}/api/auth/me`, { credentials: 'include', signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const u = data?.data?.user ?? null
        console.log('[auth] session resolved, user:', u?._id ?? null)
        setUser(u)
        // If an admin reset this user's tutorials server-side, clear localStorage tutorial keys
        if (u?.tutorialsResetAt) {
          const resetTs   = new Date(u.tutorialsResetAt).getTime()
          const clearKey  = `sw_tut_cleared_at_${u._id}`
          const clearedTs = parseInt(localStorage.getItem(clearKey) ?? '0', 10)
          if (resetTs > clearedTs) {
            Object.keys(localStorage)
              .filter(k => k.startsWith(`sw_tut_v2_${u._id}_`))
              .forEach(k => localStorage.removeItem(k))
            localStorage.setItem(clearKey, String(resetTs))
          }
        }
      })
      .catch(err => console.error('[auth] session fetch failed:', err))
      .finally(() => { clearTimeout(timeoutId); setLoading(false) })
  }, [])

  const logout = async () => {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    setUser(null)
  }

  const refreshUser = useCallback(async () => {
    const data = await fetch(`${API}/api/auth/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
    setUser(data?.data?.user ?? null)
  }, [])

  // Remove the front item from the notification queue (called by App when notif finishes)
  const shiftNotif = useCallback(() => {
    setNotifQueue(q => q.slice(1))
  }, [])

  // Award aircoins: updates user state, queues aircoin + level-up + rank-promotion notifs.
  // cycleAfter / totalAfter: new values returned from server (used for server-driven awards)
  // rankPromotion: { from, to } if a promotion occurred (server-driven only)
  const awardAircoins = useCallback((amount, label, { cycleAfter, totalAfter, rankPromotion } = {}) => {
    const oldCycle = userRef.current?.cycleAircoins ?? 0
    const newCycle = cycleAfter ?? (oldCycle + amount)
    const oldLevel = getLevelAtCoins(oldCycle)
    const newLevel = getLevelAtCoins(newCycle)

    setUser(u => {
      if (!u) return u
      const updated = { ...u, cycleAircoins: newCycle }
      if (totalAfter != null) updated.totalAircoins = totalAfter
      else updated.totalAircoins = (u.totalAircoins ?? 0) + amount
      if (rankPromotion) updated.rank = rankPromotion.to
      return updated
    })

    setNotifQueue(q => {
      const ts    = Date.now()
      const items = [{ id: `${ts}-ac`, type: 'aircoin', amount, label }]
      if (rankPromotion) {
        // Skip level-up notifs — rank promotion supersedes them
        items.push({ id: `${ts}-rp`, type: 'rankpromotion', rank: rankPromotion.to })
      } else {
        for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
          items.push({ id: `${ts}-lu-${lvl}`, type: 'levelup', level: lvl })
        }
      }
      return [...q, ...items]
    })
  }, [])

  return (
    <AuthContext.Provider value={{ user, setUser, logout, loading, API, apiFetch, isLoading, loadingStartTime, notifQueue, shiftNotif, awardAircoins, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
