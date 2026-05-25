import { useCallback, useEffect, useRef } from 'react'
import { captureEvent } from '../../lib/posthog'
import { useAuth } from '../../context/AuthContext'
import { recordCbatStart } from './recordStart'

// Shared lifecycle tracker for CBAT games. Each game calls start(gameKey) when
// the player actually begins (after instructions), markCompleted(...) when
// the result is submitted, and the hook itself fires game_abandoned on unmount
// or pagehide if the game was in progress and never completed.
//
// Events fired into PostHog:
//   game_started   { gameKey }
//   game_completed { gameKey, durationMs, round?, ...extra }
//   game_abandoned { gameKey, durationMs, round?, reason }
//
// `round` is optional — games that have rounds call setRound(n) so the last
// reached round is captured on abandon.
export function useCbatTracking() {
  const { apiFetch, API } = useAuth()
  const stateRef = useRef({
    gameKey: null,
    startedAt: null,
    completed: false,
    lastRound: null,
    meta: {},
  })

  const start = useCallback((gameKey, meta = {}) => {
    stateRef.current = {
      gameKey,
      startedAt: Date.now(),
      completed: false,
      lastRound: null,
      meta,
    }
    captureEvent('game_started', { gameKey, ...meta })
    recordCbatStart(gameKey, apiFetch, API)
  }, [apiFetch, API])

  const setRound = useCallback((round) => {
    if (round == null) return
    if (!stateRef.current.startedAt) return
    stateRef.current.lastRound = round
  }, [])

  const markCompleted = useCallback((extra = {}) => {
    const s = stateRef.current
    if (!s.startedAt || s.completed) return
    s.completed = true
    const durationMs = Date.now() - s.startedAt
    const { round, ...rest } = extra
    const roundOut = round != null ? round : s.lastRound
    captureEvent('game_completed', {
      gameKey: s.gameKey,
      durationMs,
      ...s.meta,
      ...(roundOut != null ? { round: roundOut } : {}),
      ...rest,
    })
  }, [])

  useEffect(() => {
    function fireAbandon(reason) {
      const s = stateRef.current
      if (!s.startedAt || s.completed) return
      const durationMs = Date.now() - s.startedAt
      captureEvent('game_abandoned', {
        gameKey: s.gameKey,
        durationMs,
        reason,
        ...s.meta,
        ...(s.lastRound != null ? { round: s.lastRound } : {}),
      })
      // Prevent the unmount handler from double-firing after pagehide.
      s.completed = true
    }
    function onPageHide() { fireAbandon('pagehide') }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      fireAbandon('unmount')
    }
  }, [])

  return { start, setRound, markCompleted }
}
