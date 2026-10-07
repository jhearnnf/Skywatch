import { useEffect } from 'react'

// Whether `el` is a scroll box that can still move `dy` pixels' way.
function canScroll(el, dy) {
  const { overflowY } = getComputedStyle(el)
  if (overflowY !== 'auto' && overflowY !== 'scroll') return false
  if (el.scrollHeight <= el.clientHeight + 1) return false
  return dy > 0
    ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
    : el.scrollTop > 0
}

// Keeps the mouse wheel inside a panel: over it, the wheel scrolls whatever
// box is under the pointer and never the page behind.
//
// Without this, two things leak through to the page. A list that is already at
// its end (the lounge chat sits at the bottom, where the newest messages are)
// hands the rest of the wheel on to the page, and so does every part of the
// panel that is not a scroll box at all (headers, the composer). On /cbat that
// moved the game grid while the pointer was plainly over the chat.
//
// Only cancels the wheel when nothing under the pointer can use it, so a list
// that can scroll still scrolls natively, smooth scrolling and all. Ctrl+wheel
// is left alone: that is the browser's zoom.
export function useContainWheel(ref, enabled = true) {
  useEffect(() => {
    const root = ref.current
    if (!enabled || !root) return
    const onWheel = (e) => {
      if (e.ctrlKey || !e.deltaY) return
      for (let el = e.target; el && el !== root.parentElement; el = el.parentElement) {
        if (el instanceof Element && canScroll(el, e.deltaY)) return
      }
      e.preventDefault()
    }
    // Non-passive, or preventDefault is ignored.
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [ref, enabled])
}

export default useContainWheel
