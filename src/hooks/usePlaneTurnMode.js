import { useState } from 'react'

const STORAGE_KEY = 'cbat:plane-turn:mode'
const VALID = ['2d', '3d']

export function usePlaneTurnMode() {
  const [mode, setModeState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return VALID.includes(stored) ? stored : '3d'
  })

  function setMode(next) {
    const validated = VALID.includes(next) ? next : '3d'
    localStorage.setItem(STORAGE_KEY, validated)
    setModeState(validated)
  }

  return [mode, setMode]
}
