import { useCallback, useEffect, useRef, useState } from 'react'

// Personal best for whichever board is selected, cached per game key.
//
// A game that ships modes has a board per mode, each with its own collection, so
// the best has to be refetched every time the row changes. Two things went wrong
// when each page did that by hand:
//
//   • `if (d.data) setPersonalBest(d.data)` left the previous board's number on
//     screen when the new board had no runs — your Easier score, labelled Hard.
//   • A single `personalBest` state went null between boards, which unmounted
//     the panel and made the card jump.
//
// Caching per key fixes both. A key that has resolved stays resolved, so
// flipping back to a board you have already looked at is instant with no
// placeholder at all; a key that has never resolved reports `loading` so the
// panel can hold its height instead of vanishing. Late responses land on their
// own key, so switching quickly can't leave one board's answer under another's
// name.

export function useCbatPersonalBest(gameKey, { user, apiFetch, API }) {
  // gameKey → best object, or null for "asked, and there are no runs".
  const [cache, setCache] = useState({})
  // Re-set to true on every mount, not just initialised once. StrictMode mounts,
  // unmounts and mounts again in development, so a ref that is only ever turned
  // OFF by a cleanup is false for the rest of the component's life — every
  // response then gets discarded, the key never lands in the cache, and the
  // panel sits on its loading placeholder forever. Which is exactly what
  // happened.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const load = useCallback((key) => {
    if (!user || !key) return
    apiFetch(`${API}/api/games/cbat/${key}/personal-best`)
      .then(r => r.json())
      .then(d => {
        if (!aliveRef.current) return
        setCache(prev => ({ ...prev, [key]: d?.data ?? null }))
      })
      .catch(() => {
        // A failed fetch must not pin the panel on its placeholder forever.
        if (aliveRef.current) setCache(prev => (key in prev ? prev : { ...prev, [key]: null }))
      })
  }, [user, apiFetch, API])

  useEffect(() => { load(gameKey) }, [gameKey, load])

  return {
    best: cache[gameKey] ?? null,
    // Only before this board has ever answered. A board known to be empty is
    // not loading, it is empty, and says so.
    loading: !!user && !!gameKey && !(gameKey in cache),
    // Call after a run to pull the new best in. Takes a key so a run can refresh
    // the board it was actually played on, not whatever is selected now.
    refresh: useCallback((key = gameKey) => load(key), [load, gameKey]),
  }
}

export default useCbatPersonalBest
