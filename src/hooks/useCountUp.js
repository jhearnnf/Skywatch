import { useEffect, useRef, useState } from 'react'

// Tweens a number for display: `from` → `to` on a cubic ease-out, optionally after a delay.
//
// Extracted because the post-game screen (src/components/CbatGameOver.jsx) now runs two of
// these — the score reveal and the weekly-total increment — and they have to ease on the same
// curve. Two count-ups a few hundred ms apart with different curves read as a glitch rather
// than as a pair.
//
// The returned value is display-only and must never become a source of truth: it is rounded,
// it lags the real number by up to `duration`, and it is mid-flight for most of that. Callers
// render it and keep using the real value for anything that decides something.
//
// Deliberately un-gated for reduced motion, in line with the rest of the CBAT screens.
export default function useCountUp(to, { from = 0, duration = 700, delay = 0 } = {}) {
  const [value, setValue] = useState(from)
  const rafRef = useRef(null)

  useEffect(() => {
    let start = null
    const step = (t) => {
      if (start == null) start = t
      // The delay is spent inside the rAF loop rather than in a setTimeout so that a single
      // cancel on unmount tears down the whole animation, delay included.
      const elapsed = t - start - delay
      if (elapsed < 0) { rafRef.current = requestAnimationFrame(step); return }
      const p = duration > 0 ? Math.min(1, elapsed / duration) : 1
      setValue(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))))
      if (p < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [to, from, duration, delay])

  return value
}
