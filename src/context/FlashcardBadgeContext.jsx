// Legacy shim — BriefReader and FlashcardGameModal use this API.
// State now lives in NewGameUnlockContext (cross-device, DB-backed).
import { createContext, useContext } from 'react'
import { useNewGameUnlock } from './NewGameUnlockContext'

const FlashcardBadgeContext = createContext({})

export function FlashcardBadgeProvider({ children }) {
  // No-op wrapper — kept so App.jsx provider tree doesn't need changes
  return <FlashcardBadgeContext.Provider value={{}}>{children}</FlashcardBadgeContext.Provider>
}

export function useFlashcardBadge() {
  const { newGames, applyUnlocks, markSeen } = useNewGameUnlock()
  return {
    hasBadge:   newGames.has('flashcard'),
    setBadge:   () => applyUnlocks(['flashcard']),
    clearBadge: () => markSeen('flashcard'),
  }
}
