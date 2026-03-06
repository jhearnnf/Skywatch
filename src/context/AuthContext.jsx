import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { getLevelAtCoins } from '../data/mockData'

const AuthContext = createContext(null)

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export function AuthProvider({ children }) {
  const [user,       setUser]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [notifQueue, setNotifQueue] = useState([]) // [{ id, type, ...data }]
  const userRef = useRef(null)
  useEffect(() => { userRef.current = user }, [user])

  // Check session on mount
  useEffect(() => {
    fetch(`${API}/api/auth/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { setUser(data?.data?.user ?? null) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    setUser(null)
  }

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
      if (totalAfter !== undefined) updated.totalAircoins = totalAfter
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
    <AuthContext.Provider value={{ user, setUser, logout, loading, API, notifQueue, shiftNotif, awardAircoins }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
