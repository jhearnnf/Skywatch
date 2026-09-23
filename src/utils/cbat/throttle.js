// The throttle for the Instruments Practise drill, when it is flown on real
// hardware. Two ways to work it, both LEARNED rather than guessed, for the
// reason gamepad.js gives: a browser cannot tell a throttle lever from a twist
// rudder or a toe brake, and flight sticks number their buttons however the
// driver likes.
//
//   lever    the default. The player pulls the lever to idle, then pushes it
//            to full, and whichever axis on whichever device travelled
//            furthest between the two is the throttle. Measured across EVERY
//            connected pad, the way the pedals are, because a lever may sit on
//            the stick's own base (same id) or on a separate throttle unit.
//            It is absolute: the lever's position IS the throttle setting.
//   buttons  the player's override. They press the button they want for
//            FASTER, then the one for SLOWER. Held, each works like R and F.
//
// There is no default for either. An uncalibrated throttle is not read at
// all, so R, F and the on-screen buttons are what fly until it is set up.
//
//   const throttle = createThrottleReader()
//   throttle.poll()           // once per frame
//   throttle.level()          // 0..1 once the lever has been moved, else null
//   throttle.direction()      // -1, 0 or 1 from the bound buttons

import {
  clamp1, listPads, createEdgeTracker, loadThrottleProfile,
} from './gamepad'

// Same threshold the stick and pedal calibrations use: below this, the axis
// that moved most is noise on some other channel, not the lever.
const MIN_AXIS_TRAVEL = 0.35

// How far the lever must move from where it sat when the run began before it
// takes the throttle. Until then R/F and the on-screen buttons keep working:
// a lever left at idle from yesterday must not throttle a new run back the
// moment it starts. Once moved, the lever owns the throttle for the rest of
// the run (the same latch the stick uses; a lever held still is a setting, not
// an absence of input).
export const LEVER_WAKE = 0.05

export const LEVER_STEPS = [
  { key: 'idle', prompt: 'Pull the throttle lever fully BACK', hint: 'Idle: the slowest setting' },
  { key: 'full', prompt: 'Push the throttle lever fully FORWARD', hint: 'Full power' },
]

export const BUTTON_STEPS = [
  { key: 'faster', prompt: 'Press the button for FASTER', hint: 'Any button on the stick or throttle' },
  { key: 'slower', prompt: 'Press the button for SLOWER', hint: 'A different button' },
]

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)

export function snapshotAxes(pads = listPads()) {
  const out = {}
  for (const p of pads) out[p.id] = Array.from(p.axes || [])
  return out
}

// ── Lever calibration ────────────────────────────────────────────────────────
// Committed from the panel's Capture button, like the pedals: the hand is on
// the lever, not on a stick button.
export function createLeverCalibration() {
  let index = 0
  const samples = {}
  let latest = {}

  return {
    step() { return LEVER_STEPS[index] || null },
    done() { return index >= LEVER_STEPS.length },
    live() { return latest },
    observe(pads = listPads()) { latest = snapshotAxes(pads) },
    commit() {
      const step = LEVER_STEPS[index]
      if (!step) return false
      samples[step.key] = latest
      index += 1
      return true
    },

    // → { ok: true, lever: { id, axis: { index, idle, full } } } | { ok: false, reason }
    result() {
      const { idle, full } = samples
      if (!idle || !full) return { ok: false, reason: 'Calibration did not record both ends of the lever.' }
      let best = -1
      let bestId = null
      let bestIdx = -1
      for (const id of Object.keys(idle)) {
        const f = full[id]
        if (!f) continue
        for (let i = 0; i < idle[id].length; i++) {
          const travel = Math.abs((f[i] ?? 0) - (idle[id][i] ?? 0))
          if (travel > best) { best = travel; bestId = id; bestIdx = i }
        }
      }
      if (bestId == null || best < MIN_AXIS_TRAVEL) {
        return { ok: false, reason: 'No lever moved far enough. Pull it right back, capture, then push it right forward.' }
      }
      // Which raw end is "full" depends on the driver; storing both ends
      // rather than a sign keeps the reading a plain interpolation.
      return {
        ok: true,
        lever: {
          id: bestId,
          axis: { index: bestIdx, idle: clamp1(idle[bestId][bestIdx] ?? 0), full: clamp1(full[bestId][bestIdx] ?? 0) },
        },
      }
    },
  }
}

