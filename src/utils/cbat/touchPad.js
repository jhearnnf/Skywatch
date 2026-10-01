// The on-screen thumb pad for the rate-control games (SMA, RTT): a finger held
// on the pad and moved away from where it landed is a stick deflected that far.
//
// Moved out of smaInput.js, unchanged, when RTT got the same pad — smaInput
// already imports from rttInput, so RTT importing it back would have been a
// cycle.

import { applyCurve, clamp1, STICK_DEAD_ZONE, STICK_EXPO } from './gamepad'

// How far a finger must travel from where it landed for full deflection, as a
// fraction of the pad's SHORTER side. A third means full deflection is a
// comfortable thumb sweep and the fine control lives in the first few
// millimetres, which is where a tracking task needs it.
export const PAD_RADIUS_FRACTION = 1 / 3

// Where a pad gesture is centred. The origin is where the finger LANDED, not the
// middle of the pad: a fixed centre would have to be found by feel every time,
// and on a compensatory task the first correction is the one that matters.
//
// Pulled inward so a full-deflection circle always fits inside the pad —
// otherwise a gesture started near an edge could never reach full deflection
// outward, and the dot would be uncorrectable in exactly one direction.
export function clampPadOrigin(clientX, clientY, rect, radius) {
  const minX = rect.left + radius
  const maxX = rect.right - radius
  const minY = rect.top + radius
  const maxY = rect.bottom - radius
  return {
    // max/min ordering matters when the pad is narrower than 2×radius: the
    // clamp then collapses to the centre rather than inverting.
    x: minX > maxX ? (rect.left + rect.right) / 2 : Math.min(maxX, Math.max(minX, clientX)),
    y: minY > maxY ? (rect.top + rect.bottom) / 2 : Math.min(maxY, Math.max(minY, clientY)),
  }
}

export function padRadius(rect) {
  return Math.max(1, Math.min(rect.width, rect.height) * PAD_RADIUS_FRACTION)
}

// Finger position → deflection. Curved through the same applyCurve the stick and
// the mouse go through, so a thumb behaves like a stick rather than like a
// different game.
export function padAxes(clientX, clientY, origin, radius, opts = {}) {
  const { deadZone = STICK_DEAD_ZONE, expo = STICK_EXPO } = opts
  const r = Math.max(1, radius)
  return {
    x: applyCurve(clamp1((clientX - origin.x) / r), deadZone, expo),
    y: applyCurve(clamp1((clientY - origin.y) / r), deadZone, expo),
  }
}

