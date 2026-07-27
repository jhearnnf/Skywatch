// How much of a demo card's stage is worth showing.
//
// A game whose layout is much narrower than the stage reads as a postage stamp
// in the middle of the tile: the Trace practise arena is a 448px square inside
// a 900px stage, so half the card was empty gutter and the aircraft ended up a
// dozen pixels across. A pool entry can declare a `focus` box — the part of the
// stage worth showing, in stage pixels — and the card zooms in on it, cropping
// the gutters instead of shrinking the game.
//
// The zoom never magnifies past what the focus box needs, so one declaration
// covers both stages: on the phone stage, where these games already fill their
// width, the answer comes back as 1 and nothing changes.
//
// Kept out of DemoGameCard.jsx so that file only exports its component
// (fast refresh), same as demoStubs.js.

const MAX_ZOOM = 2

export function frameFor(stage, focus) {
  if (!focus?.w || !focus?.h) return { zoom: 1, offsetY: 0 }
  const zoom = Math.min(MAX_ZOOM, Math.max(1, Math.min(stage.w / focus.w, stage.h / focus.h)))
  // Centre the visible slice on the focus box vertically (horizontally these
  // games centre themselves), without ever scrolling past the stage.
  const visibleH = stage.h / zoom
  const centreY = (focus.top ?? 0) + focus.h / 2
  const offsetY = Math.max(0, Math.min(stage.h - visibleH, centreY - visibleH / 2))
  return { zoom, offsetY }
}
