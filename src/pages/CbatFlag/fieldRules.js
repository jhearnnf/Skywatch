import { generateUniqueSymbols } from './symbols'

// Rules that decide what the player can fairly be asked about on the FLAG field.
// The game's one absolute rule is "if the aircraft carrying callsign XX is on
// screen right now, press YES" — so anything that makes "on screen" or "shown"
// less than literally true is a scoring bug. These helpers are the literal-truth
// machinery, kept pure and out of PlayField so they can be tested directly.

export function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi) }

// ── Traffic density ──────────────────────────────────────────────────────────
// Traffic is tuned for the desktop field, which main.css caps at 56rem × 30rem
// (.cbat-flag-field max-width and the .cbat-flag-columns max-height). A smaller
// field carries proportionally fewer contacts so a phone isn't scored on a
// denser sky than a monitor. Square-rooted and floored, so mobile plays a little
// easier rather than becoming a different game — the full challenge stays on
// desktop, which is where we point people for the real run.
export const REF_FIELD_AREA = 896 * 480
export const MIN_DENSITY_SCALE = 0.7

export function densityScale(w, h) {
  if (!w || !h) return 1
  return clamp(Math.sqrt((w * h) / REF_FIELD_AREA), MIN_DENSITY_SCALE, 1)
}

// Never below 2 — a field with one contact on it isn't the game.
export function scaledAircraftCap(max, w, h) {
  return Math.max(2, Math.round(max * densityScale(w, h)))
}

// ── Callsign issue ───────────────────────────────────────────────────────────
// A callsign is never reused inside a run: two aircraft sharing one would make
// "is XX on screen right now" ambiguous, with no right answer to score. Walk the
// pool in order and mint a fresh unique code if it ever runs dry, rather than
// wrapping back to the start.
export function nextCallsign(pool, index, issued = new Set(), reserved = null) {
  const fromPool = pool?.[index]
  if (fromPool && !issued.has(fromPool)) return fromPool
  const taken = new Set([...(pool ?? []), ...issued, ...(reserved ?? [])])
  return generateUniqueSymbols(1, taken)[0]
}

// ── Visibility ───────────────────────────────────────────────────────────────
// "On screen" for scoring has to mean what the player can actually see. Contacts
// are culled a good margin past the edge so the model flies clear smoothly, but
// they stop counting the moment the ring leaves the visible field.
export function isContactVisible(x, y, w, h, radius) {
  return x > -radius && x < w + radius && y > -radius && y < h + radius
}

// ── Callsign label placement ─────────────────────────────────────────────────
// Labels sit above the aircraft and the field is overflow-hidden, so a contact
// near the top edge would otherwise flash its callsign entirely outside the clip
// — counted as shown by the game, never seen by the player. Keep every label
// inside the field: drop it under the aircraft when there's no room above, and
// clamp x so it is never cut in half at the sides.
export function callsignLabelPos({ x, y, symbol, fontSize, radius, fieldW, fieldH }) {
  const halfWidth = (symbol?.length ?? 0) * fontSize * 0.32 + 2
  const above = y - radius - 6
  return {
    x: clamp(x, halfWidth, Math.max(halfWidth, fieldW - halfWidth)),
    y: above - fontSize >= 0
      ? above
      : Math.min(y + radius + fontSize + 2, Math.max(fontSize, fieldH - 3)),
    halfWidth,
  }
}

// The red "last look before it's gone" box shown while a contact is leaving.
export function leavingBoxPos({ x, y, symbol, radius, fieldW, fieldH }) {
  const width = (symbol?.length ?? 0) * 9 + 12
  const height = 17
  const above = y - radius - 22
  return {
    x: clamp(x - width / 2, 2, Math.max(2, fieldW - width - 2)),
    y: above >= 2
      ? above
      : Math.min(y + radius + 5, Math.max(2, fieldH - height - 2)),
    width,
    height,
  }
}
