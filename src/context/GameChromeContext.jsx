import { createContext, useContext, useState, useCallback } from 'react'

const GameChromeContext = createContext({
  immersive: false,
  enterImmersive: () => {},
  exitImmersive: () => {},
})

export function GameChromeProvider({ children }) {
  const [immersive, setImmersive] = useState(false)
  const enterImmersive = useCallback(() => setImmersive(true), [])
  const exitImmersive  = useCallback(() => setImmersive(false), [])
  return (
    <GameChromeContext.Provider value={{ immersive, enterImmersive, exitImmersive }}>
      {children}
    </GameChromeContext.Provider>
  )
}

export const useGameChrome = () => useContext(GameChromeContext)
