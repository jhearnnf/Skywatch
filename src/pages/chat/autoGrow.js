import { useLayoutEffect } from 'react'

// Roughly eight lines at the composer's text size. Only applied on phones,
// where a box that kept growing would push the thread off the screen. On
// desktop the box always shows everything typed: scrolling inside it while
// writing a long message is annoying, and the thread has room to give.
const MOBILE_MAX_HEIGHT = 160

export function maxGrowHeight() {
  const mobile = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 600px)').matches
  return mobile ? MOBILE_MAX_HEIGHT : Infinity
}

// Sizes a textarea to fit its text every time the text changes. A fixed-row
// textarea hides everything above the last line once the message wraps.
//
// scrollHeight excludes the border but the box is border-box, so the border
// has to be added back or the text is always 2px taller than the box: a
// scrollbar that can barely move, which Android draws prominently.
export function useAutoGrow(ref, value) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const border = el.offsetHeight - el.clientHeight
    el.style.height = `${Math.min(el.scrollHeight + border, maxGrowHeight())}px`
  }, [ref, value])
}
