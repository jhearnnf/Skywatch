import { useEffect, useState } from 'react'

// Geometry for a side column that must not move when the page scrolls.
//
// `position: sticky` is the obvious tool and it is the wrong one here, for two
// reasons that both show up as movement:
//
//   • It only pins once the page has scrolled far enough for the element to
//     reach its `top` offset. Before that the column travels up the screen with
//     everything else, and a full-viewport height set in CSS hangs off the
//     bottom of the screen — which is what put the lounge composer out of reach.
//   • A sticky element cannot leave its containing block. Near the end of a long
//     page the row it sits in runs out and the column is dragged up and away
//     again, however far from the bottom the viewport is.
//
// `position: fixed` has neither problem, at the cost of needing its own
// geometry: a fixed element is out of flow, so the numbers come from a spacer
// left behind in the layout. `top` is the spacer's DOCUMENT offset — the place
// the column would sit with the page unscrolled — so the panel stays exactly
// where it first appeared rather than jumping under the header.
//
// Recomputed on scroll as well as resize, even though the answer does not
// change while scrolling: it is one rect read on an animation frame, and it
// means any layout shift elsewhere (a body-class width change, a font landing,
// an image loading) is corrected on the next frame instead of leaving the
// column parked in the wrong place.
export function useFixedColumn(spacerRef, { bottom = 16, min = 360 } = {}) {
  const [box, setBox] = useState(null)

  useEffect(() => {
    const el = spacerRef.current
    if (!el || typeof window === 'undefined') return

    let frame = 0
    const measure = () => {
      frame = 0
      const rect = el.getBoundingClientRect()
      // A spacer that is not being rendered (below the breakpoint that shows
      // the column) measures as nothing. Leave the geometry unset rather than
      // publishing zeroes.
      if (!rect.width) { setBox(null); return }

      // rect.top moves with the page; adding the scroll position back gives the
      // document offset, which does not. That is the viewport position the
      // column occupied before anyone scrolled, and where it stays.
      const top = Math.round(rect.top + window.scrollY)
      const next = {
        top,
        left:   Math.round(rect.left),
        width:  Math.round(rect.width),
        height: Math.max(min, Math.round(window.innerHeight - top - bottom)),
      }
      setBox(prev => (
        prev && prev.top === next.top && prev.left === next.left
          && prev.width === next.width && prev.height === next.height
          ? prev
          : next
      ))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }

    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    // Catches the layout changes a scroll or resize never reports — the CBAT
    // page widens its own container from an effect, which happens after this
    // one has already measured.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    observer?.observe(el)
    observer?.observe(document.body)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [spacerRef, bottom, min])

  return box
}

export default useFixedColumn
