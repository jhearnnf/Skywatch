import { createContext, useContext, useState, useCallback } from 'react'

const GameChromeContext = createContext({
  immersive: false,
  enterImmersive: () => {},
  exitImmersive: () => {},
  pendingPlayNavFlash: false,
  requestPlayNavFlash: () => {},
  consumePlayNavFlash: () => {},
  flashcardCollectActive: false,
  enterFlashcardCollect: () => {},
  exitFlashcardCollect: () => {},
})

export function GameChromeProvider({ children }) {
  const [immersive, setImmersive] = useState(false)
  const [pendingPlayNavFlash, setPendingPlayNavFlash] = useState(false)
  // Ref-counted so overlapping FlashcardDeckNotifications don't clear early
  const [flashcardCollectCount, setFlashcardCollectCount] = useState(0)

  const enterImmersive = useCallback(() => setImmersive(true), [])
  const exitImmersive  = useCallback(() => setImmersive(false), [])

  // Set when a flashcard-collect animation lands on a Play nav button that is
  // currently off-screen (i.e. user is in immersive mode and the BottomNav is
  // translated out of view). BottomNav consumes this flag once chrome is back
  // on-screen so the user actually sees the blue "something new" pulse.
  const requestPlayNavFlash = useCallback(() => setPendingPlayNavFlash(true), [])
  const consumePlayNavFlash = useCallback(() => setPendingPlayNavFlash(false), [])

  // Tracks the FlashcardDeckNotification animation window — used by
  // PlayNavFlasher to defer the unlock-driven flash until after FDN's own
  // play-nav-flash has finished, so the two pulses don't overlap.
  const enterFlashcardCollect = useCallback(() => setFlashcardCollectCount(c => c + 1), [])
  const exitFlashcardCollect  = useCallback(() => setFlashcardCollectCount(c => Math.max(0, c - 1)), [])
  const flashcardCollectActive = flashcardCollectCount > 0

  return (
    <GameChromeContext.Provider value={{
      immersive, enterImmersive, exitImmersive,
      pendingPlayNavFlash, requestPlayNavFlash, consumePlayNavFlash,
      flashcardCollectActive, enterFlashcardCollect, exitFlashcardCollect,
    }}>
      {children}
    </GameChromeContext.Provider>
  )
}

export const useGameChrome = () => useContext(GameChromeContext)
