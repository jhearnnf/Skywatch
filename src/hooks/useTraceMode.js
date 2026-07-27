import { useState } from 'react'

const STORAGE_KEY = 'cbat:trace:mode'
export const TRACE_MODES = ['2d', '3d', 'trace1', 'trace2']
const VALID = TRACE_MODES
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
    setModeState(validated)
  }

  return [mode, setMode]
}
