import { createContext, useContext, useState, useCallback } from 'react'

const GameChromeContext = createContext({
  immersive: false,
  enterImmersive: () => {},
  exitImmersive: () => {},
  gameOver: false,
  enterGameOver: () => {},
  exitGameOver: () => {},
  pendingPlayNavFlash: false,
  requestPlayNavFlash: () => {},
  consumePlayNavFlash: () => {},
  flashcardCollectActive: false,
  enterFlashcardCollect: () => {},
  exitFlashcardCollect: () => {},
})

export function GameChromeProvider({ children }) {
  const [immersive, setImmersive] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [pendingPlayNavFlash, setPendingPlayNavFlash] = useState(false)
  // Ref-counted so overlapping FlashcardDeckNotifications don't clear early
  const [flashcardCollectCount, setFlashcardCollectCount] = useState(0)

  const enterImmersive = useCallback(() => setImmersive(true), [])
  const exitImmersive  = useCallback(() => setImmersive(false), [])

  // Set while the shared CBAT game-over ("Your Score") screen is mounted. The
  // menu-music controller reads it to bring the soundtrack back to full menu
  // volume on completion (a game route otherwise maps to the quieter
  // pre-play "instructions" zone). See <CbatMenuMusic> / CbatGameOver.
  const enterGameOver = useCallback(() => setGameOver(true), [])
  const exitGameOver  = useCallback(() => setGameOver(false), [])

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
      gameOver, enterGameOver, exitGameOver,
      pendingPlayNavFlash, requestPlayNavFlash, consumePlayNavFlash,
      flashcardCollectActive, enterFlashcardCollect, exitFlashcardCollect,
    }}>
      {children}
    </GameChromeContext.Provider>
  )
}

export const useGameChrome = () => useContext(GameChromeContext)
