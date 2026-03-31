import { createContext, useContext, useCallback } from 'react'
import { useAuth } from './AuthContext'

const NewGameUnlockContext = createContext({
  newGames:            new Set(),
  hasAnyNew:           false,
  isUnlocked:          () => false,
  markSeen:            () => {},
  applyUnlocks:        () => {},
  markUnlockFromServer: () => {},
  revokeUnlock:        () => {},
})

const GAME_KEYS = ['quiz', 'flashcard', 'boo', 'wta']

export function NewGameUnlockProvider({ children }) {
  const { user, setUser, API } = useAuth()

  const gameUnlocks = user?.gameUnlocks ?? {}

  const newGames = new Set(
    GAME_KEYS.filter(key => gameUnlocks[key]?.unlockedAt && !gameUnlocks[key]?.badgeSeen)
  )
  const hasAnyNew = newGames.size > 0

  function isUnlocked(key) {
    return !!gameUnlocks[key]?.unlockedAt
  }

  // Called by Play page after dismiss animation completes for each game
  const markSeen = useCallback(async (key) => {
    if (!user?._id) return
    // Optimistic in-memory update
    setUser(prev => {
      if (!prev) return prev
      return {
        ...prev,
        gameUnlocks: {
          ...prev.gameUnlocks,
          [key]: { ...(prev.gameUnlocks?.[key] ?? {}), badgeSeen: true },
        },
      }
    })
    fetch(`${API}/api/users/me/game-unlocks/${key}/seen`, {
      method: 'PATCH', credentials: 'include',
    }).catch(() => {})
  }, [user?._id, setUser, API])

  // Called by BriefReader/QuizFlow when a server response includes gameUnlocksGranted
  const applyUnlocks = useCallback((keys) => {
    if (!user?._id || !keys?.length) return
    const now = new Date().toISOString()
    setUser(prev => {
      if (!prev) return prev
      const updated = { ...(prev.gameUnlocks ?? {}) }
      for (const key of keys) {
        if (GAME_KEYS.includes(key) && !updated[key]?.unlockedAt) {
          updated[key] = { ...(updated[key] ?? {}), unlockedAt: now, badgeSeen: false }
        }
      }
      return { ...prev, gameUnlocks: updated }
    })
  }, [user?._id, setUser])

  // Called by Play page when server confirms prereqs are no longer met (e.g. after history reset)
  const revokeUnlock = useCallback(async (key) => {
    if (!user?._id || !GAME_KEYS.includes(key)) return
    if (!gameUnlocks[key]?.unlockedAt) return // nothing to revoke
    // Optimistic in-memory clear
    setUser(prev => {
      if (!prev) return prev
      const updated = { ...(prev.gameUnlocks ?? {}) }
      updated[key] = {}
      return { ...prev, gameUnlocks: updated }
    })
    fetch(`${API}/api/users/me/game-unlocks/${key}/unlock`, {
      method: 'DELETE', credentials: 'include',
    }).catch(() => {})
  }, [user?._id, gameUnlocks, setUser, API])

  // Called by Play page to persist client-detected unlocks (e.g. BOO)
  const markUnlockFromServer = useCallback(async (key) => {
    if (!user?._id || !GAME_KEYS.includes(key)) return
    if (gameUnlocks[key]?.unlockedAt) return // already unlocked
    const r = await fetch(`${API}/api/users/me/game-unlocks/${key}/unlock`, {
      method: 'POST', credentials: 'include',
    }).catch(() => null)
    if (!r?.ok) return
    const data = await r.json().catch(() => null)
    if (data?.wasNew) applyUnlocks([key])
  }, [user?._id, gameUnlocks, applyUnlocks, API])

  return (
    <NewGameUnlockContext.Provider value={{ newGames, hasAnyNew, isUnlocked, markSeen, applyUnlocks, markUnlockFromServer, revokeUnlock }}>
      {children}
    </NewGameUnlockContext.Provider>
  )
}

export const useNewGameUnlock = () => useContext(NewGameUnlockContext)