// ── Button calibration ───────────────────────────────────────────────────────
// Each step takes the first new press on any pad, the way the stick
// calibration binds its trigger. A button already bound to FASTER cannot also
// be SLOWER.
export function createButtonCalibration() {
  let index = 0
  const bound = {}
  const trackers = new Map()
  const primed = new Set()

  return {
    step() { return BUTTON_STEPS[index] || null },
    done() { return index >= BUTTON_STEPS.length },

    // Called every frame. Returns true if the step advanced.
    observe(pads = listPads()) {
      const step = BUTTON_STEPS[index]
      let advanced = false
      for (const pad of pads) {
        if (!trackers.has(pad.id)) trackers.set(pad.id, createEdgeTracker())
        const rising = trackers.get(pad.id).update(pad)
        // A pad's first frame is its baseline: a button already held when the
        // step opens is not a press.
        if (!primed.has(pad.id)) { primed.add(pad.id); continue }
        if (!step || advanced) continue
        const taken = Object.values(bound)
        const pick = rising.find(i => !taken.some(b => b.id === pad.id && b.index === i))
        if (pick == null) continue
        bound[step.key] = { id: pad.id, index: pick }
        index += 1
        advanced = true
      }
      return advanced
    },

    // → { ok: true, buttons: { faster, slower } } | { ok: false, reason }
    result() {
      if (!bound.faster || !bound.slower) return { ok: false, reason: 'Both buttons need pressing.' }
      return { ok: true, buttons: { faster: bound.faster, slower: bound.slower } }
    },
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

// Lever position as a throttle setting, 0 at idle and 1 at full. null when the
// lever's device is missing or the learned ends are too close to trust.
export function readLever(pad, axis) {
  if (!pad || !pad.axes || !axis) return null
  const span = axis.full - axis.idle
  if (Math.abs(span) < 0.05) return null
  const raw = clamp1(Number(pad.axes[axis.index]) || 0)
  const v = clamp01((raw - axis.idle) / span)
  // An inverted lever at idle divides 0 by a negative span and gives -0,
  // which a readout would print as "-0.00".
  return v === 0 ? 0 : v
}

function held(pads, binding) {
  if (!binding) return false
  const pad = pads.find(p => p.id === binding.id)
  const b = pad?.buttons?.[binding.index]
  return !!b && (b.pressed || b.value > 0.5)
}

// The per-run object the drill holds. Made fresh for each run, so the lever
// latch starts open every time.
export function createThrottleReader({ profileFor = loadThrottleProfile } = {}) {
  let position = null
  let first = null
  let engaged = false
  let dir = 0
  let mode = null

  return {
    poll(pads = listPads()) {
      const profile = profileFor()
      mode = profile?.mode ?? null
      position = null
      dir = 0
      if (mode === 'lever' && profile.lever) {
        const pad = pads.find(p => p.id === profile.lever.id)
        position = readLever(pad, profile.lever.axis)
        if (position == null) {
          // Unplugged: drop the latch so the keys take over again, and so a
          // reconnect waits to be moved like a fresh one.
          first = null
          engaged = false
        } else if (first == null) {
          first = position
        } else if (Math.abs(position - first) > LEVER_WAKE) {
          engaged = true
        }
      } else if (mode === 'buttons' && profile.buttons) {
        dir = (held(pads, profile.buttons.faster) ? 1 : 0) - (held(pads, profile.buttons.slower) ? 1 : 0)
      }
    },
    // The throttle setting to fly, once the lever has taken over.
    level() { return engaged ? position : null },
    // Where the lever is, taken over or not, for a readout.
    position() { return position },
    direction() { return dir },
    mode() { return mode },
  }
}
