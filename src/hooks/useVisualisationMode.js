import { useState } from 'react'

const STORAGE_KEY = 'cbat:visualisation:mode'
const VALID = ['2d', '3d']
const DEFAULT = '2d'

function readInitial() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (VALID.includes(stored)) return stored
  return DEFAULT
}

export function useVisualisationMode() {
  const [mode, setModeState] = useState(readInitial)

  function setMode(next) {
    const validated = VALID.includes(next) ? next : DEFAULT
    localStorage.setItem(STORAGE_KEY, validated)
    setModeState(validated)
  }

  return [mode, setMode]
}
