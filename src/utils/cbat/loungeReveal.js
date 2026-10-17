// The phone hub's lounge reveal: the maths behind the scroll between the game
// grid and the CBAT chat panel under it (see hooks/useLoungeScrollSnap.js and
// components/cbat/LoungeReveal.jsx).
//
// Everything here is a pure function of `p`, the reveal's progress: 0 with the
// menu in view, 1 with the whole lounge in view. Nothing is timed. That is what
// lets a finger held mid-swipe freeze the animation exactly where it is, and
// what lets the wheel's auto-scroll play it forwards or backwards just by
// moving the page.
//
// Every value is an opacity or a transform, deliberately: those are the two
// properties the browser can animate on the compositor without repainting,
// which is what keeps a scroll-scrubbed animation smooth on a phone.

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

// A 0..1 window of p, eased.
const span = (p, from, to) => easeOutCubic(clamp01((p - from) / (to - from)))

// How far through the reveal a scroll position is. Null bounds mean a screen
// tall enough that the lounge is already in view without scrolling to it, so
// it reads as fully revealed rather than leaving the panel undrawn.
export function revealProgress(y, bounds) {
  if (!bounds) return 1
  return clamp01((y - bounds.start) / (bounds.end - bounds.start))
}

// Where an unattended page should come to rest: the end it was last heading
// for, or nowhere if it is already resting on one. The 2px slack absorbs the
// sub-pixel scroll positions high-DPI screens report.
export function snapTarget(y, bounds, dir) {
  if (!bounds) return null
  if (y <= bounds.start + 2 || y >= bounds.end - 2) return null
  return dir < 0 ? bounds.start : bounds.end
}

// How much of the lit heading shows at progress p: light fills the word in
// from both ends towards the middle. `edgePct` is how far in from each end the
// fill has reached. It starts a feather's width outside the word, so nothing
// is lit on the menu, and ends at 50, where the two fills meet and the word is
// lit end to end. The lit word sits exactly on the ghost one and only its mask
// moves, so there is only ever one word on screen.
export const HEADING_FEATHER = 8
export function headingFill(p) {
  return { edgePct: lerp(-HEADING_FEATHER, 50, span(p, 0.05, 0.85)) }
}
export function headingMask(p) {
  const a = headingFill(p).edgePct
  const f = HEADING_FEATHER
  // Fully lit is still a mask, one that hides nothing, rather than none at
  // all: switching a mask on is a new compositor layer, and doing that on the
  // first frame of a glide out of the lounge made the glide catch.
  if (a >= 50) return 'linear-gradient(#000, #000)'
  const pct = (v) => `${v.toFixed(2)}%`
  // Once the two soft edges overlap, the middle stop carries whatever alpha
  // the ramps have reached there, rather than letting out-of-order stops snap.
  const middle = a + f <= 50
    ? `transparent ${pct(a + f)}, transparent ${pct(100 - a - f)}`
    : `rgba(0,0,0,${((a + f - 50) / f).toFixed(3)}) 50%`
  // No fixed 0% / 100% stops: a gradient holds its first and last colours out
  // to the edges anyway, and a 0% stop ahead of the fill's negative start
  // would be out of order.
  return `linear-gradient(90deg, #000 ${pct(a)}, ${middle}, #000 ${pct(100 - a)})`
}

// The chevron that says "swipe down" gives way as the reveal gets under way.
export const chevronOpacity = (p) => 1 - clamp01(p / 0.4)
export const eyebrowOpacity = (p) => 0.55 + 0.45 * clamp01(p / 0.6)
// The hairlines either side of the eyebrow reach out a little towards the
// edges. Kept modest: at 1.6x the row is still narrower than a 375px phone's
// column, and a transform that spilled past it would add sideways scroll.
export const hairlineScale = (p) => 1 + 0.6 * span(p, 0.1, 0.9)

// The lit word's glow, on its own layer so it can fade in by opacity alone.
// The mask that fills the word would otherwise cut the glow off square at the
// word's edges, then let it spill out all at once when the mask comes off.
export const headingGlow = (p) => span(p, 0.3, 0.95)

// The chat panel scales up a touch into place as it fades in, and a faint
// scan line passes down it as it does. Nothing in it moves DOWN: a transformed
// box that reaches past the panel's foot makes the page taller, which once
// opened an empty strip under the chat for the glide to scroll into. The scale
// is anchored at the top, so it only ever shrinks the panel inside its own box,
// and the scan line is placed in pixels inside the panel by its caller.
export function panelReveal(p) {
  const t = span(p, 0.05, 0.85)
  const q = clamp01((p - 0.1) / 0.8)
  return {
    opacity: t,
    scale: 0.96 + 0.04 * t,
    scan: q,
    scanOpacity: q <= 0 || q >= 1 ? 0 : Math.sin(Math.PI * q) * 0.6,
    done: p >= 1,
  }
}
