import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DOT, presenceSlots, slotPosition } from './cbatPresenceSlots'

// Who is in which game, drawn straight onto the hub. Admin only — the caller
// does that gating, because the presence data itself is admin-only (see GET
// /api/chat/presence for why nobody else gets to see when people are at their
// computers).
//
// One dot per person, floated over the top-right corner of the tile they are
// on. The movement is the point: the dots live in a single overlay layer
// spanning the grid rather than inside the tiles, so when someone leaves Target
// for ACT their dot is the *same element* at a new position and it slides
// across the page. A dot rendered inside each tile could not do that — React
// would unmount one and mount another, and the two events would look unrelated.
//
// Positions come from offsetLeft/offsetTop rather than getBoundingClientRect,
// which matters more than it looks: the tiles mount with a staggered framer
// entrance that translates them 14px upwards, and a rect would measure them
// mid-flight and leave every dot sitting slightly high. Offsets are layout
// truth and ignore transforms.
export default function CbatPresenceDots({ containerRef, online = [] }) {
  // card key → { left, top, width } in the container's own coordinates.
  const [cards, setCards] = useState({})

  const measure = useCallback(() => {
    const el = containerRef?.current
    if (!el) return
    const next = {}
    for (const node of el.querySelectorAll('[data-cbat-card]')) {
      next[node.dataset.cbatCard] = {
        left:  node.offsetLeft,
        top:   node.offsetTop,
        width: node.offsetWidth,
      }
    }
    // A ResizeObserver fires on every pixel of a window drag, and most of those
    // ticks move nothing here (a taller grid does not move the tiles above the
    // change). Bailing on an identical measurement keeps a resize from
    // re-rendering the overlay a hundred times.
    setCards(prev => (sameCards(prev, next) ? prev : next))
  }, [containerRef])

  useEffect(() => {
    const el = containerRef?.current
    if (!el) return

    // The first measurement is a frame late rather than synchronous, which is
    // deliberate on both counts: reading layout in an effect body and setting
    // state from it is the cascading-render pattern React warns about, and a
    // dot with nothing measured yet renders as nothing at all (see the null
    // below) rather than as a mark in the wrong corner. One frame later it
    // fades in where it belongs.
    const raf = requestAnimationFrame(measure)

    // The grid reflows on every width change — two columns to four, and the
    // phone tile sizes in between — and a stale measurement would leave the
    // dots hanging in the gutter. The observer also fires once on observe,
    // which covers any layout that settles after that first frame.
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [containerRef, measure])

  return (
    <div
      // Purely decorative and strictly non-interactive: the layer sits over
      // every tile, and anything clickable here would eat taps meant for the
      // game underneath — and swallow the hover that opens the Trace and
      // Visualisation mode splits.
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
      data-testid="cbat-presence-dots"
    >
      <AnimatePresence initial={false}>
        {presenceSlots(online).map((slot) => {
          const card = cards[slot.card]
          // Either nothing is measured yet, or the game has no tile on the hub
          // — a hidden game still has players, namely the admin testing it.
          if (!card) return null

          const { x, y } = slotPosition(card, slot.index)

          return (
            <motion.span
              key={slot.key}
              data-cbat-dot={slot.card}
              data-dot-kind={slot.kind}
              className="absolute left-0 top-0 flex items-center justify-center rounded-full bg-emerald-600 text-[7px] font-bold text-[#04120a]"
              style={{
                width:  slot.kind === 'more' ? 'auto' : DOT,
                height: DOT,
                // Room for two digits, and none at all for a plain dot, which
                // has to stay perfectly round.
                paddingInline: slot.kind === 'more' ? 3 : 0,
                // The tiles are blurred photographs under a blue wash, and a
                // flat 9px circle disappears into the busier ones. The ring is
                // the card surface colour, so the dot reads as sitting on top
                // of the art rather than in it.
                boxShadow: '0 0 0 1.5px #0c1829, 0 0 8px rgba(74,222,128,0.75)',
              }}
              initial={{ opacity: 0, scale: 0.3, x, y }}
              animate={{ opacity: 1, scale: 1, x, y }}
              exit={{ opacity: 0, scale: 0.3 }}
              transition={{
                // The glide between tiles. Slow enough to follow by eye across
                // the width of the grid — the movement is the information, so it
                // is worth watching rather than snapping.
                x:       { type: 'spring', stiffness: 90, damping: 16 },
                y:       { type: 'spring', stiffness: 90, damping: 16 },
                opacity: { duration: 0.25 },
                scale:   { duration: 0.25 },
              }}
            >
              {slot.kind === 'more' ? `+${slot.count}` : null}
            </motion.span>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

// Same tiles in the same places? Compared field by field rather than by
// JSON.stringify so key order can never make two identical measurements look
// different.
function sameCards(a, b) {
  const keys = Object.keys(b)
  if (Object.keys(a).length !== keys.length) return false
  return keys.every((k) => {
    const p = a[k]
    const n = b[k]
    return p && p.left === n.left && p.top === n.top && p.width === n.width
  })
}
