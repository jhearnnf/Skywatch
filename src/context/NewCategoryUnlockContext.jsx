import { createContext, useContext, useCallback, useMemo } from 'react'
import { useAuth } from './AuthContext'

const NewCategoryUnlockContext = createContext({
  newCategories:    new Set(),
  hasAnyNew:        false,
  firstNewCategory: null,
  markSeen:         () => {},
  markAllSeen:      () => {},
  applyUnlocks:     () => {},
})

// Mongoose Map serializes to a plain object over JSON, so categoryUnlocks is always a plain object on the wire.
function entriesOf(unlocks) {
  return unlocks ? Object.entries(unlocks) : []
}

export function NewCategoryUnlockProvider({ children }) {
  const { user, setUser, API, apiFetch } = useAuth()

  const categoryUnlocks = user?.categoryUnlocks ?? {}

  const { newCategories, firstNewCategory } = useMemo(() => {
    const entries = entriesOf(categoryUnlocks)
      .filter(([, v]) => v?.unlockedAt && !v?.badgeSeen)
      .sort(([, a], [, b]) => new Date(a.unlockedAt) - new Date(b.unlockedAt))
    return {
      newCategories:    new Set(entries.map(([k]) => k)),
      firstNewCategory: entries[0]?.[0] ?? null,
    }
  }, [categoryUnlocks])

  const hasAnyNew = newCategories.size > 0

  // Marks one category badge as seen (optimistic + server sync)
  const markSeen = useCallback(async (category) => {
    if (!user?._id || !category) return
    setUser(prev => {
      if (!prev) return prev
      const next = { ...(prev.categoryUnlocks ?? {}) }
      next[category] = { ...(next[category] ?? {}), badgeSeen: true }
      return { ...prev, categoryUnlocks: next }
    })
    apiFetch(`${API}/api/users/me/category-unlocks/${encodeURIComponent(category)}/seen`, {
      method: 'PATCH',
    }).catch(() => {})
  }, [user?._id, setUser, API, apiFetch])

  // Clears every unseen category badge in one shot — used when the Learn nav button is clicked
  const markAllSeen = useCallback(async () => {
    if (!user?._id) return
    setUser(prev => {
      if (!prev) return prev
      const src  = prev.categoryUnlocks ?? {}
      const next = {}
      for (const [k, v] of entriesOf(src)) {
        next[k] = { ...(v ?? {}), badgeSeen: true }
      }
      return { ...prev, categoryUnlocks: next }
    })
    apiFetch(`${API}/api/users/me/category-unlocks/seen-all`, {
      method: 'PATCH',
    }).catch(() => {})
  }, [user?._id, setUser, API, apiFetch])

  // Applies a categoryUnlocksGranted[] payload from a server response (already persisted server-side
  // by awardCoins). Just patches the in-memory user so the badge appears immediately.
  const applyUnlocks = useCallback((granted) => {
    if (!user?._id || !granted?.length) return
    setUser(prev => {
      if (!prev) return prev
      const next = { ...(prev.categoryUnlocks ?? {}) }
      for (const entry of granted) {
        const cat = entry?.category
        if (!cat) continue
        next[cat] = {
          unlockedAt: entry.unlockedAt ?? new Date().toISOString(),
          badgeSeen:  false,
        }
      }
      return { ...prev, categoryUnlocks: next }
    })
  }, [user?._id, setUser])

  return (
    <NewCategoryUnlockContext.Provider value={{ newCategories, hasAnyNew, firstNewCategory, markSeen, markAllSeen, applyUnlocks }}>
      {children}
    </NewCategoryUnlockContext.Provider>
  )
}

export const useNewCategoryUnlock = () => useContext(NewCategoryUnlockContext)
