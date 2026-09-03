// Geometry and grouping for the admin presence dots on the CBAT hub. Split from
// the component so the arithmetic is testable on its own, and so the component
// file exports nothing but a component.

// In px. The dot is small on purpose — it is an overlay on artwork with a title
// and a description under it, and anything bigger reads as part of the card.
// GAP stacks the second and third person on a tile leftwards along its top edge.
export const DOT   = 9
export const GAP   = 12
export const INSET = 7

// Past this many on one tile the dots stop being countable and start being a
// smear, so the rest become "+n". Four fits inside the 80px phone tile with
// room before the corner radius.
export const MAX_DOTS = 4

// Who to draw, and where in the stack.
//
// Ordered by the server's most-recent-beat-first list, so on a busy tile it is
// the person who just arrived who gets the slot nearest the corner. Anyone
// whose heartbeat did not come from a game page has no `cbatCard` and no dot.
export function presenceSlots(online = [], max = MAX_DOTS) {
  const byCard = new Map()
  for (const u of online) {
    const card = u?.cbatCard
    if (!card) continue
    if (!byCard.has(card)) byCard.set(card, [])
    byCard.get(card).push(u)
  }

  const slots = []
  for (const [card, users] of byCard) {
    const shown = users.slice(0, max)
    shown.forEach((u, index) => {
      // Keyed by the person, which is the whole mechanism: the same key at a
      // new card position is the same DOM element, so it slides across the grid
      // rather than blinking out of one tile and into another.
      slots.push({ key: `agent:${u._id}`, kind: 'dot', card, index })
    })
    if (users.length > shown.length) {
      // Keyed by card rather than by anyone in it: this mark is a count, not a
      // person, so it must not glide anywhere when the people behind it change.
      slots.push({
        key:   `more:${card}`,
        kind:  'more',
        card,
        index: shown.length,
        count: users.length - shown.length,
      })
    }
  }
  return slots
}

// Where a slot sits, in the overlay's coordinates. `card` is the tile's measured
// { left, top, width }; dots run in from its top-right corner.
export function slotPosition(card, index) {
  return {
    x: card.left + card.width - INSET - DOT - index * GAP,
    y: card.top + INSET,
  }
}
