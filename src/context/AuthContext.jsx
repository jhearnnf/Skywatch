import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { getLevelNumber } from '../utils/levelUtils'
import { AUTH_TOKEN_KEY, tutorialKey, tutorialClearedKey } from '../utils/storageKeys'

const AuthContext = createContext(null)

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const isNative = Capacitor.isNativePlatform()

// On native, store/retrieve the JWT so we can send it as a Bearer header
const getStoredToken = () => localStorage.getItem(AUTH_TOKEN_KEY)
const storeToken = (token) => { if (token) localStorage.setItem(AUTH_TOKEN_KEY, token); }
const clearToken = () => localStorage.removeItem(AUTH_TOKEN_KEY)

// Inject Bearer header for native requests
const nativeHeaders = () => {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function AuthProvider({ children }) {
  const [user,       setUser]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [notifQueue, setNotifQueue] = useState([]) // [{ id, type, ...data }]
  const [isLoading,       setIsLoading]       = useState(false)
  const [loadingStartTime, setLoadingStartTime] = useState(null)
  const loadingCountRef = useRef(0)
  const userRef   = useRef(null)
  const levelsRef = useRef(null)
  useEffect(() => { userRef.current = user }, [user])

  // Fetch levels once for level-up detection in awardAirstars
  useEffect(() => {
    fetch(`${API}/api/users/levels`, { headers: nativeHeaders(), ...(isNative ? {} : { credentials: 'include' }) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data?.levels?.length) levelsRef.current = d.data.levels })
      .catch(() => {})
  }, [])

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
      const opts = isNative
        ? { ...options, headers: { ...nativeHeaders(), ...options?.headers } }
        : { credentials: 'include', ...options }
      return await fetch(url, opts)
    } finally {
      clearTimeout(showTimer)
      if (overlayShown) {
        loadingCountRef.current = Math.max(0, loadingCountRef.current - 1)
        if (loadingCountRef.current === 0) setIsLoading(false)
      }
      // Fire-and-forget: report duration for admin stats (uses raw fetch to avoid recursion)
      fetch(`${API}/api/admin/loading-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...nativeHeaders() },
        ...(isNative ? {} : { credentials: 'include' }),
        body: JSON.stringify({ durationMs: Date.now() - t0 }),
      }).catch(() => {})
    }
  }, [])

  // Check session on mount
  useEffect(() => {
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 8000)
    fetch(`${API}/api/auth/me`, { headers: nativeHeaders(), ...(isNative ? {} : { credentials: 'include' }), signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const u = data?.data?.user ?? null
        setUser(u)
        // If an admin reset this user's tutorials server-side, clear localStorage tutorial keys
        if (u?.tutorialsResetAt) {
          const resetTs   = new Date(u.tutorialsResetAt).getTime()
          const clearKey  = tutorialClearedKey(u._id)
          const clearedTs = parseInt(localStorage.getItem(clearKey) ?? '0', 10)
          if (resetTs > clearedTs) {
            const prefix = tutorialKey(u._id, '')
            Object.keys(localStorage)
              .filter(k => k.startsWith(prefix))
              .forEach(k => localStorage.removeItem(k))
            localStorage.setItem(clearKey, String(resetTs))
          }
        }
      })
      .catch(() => {})
      .finally(() => { clearTimeout(timeoutId); setLoading(false) })
  }, [])

  const logout = async () => {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: nativeHeaders(), ...(isNative ? {} : { credentials: 'include' }) })
    if (isNative) clearToken()
    setUser(null)
  }

  const refreshUser = useCallback(async () => {
    const data = await fetch(`${API}/api/auth/me`, { headers: nativeHeaders(), ...(isNative ? {} : { credentials: 'include' }) })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
    const fresh = data?.data?.user ?? null
    setUser(fresh)
    return fresh
  }, [])

  // Remove the front item from the notification queue (called by App when notif finishes)
  const shiftNotif = useCallback(() => {
    setNotifQueue(q => q.slice(1))
  }, [])

  // Award airstars: updates user state, queues airstar + level-up + rank-promotion + category-unlock notifs.
  // cycleAfter / totalAfter: new values returned from server (used for server-driven awards)
  // rankPromotion: { from, to } if a promotion occurred (server-driven only)
  // unlockedCategories: string[] of categories newly accessible (server-driven, queued LAST)
  const awardAirstars = useCallback((amount, label, { cycleAfter, totalAfter, rankPromotion, unlockedCategories } = {}) => {
    const oldCycle = userRef.current?.cycleAirstars ?? 0
    const newCycle = cycleAfter ?? (oldCycle + amount)
    const oldLevel = getLevelNumber(oldCycle, levelsRef.current)
    const newLevel = getLevelNumber(newCycle, levelsRef.current)

    setUser(u => {
      if (!u) return u
      const updated = { ...u, cycleAirstars: newCycle }
      if (totalAfter != null) updated.totalAirstars = totalAfter
      else updated.totalAirstars = (u.totalAirstars ?? 0) + amount
      if (rankPromotion) updated.rank = rankPromotion.to
      return updated
    })

    setNotifQueue(q => {
      const ts    = Date.now()
      const items = [{ id: `${ts}-ac`, type: 'airstar', amount, label }]
      if (rankPromotion) {
        // Skip level-up notifs — rank promotion supersedes them
        items.push({ id: `${ts}-rp`, type: 'rankpromotion', rank: rankPromotion.to })
      } else {
        for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
          items.push({ id: `${ts}-lu-${lvl}`, type: 'levelup', level: lvl })
        }
      }
      // Category unlock fires LAST in the queue — grand-finale "you've unlocked new pathways" notif.
      if (Array.isArray(unlockedCategories) && unlockedCategories.length) {
        items.push({ id: `${ts}-cu`, type: 'categoryUnlock', categories: unlockedCategories })
      }
      return [...q, ...items]
    })
  }, [])

  // Queues ONLY a category-unlock notif. Used to reconcile when a preview-driven
  // optimistic awardAirstars call missed a server-side unlock (e.g. the preview
  // diff and the commit diff disagreed) and we don't want to fire another
  // airstar/levelup notif for a zero-coin reconciliation.
  const queueCategoryUnlockNotif = useCallback((categories) => {
    if (!Array.isArray(categories) || !categories.length) return
    setNotifQueue(q => [...q, { id: `${Date.now()}-cu`, type: 'categoryUnlock', categories }])
  }, [])

  return (
    <AuthContext.Provider value={{ user, setUser, logout, loading, API, apiFetch, isLoading, loadingStartTime, notifQueue, shiftNotif, awardAirstars, queueCategoryUnlockNotif, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

// Exposed so Login.jsx can save the token from auth responses on native
export const storeNativeToken = (token) => { if (isNative && token) storeToken(token) }
