import { useCallback, useEffect, useRef, useState } from 'react'
import { useCbatTheme } from './useCbatTheme'

// Keyboard answering for the multiple-choice CBAT games, the way the real
// keyboard works: the number pad picks a numbered option, the black letter
// keys pick a lettered one, and the blue arrow key (Enter here) commits.
//
// `kind` is which labels the options carry: 'number' (1-9), 'letter' (A-G,
// the real keyboard's lettered keys) or 'both'. `count` caps how many are
// live, so a stray "7" on a five-option question does nothing.
//
// Keys are ignored while the user is typing in a field, while a dialog (the
// quit prompt) is open, and when a modifier is held, so browser shortcuts and
// the typed-answer games keep working untouched.

const LETTERS = 'abcdefg'

export function answerKeyIndex(e, kind, count) {
  if (e.altKey || e.ctrlKey || e.metaKey) return -1
  const key = e.key
  if ((kind === 'number' || kind === 'both') && /^[1-9]$/.test(key)) {
    const i = Number(key) - 1
    return i < count ? i : -1
  }
  if ((kind === 'letter' || kind === 'both') && key.length === 1) {
    const i = LETTERS.indexOf(key.toLowerCase())
    return i >= 0 && i < count ? i : -1
  }
  return -1
}

function typingTarget(el) {
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function useCbatAnswerKeys({ enabled = true, count = 0, kind = 'number', onPick, onEnter, onEscape } = {}) {
  // Handlers ride in refs so the listener is attached once per enable and
  // never sees a stale question.
  const pickRef = useRef(onPick); pickRef.current = onPick
  const enterRef = useRef(onEnter); enterRef.current = onEnter
  const escRef = useRef(onEscape); escRef.current = onEscape

  useEffect(() => {
    if (!enabled) return
    function onKey(e) {
      if (typingTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'Enter') {
        if (enterRef.current) { e.preventDefault(); enterRef.current() }
        return
      }
      if (e.key === 'Escape') {
        if (escRef.current) { e.preventDefault(); escRef.current() }
        return
      }
      const i = answerKeyIndex(e, kind, count)
      if (i >= 0 && pickRef.current) { e.preventDefault(); pickRef.current(i) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, count, kind])
}

// A multiple-choice question's answer flow, in both themes.
//
// SkyWatch theme: picking an option (click or key) commits it at once, which is
// how every game has always behaved. Real CBAT theme: picking only marks the
// option as "Your Answer"; Enter, or the on-screen arrow key in the footer
// strip, commits it — "Enter or change your answer, then press ->". `pending`
// is the marked index for the game to highlight, and it clears whenever
// `resetKey` (normally the question index) moves on.
export function useCbatMcq({ enabled = true, count = 0, kind = 'number', onCommit, resetKey } = {}) {
  const cbat = useCbatTheme()
  const [pending, setPendingState] = useState(null)
  // Mirrored in a ref so a rapid key-then-Enter commits what was just picked
  // rather than whatever the last render saw.
  const pendingRef = useRef(null)
  const setPending = useCallback((v) => { pendingRef.current = v; setPendingState(v) }, [])
  const commitRef = useRef(onCommit); commitRef.current = onCommit

  useEffect(() => { setPending(null) }, [resetKey, enabled, setPending])

  const select = useCallback((i) => {
    if (!enabled) return
    if (cbat) setPending(i)
    else commitRef.current?.(i)
  }, [enabled, cbat, setPending])

  const commit = useCallback(() => {
    if (!enabled) return
    const p = pendingRef.current
    if (p == null) return
    setPending(null)
    commitRef.current?.(p)
  }, [enabled, setPending])

  useCbatAnswerKeys({ enabled, count, kind, onPick: select, onEnter: cbat ? commit : undefined })

  return { cbat, pending, select, commit }
}

export default useCbatAnswerKeys
