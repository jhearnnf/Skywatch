// Rudder pedals for the one CBAT game flown on them: the Sensory Motor
// Apparatus Test, where the pedals own the lateral axis and the stick owns
// the vertical one.
//
// The same principle as gamepad.js, for the same reason: nobody working on
// this has the pedals, and even if they did, a browser cannot tell a rudder
// axis from a toe brake or a throttle without being shown. So the pedals are
// LEARNED. The player rests their feet, pushes the right pedal, pushes the
// left pedal, and whichever axis on whichever device travelled furthest
// between those two is the rudder. That is deliberately measured across EVERY
// connected gamepad rather than a chosen one, because the T.Flight pedals
// enumerate as their own device on a USB lead but as three extra axes on the
// stick's device when daisy-chained into a T.Flight HOTAS, and the calibration
// should not care which.
//
// Downstream sees one number:
//
//   const pedals = createPedalReader()
//   pedals.poll()                 // once per frame
//   pedals.x()                    // calibrated, dead-zoned, curved, [-1,1]
//
// +x is RIGHT pedal forward, which moves the dot right in smaSim. There is no
// default profile and no guess: uncalibrated pedals are not read at all. A
// guessed axis on a pedal set is a toe brake steering the dot, and a wrong
// guess here is worse than none because nothing about it looks broken.

import {
  applyCurve, clamp1, normaliseAxis, listPads, loadPedalProfile,
  STICK_DEAD_ZONE, STICK_EXPO, STICK_WAKE, PEDAL_PROFILE_VERSION,
} from './gamepad'

// Same threshold the stick calibration uses: below this the axis that moved
// most is noise on some other channel, not a pedal.
const MIN_AXIS_TRAVEL = 0.35

export const PEDAL_CALIBRATION_STEPS = [
  { key: 'centre', prompt: 'Rest your feet with the pedals level', hint: 'Neither pedal pushed' },
  { key: 'right',  prompt: 'Push the RIGHT pedal fully forward',    hint: 'All the way' },
  { key: 'left',   prompt: 'Push the LEFT pedal fully forward',     hint: 'All the way' },
]

// Snapshot of every connected pad's axes, keyed by id. What a calibration
// step records.
export function snapshotPads(pads = listPads()) {
  const out = {}
  for (const p of pads) out[p.id] = Array.from(p.axes || [])
  return out
}

// The state machine the setup panel drives. Pedals have no buttons, so unlike
// the stick calibration every step is committed from the panel's own Capture
// button; the feet are on the pedals and the hand is free for the mouse.
export function createPedalCalibration() {
  let index = 0
  const samples = {}
  let latest = {}

  return {
    step() { return PEDAL_CALIBRATION_STEPS[index] || null },
    stepIndex() { return index },
    done() { return index >= PEDAL_CALIBRATION_STEPS.length },
    live() { return latest },

    // Called every frame so the snapshot committed is the one on screen.
    observe(pads = listPads()) {
      latest = snapshotPads(pads)
    },

    commit() {
      const step = PEDAL_CALIBRATION_STEPS[index]
      if (!step) return false
      samples[step.key] = latest
      index += 1
      return true
    },

    back() {
      if (index > 0) index -= 1
      return index
    },

    // → { ok: true, profile } | { ok: false, reason }
    result() {
      const centre = samples.centre
      const right = samples.right
      const left = samples.left
      if (!centre || !right || !left) return { ok: false, reason: 'Calibration did not record every position.' }

      // The (device, axis) pair with the greatest travel between the two
      // pedals, across everything that was plugged in for all three samples.
      let best = -1
      let bestId = null
      let bestIdx = -1
      for (const id of Object.keys(centre)) {
        const r = right[id]
        const l = left[id]
        if (!r || !l) continue
        for (let i = 0; i < centre[id].length; i++) {
          const travel = Math.abs((r[i] ?? 0) - (l[i] ?? 0))
          if (travel > best) { best = travel; bestId = id; bestIdx = i }
        }
      }
      if (bestId == null || best < MIN_AXIS_TRAVEL) {
        return { ok: false, reason: 'No axis moved far enough between the two pedals. Check the pedals are plugged in and press each one all the way.' }
      }

      // RIGHT pedal forward is the positive end. Which raw direction that is
      // depends on the driver, and `sign` carries the answer, exactly as the
      // stick's axis-inversion problem is solved in gamepad.js.
      const p = clamp1(right[bestId][bestIdx] ?? 0)
      const n = clamp1(left[bestId][bestIdx] ?? 0)
      const c = clamp1(centre[bestId][bestIdx] ?? 0)
      const axis = p >= n
        ? { index: bestIdx, centre: c, min: n, max: p, sign: 1 }
        : { index: bestIdx, centre: c, min: p, max: n, sign: -1 }

      return {
        ok: true,
        profile: {
          id: bestId,
          version: PEDAL_PROFILE_VERSION,
          calibrated: true,
          axis,
          deadZone: STICK_DEAD_ZONE,
          expo: STICK_EXPO,
        },
      }
    },
  }
}

export function readPedalAxis(pad, profile) {
  if (!pad || !pad.axes || !profile || !profile.axis) return 0
  const dz = profile.deadZone ?? STICK_DEAD_ZONE
  const ex = profile.expo ?? STICK_EXPO
  return applyCurve(normaliseAxis(pad.axes[profile.axis.index], profile.axis), dz, ex)
}

// The per-frame object SMA holds. The connected device with a pedal profile is
// the pedals; there is no fallback to an uncalibrated one, see the top of the
// file. The stick reader may be reading the very same device for its own two
// axes, and that is fine: the pedal profile names a third.
export function createPedalReader({ profileFor = loadPedalProfile } = {}) {
  let pad = null
  let profile = null
  let x = 0

  return {
    // Drop the cached profile so the next poll picks up a fresh calibration.
    refresh() { profile = null; pad = null },

    poll() {
      const pads = listPads()
      let next = null
      let nextProfile = null
      // A pad we were already reading keeps the job while it stays connected;
      // otherwise take the first device that has a pedal profile.
      if (pad && profile) {
        const same = pads.find(p => p.id === pad.id)
        if (same) { next = same; nextProfile = profile }
      }
      if (!next) {
        for (const p of pads) {
          const prof = profileFor(p.id)
          if (prof) { next = p; nextProfile = prof; break }
        }
      }
      pad = next
      profile = nextProfile
      x = pad ? readPedalAxis(pad, profile) : 0
      // -0 from a negative sign on a centred axis would put a baffling minus
      // sign in front of a readout.
      if (x === 0) x = 0
    },

    x() { return x },
    connected() { return !!pad },
    awake() { return Math.abs(x) > STICK_WAKE },
    padId() { return pad ? pad.id : null },
    profile() { return profile },
    dispose() { pad = null; profile = null; x = 0 },
  }
}
