import { useEffect, useState } from 'react'

// True when the device is touch-first OR the viewport is mobile-narrow. The
// touch-steer pads (ACT, the Instruments Practise drill) render on this.
// Re-evaluates on matchMedia change + resize so rotating/resizing a hybrid
// device updates the UI live.
//
// Moved here from CbatAct.jsx, unchanged, when the Instruments drill needed it.
function computeIsTouch() {
  if (typeof window === 'undefined') return false
  const coarse = typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: none) and (pointer: coarse)').matches
  const narrow = window.innerWidth <= 600
  return coarse || narrow
}

export function useIsTouch() {
  const [isTouch, setIsTouch] = useState(computeIsTouch)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setIsTouch(computeIsTouch())
    const mql = typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: none) and (pointer: coarse)')
      : null
    mql?.addEventListener?.('change', update)
    window.addEventListener('resize', update)
    return () => {
      mql?.removeEventListener?.('change', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return isTouch
}

export default useIsTouch
