import { useCallback, useState } from 'react'

const STORAGE_KEY = 'skywatch.cbatLounge.open'

// Whether the CBAT lounge chat is expanded, remembered across visits.
//
// Its own file rather than a second export from CbatLoungeChat.jsx because the
// CBAT page needs it too: the 60/40 split between Recent Scores and the chat
// only applies while the chat is open, so the column and the widget have to
// read one piece of state.
export function useLoungeOpen() {
  // Anything but an explicit "closed" opens it. A first-time visitor should see
  // the room rather than a tab they have to discover.
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== 'closed' } catch { return true }
  })

  const set = useCallback((next) => {
    setOpen(next)
    try { localStorage.setItem(STORAGE_KEY, next ? 'open' : 'closed') } catch { /* storage unavailable */ }
  }, [])

  return [open, set]
}

export default useLoungeOpen
