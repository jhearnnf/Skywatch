// How an ACT aircraft sits in the air while the player steers it.
//
// The flight model only ever produces a heading — the ball has no attitude,
// because a ball doesn't need one. An aircraft does: one that yaws flat around
// a corner with its wings level reads as a cardboard cutout being dragged
// sideways, which is exactly how the first pass looked.
//
// So the attitude is derived from the heading rather than from the input. The
// rate the heading is turning at IS how hard the player is pulling, whichever
// device they pulled with — mouse, touch pad, arrow keys or stick — so none of
// this needs to know which one is connected, and adding a fifth would not touch
// this file.
//
// Two angles come out:
//   bank — roll about the direction of flight, into the turn.
//   aoa  — the nose held a little above or below the flight path while
//          climbing or diving. Small on purpose; it is a hint of loading up,
//          not a separate manoeuvre.
//
// Both are lagged behind the steering. Input in this game arrives in flicks
// (a mouse drag can bank a whole frame's worth of rotation at once, capped at
// MAX_ROT_PER_TICK), so mapping rate straight to angle would strobe. The filter
// is what turns those flicks into something that looks like an aircraft rolling.

// Radians of bank per rad/s of turn. A sustained turn in ACT runs at roughly
// 1.2 rad/s, which this puts at about 34° of bank — enough to read clearly from
// behind without the wings blocking the shape gate being aimed at.
export const BANK_PER_RATE = 0.5
export const MAX_BANK = 0.75          // 43°

// Angle of attack is deliberately a tenth of the bank. Pitch changes in ACT are
// small and constant; anything more emphatic and the nose hides the tunnel.
export const AOA_PER_RATE = 0.25
export const MAX_AOA = 0.2            // 11°

// Seconds for the angle to cover ~63% of the distance to its target. Slow
// enough to smooth a flicked mouse, fast enough that the roll still feels
// attached to the hand that caused it.
export const ATTITUDE_TAU = 0.12

const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v))

// Exponential approach, framerate-independent — the same angle comes out after
// a given number of SECONDS whether the browser served 30 frames or 120.
export function approach(current, target, dt, tau = ATTITUDE_TAU) {
  if (!(dt > 0)) return current
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

// yawRate  — rad/s the heading is swinging across the wing line; + is a turn to
//            the player's right.
// pitchRate — rad/s the heading is swinging up or down; + is the nose rising.
export function bankTarget(yawRate) {
  return clamp((yawRate || 0) * BANK_PER_RATE, MAX_BANK)
}

export function aoaTarget(pitchRate) {
  return clamp((pitchRate || 0) * AOA_PER_RATE, MAX_AOA)
}

// Holds the lagged angles across frames. One per mounted craft.
export function createCraftAttitude() {
  let bank = 0
  let aoa = 0
  return {
    update(yawRate, pitchRate, dt) {
      bank = approach(bank, bankTarget(yawRate), dt)
      aoa = approach(aoa, aoaTarget(pitchRate), dt)
      return { bank, aoa }
    },
    value() { return { bank, aoa } },
  }
}

// Rate of turn from one frame's change of heading, split into the wing line and
// the vertical. Takes anything with x/y/z, so THREE vectors drop straight in.
export function turnRates(prev, next, right, up, dt) {
  if (!(dt > 0)) return { yawRate: 0, pitchRate: 0 }
  const dx = next.x - prev.x
  const dy = next.y - prev.y
  const dz = next.z - prev.z
  return {
    yawRate: (dx * right.x + dy * right.y + dz * right.z) / dt,
    pitchRate: (dx * up.x + dy * up.y + dz * up.z) / dt,
  }
}
