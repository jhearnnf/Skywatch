// Detect coarse-pointer / touch-capable devices. Memoised because the result
// can change only via dev tools; recomputing per render is wasteful.
let cached = null

export function isTouchDevice() {
  if (cached !== null) return cached
  if (typeof window === 'undefined') return false
  cached =
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    window.matchMedia?.('(pointer: coarse)').matches === true
  return cached
}
