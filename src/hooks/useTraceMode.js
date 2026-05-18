import { useState } from 'react'

const STORAGE_KEY = 'cbat:trace:mode'
// The leaderboard page still reads `cbat:plane-turn:mode` via usePlaneTurnMode
// for its 2D/3D toggle; we mirror Practise selections back to it so both
// surfaces stay in sync.
const LEGACY_KEY  = 'cbat:plane-turn:mode'
const VALID = ['2d', '3d', 'trace1', 'trace2']
// Trace 1 is the headline mode of /cbat/trace — first-time visitors land on
// it. Once a user explicitly picks a Practise mode (or returns to Trace 1)
// their choice is persisted in localStorage and used on subsequent visits.
const DEFAULT = 'trace1'

function readInitial() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (VALID.includes(stored)) return stored
  return DEFAULT
}

export function useTraceMode() {
  const [mode, setModeState] = useState(readInitial)

  function setMode(next) {
    const validated = VALID.includes(next) ? next : DEFAULT
    localStorage.setItem(STORAGE_KEY, validated)
    if (validated === '2d' || validated === '3d') {
      localStorage.setItem(LEGACY_KEY, validated)
    }
    setModeState(validated)
  }

  return [mode, setMode]
}
