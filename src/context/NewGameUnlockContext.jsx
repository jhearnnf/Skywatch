import { createContext, useContext, useCallback, useState } from 'react'
import { useAuth } from './AuthContext'

const NewGameUnlockContext = createContext({
  newGames:             new Set(),
  hasAnyNew:            false,
  isUnlocked:           () => false,
  markSeen:             () => {},
  applyUnlocks:         () => {},
  markUnlockFromServer: () => {},
  revokeUnlock:         () => {},
  pendingPlayNavFlash:  false,
  consumePlayNavFlash:  () => {},
})

const GAME_KEYS = ['quiz', 'flashcard', 'boo', 'wta']

export function NewGameUnlockProvider({ children }) {
  const { user, setUser, API, apiFetch } = useAuth()

  // Flag set when applyUnlocks lands at least one genuinely-new game key;
  // consumed by PlayNavFlasher once the global notifQueue has drained, so the
  // Play nav button flashes AFTER any airstar/levelup/rankpromotion notifs.
  // Distinct from GameChromeContext.pendingPlayNavFlash, which only handles
  // the deferred-during-immersive flash for the flashcard-collect animation.
  const [pendingPlayNavFlash, setPendingPlayNavFlash] = useState(false)
  const consumePlayNavFlash = useCallback(() => setPendingPlayNavFlash(false), [])

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
    apiFetch(`${API}/api/users/me/game-unlocks/${key}/seen`, {
      method: 'PATCH',
    }).catch(() => {})
  }, [user?._id, setUser, API, apiFetch])

  // Called by BriefReader/QuizFlow when a server response includes gameUnlocksGranted
  const applyUnlocks = useCallback((keys) => {
    if (!user?._id || !keys?.length) return
    const now = new Date().toISOString()
    // Decide synchronously whether this call genuinely unlocks something.
    // Some callers (e.g. BriefReader's badgePendingRef path) call this with
    // 'flashcard' even when the flashcard game is already unlocked — flagging
    // unconditionally would fire a spurious second play-nav flash on top of
    // FlashcardDeckNotification's own end-of-animation flash.
    // Reading from the closure user is safe: applyUnlocks is invoked from
    // event handlers / fetch resolutions, never during render, so the closure
    // reflects committed state. setUser-updater closures can't be used here
    // because the updater runs async (next render).
    const currentUnlocks = user.gameUnlocks ?? {}
    const willUnlockSomething = keys.some(k => GAME_KEYS.includes(k) && !currentUnlocks[k]?.unlockedAt)
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
    if (willUnlockSomething) setPendingPlayNavFlash(true)
  }, [user, setUser])

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
    apiFetch(`${API}/api/users/me/game-unlocks/${key}/unlock`, {
      method: 'DELETE',
    }).catch(() => {})
  }, [user?._id, gameUnlocks, setUser, API, apiFetch])

  // Called by Play page to persist client-detected unlocks (e.g. BOO)
  const markUnlockFromServer = useCallback(async (key) => {
    if (!user?._id || !GAME_KEYS.includes(key)) return
    if (gameUnlocks[key]?.unlockedAt) return // already unlocked
    const r = await apiFetch(`${API}/api/users/me/game-unlocks/${key}/unlock`, {
      method: 'POST', credentials: 'include',
    }).catch(() => null)
    if (!r?.ok) return
    const data = await r.json().catch(() => null)
    if (data?.wasNew) applyUnlocks([key])
  }, [user?._id, gameUnlocks, applyUnlocks, API])

  return (
    <NewGameUnlockContext.Provider value={{ newGames, hasAnyNew, isUnlocked, markSeen, applyUnlocks, markUnlockFromServer, revokeUnlock, pendingPlayNavFlash, consumePlayNavFlash }}>
      {children}
    </NewGameUnlockContext.Provider>
  )
}

export const useNewGameUnlock = () => useContext(NewGameUnlockContext)
