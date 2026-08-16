// Shared joystick layer for the two CBAT games that are flown on a stick — the
// Rapid Tracking Test and ACT.
//
// The constraint that shaped every decision here: nobody working on this has a
// stick to test against. So nothing is keyed on a USB id, and no axis index is
// assumed to mean anything. The app LEARNS the mapping from the person holding
// the stick — hold it left, hold it right, squeeze the trigger — and remembers
// what it learned per device.
//
// That is not really a workaround for the missing hardware. Sticks that report
// `mapping: ''` (which is most flight sticks, as opposed to console pads) put
// their axes wherever the driver felt like, so a hardcoded table would have been
// wrong for everything except the one device it was written against. Learning
// the mapping is the thing we would want even with a drawer full of sticks; the
// happy side effect is that it can be written and tested without one.
//
// Everything downstream sees the same two things and nothing else:
//
//   const reader = createStickReader()
//   reader.poll()                     // once per frame
//   const { x, y } = reader.axes()    // calibrated, dead-zoned, curved, [-1,1]
//   const n = reader.consumeEdges('trigger')
//
// +x is right. +y is STICK BACK — pulled toward you — which is the same sense
// as screen-Y growing downward, so a stick and a mouse are the same number and
// no call site needs a sign flip.
//
// That sign is not a free choice. Every game here was built around a mouse, and
// a mouse dragged toward you reads +y; the hand motion that has to match it is
// pulling the stick toward you, not pushing it away. It is also what the
// uncalibrated default mapping already produces on the usual driver convention
// (pitch axis negative when pushed forward), so a calibrated stick and an
// uncalibrated one fly identically — see the note in result().

// A stick has mechanical slop around centre and a hand on a mouse has its own;
// without a dead zone the camera never quite stops.
export const STICK_DEAD_ZONE = 0.07
// Expo bends the response curve so small deflections give fine control and the
// outer travel gives the speed — real sticks behave this way, and tracking a
// slow walker is impossible on a linear curve.
export const STICK_EXPO = 0.5
// Normalised deflection a stick must reach before we accept that it is really
// being flown, rather than sitting plugged in with a drifting potentiometer.
// Measured AFTER the profile is applied, so an unused throttle lever parked at
// -1 forever can never trip it.
export const STICK_WAKE = 0.2

// How far an axis must travel between the two extremes of a calibration step
// before we believe it is the axis the player was moving. Below this we are
// looking at noise on a different channel.
const MIN_AXIS_TRAVEL = 0.35
// A calibrated half-range narrower than this is treated as no range at all,
// rather than divided by — the result would be an axis that slams to full
// deflection on a millivolt of noise.
const MIN_HALF_RANGE = 0.05

const PROFILE_STORE_KEY = 'sw_cbat_stick_profiles'

// Bumped whenever a stored profile would fly differently from a freshly
// calibrated one. Version 1 learned pitch with FORWARD as the positive end,
// which inverted up and down against the uncalibrated mapping the same stick
// flew on before calibration; a profile saved by it is wrong on the hardware it
// was measured from, so it is dropped rather than migrated and the player is
// shown the default mapping and an invitation to calibrate again.
export const PROFILE_VERSION = 2

export function clamp1(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v
}

// Dead zone, then cubic expo. Rescaled past the dead zone so full deflection
// still reaches exactly 1 — otherwise the top of the range is unreachable.
export function applyCurve(v, deadZone = STICK_DEAD_ZONE, expo = STICK_EXPO) {
  const m = Math.abs(clamp1(v))
  if (m <= deadZone) return 0
  const t = (m - deadZone) / (1 - deadZone)
  const curved = (1 - expo) * t + expo * t * t * t
  return Math.sign(v) * curved
}

// ── Profiles ─────────────────────────────────────────────────────────────────
// One axis of a profile is { index, centre, min, max, sign }. `centre` is where
// the axis rests, `min`/`max` are the raw values at the ends of its travel, and
// `sign` is which end the game calls positive.

// The guess we fly on before anyone has calibrated. Axes 0 and 1 with full
// travel and no trim is what a console pad reports and what a decent number of
// sticks report too, so an uncalibrated device has a fair chance of just
// working; the calibration screen is there for when it doesn't.
export function defaultProfile(id = '') {
  return {
    id,
    version: PROFILE_VERSION,
    calibrated: false,
    x: { index: 0, centre: 0, min: -1, max: 1, sign: 1 },
    y: { index: 1, centre: 0, min: -1, max: 1, sign: 1 },
    // Empty means "any button", which is the right default for a device whose
    // trigger we have not been shown. Edges are tracked per button (see
    // createEdgeTracker), so a button wedged permanently on — some sticks
    // report a mode switch that way — contributes nothing rather than jamming
    // the shutter open.
    triggerButtons: [],
    actionButtons: [],
    deadZone: STICK_DEAD_ZONE,
    expo: STICK_EXPO,
  }
}

// Raw axis value → [-1,1], honouring the trim offset and the two half-ranges
// separately. Halves are rescaled independently on purpose: a stick whose
// centre sits at -0.08 has less travel one way than the other, and normalising
// both halves by the same span would mean one direction never reaches full
// deflection while the other saturates early.
export function normaliseAxis(raw, axis) {
  const { centre = 0, min = -1, max = 1, sign = 1 } = axis || {}
  const v = clamp1(Number(raw) || 0)
  const span = v >= centre ? max - centre : centre - min
  if (!(span > MIN_HALF_RANGE)) return 0
  return clamp1(((v - centre) / span) * sign)
}

// The pair the games consume. Anything the profile does not name is not read at
// all, which is what keeps a parked throttle or a twist rudder out of the way.
export function readStickAxes(pad, profile) {
  const p = profile || defaultProfile()
  if (!pad || !pad.axes) return { x: 0, y: 0 }
  const dz = p.deadZone ?? STICK_DEAD_ZONE
  const ex = p.expo ?? STICK_EXPO
  return {
    x: applyCurve(normaliseAxis(pad.axes[p.x.index], p.x), dz, ex),
    y: applyCurve(normaliseAxis(pad.axes[p.y.index], p.y), dz, ex),
  }
}

export function pressedButtons(pad) {
  const out = []
  if (!pad || !pad.buttons) return out
  for (let i = 0; i < pad.buttons.length; i++) {
    const b = pad.buttons[i]
    if (b && (b.pressed || b.value > 0.5)) out.push(i)
  }
  return out
}

// Rising edges only, per button index. There are no gamepad events for a
// button, so the only way to see a press is to compare two frames — and
// comparing per button rather than "is anything pressed" is what makes a stuck
// button inert instead of catastrophic.
export function createEdgeTracker() {
  let prev = new Set()
  return {
    update(pad) {
      const now = new Set(pressedButtons(pad))
      const edges = []
      for (const i of now) if (!prev.has(i)) edges.push(i)
      prev = now
      return edges
    },
    // A disconnect must not leave a button latched down, or the first press
    // after reconnecting is swallowed.
    reset() { prev = new Set() },
  }
}

// ── Device discovery ─────────────────────────────────────────────────────────

export function listPads() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return []
  let pads
  try { pads = navigator.getGamepads() } catch { return [] }
  if (!pads) return []
  const out = []
  for (const p of pads) {
    if (p && p.connected && p.axes && p.axes.length >= 2) out.push(p)
  }
  return out
}

// Prefer the device the player last calibrated. Falling back to the first
// connected pad matters for the split Airbus setups where the throttle quadrant
// enumerates as its own gamepad: without a remembered id, whichever one the
// driver happened to list first would silently become the stick.
export function pickPad(pads, preferredId) {
  if (!pads || !pads.length) return null
  if (preferredId) {
    const match = pads.find(p => p.id === preferredId)
    if (match) return match
  }
  return pads[0]
}

// ── Persistence ──────────────────────────────────────────────────────────────
// Keyed by gamepad id rather than by index, because the index moves when
// anything else is plugged in and the id does not.

export function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILE_STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

export function loadProfile(id) {
  if (!id) return null
  const p = loadProfiles()[id]
  // A stored profile from an older shape would blow up readStickAxes on the
  // first frame of a run, which is the worst possible moment to find out — and
  // one from an older VERSION would fly the wrong way round, which is worse
  // still because nothing about it looks broken until the stick is in a hand.
  if (!p || !p.x || !p.y || typeof p.x.index !== 'number' || typeof p.y.index !== 'number') return null
  if (p.version !== PROFILE_VERSION) return null
  return p
}

export function saveProfile(profile) {
  if (!profile || !profile.id) return
  try {
    const all = loadProfiles()
    all[profile.id] = profile
    localStorage.setItem(PROFILE_STORE_KEY, JSON.stringify(all))
  } catch { /* storage unavailable */ }
}

export function clearProfile(id) {
  try {
    const all = loadProfiles()
    delete all[id]
    localStorage.setItem(PROFILE_STORE_KEY, JSON.stringify(all))
  } catch { /* storage unavailable */ }
}

// ── Calibration ──────────────────────────────────────────────────────────────
// A little state machine the setup screen drives. The logic lives here rather
// than in the component so the part that can be got wrong — which axis was
// moved, and which way round it goes — is unit-testable without a stick.

export const CALIBRATION_STEPS = [
  { key: 'centre',  kind: 'axes',   prompt: 'Let the stick sit centred',        hint: 'Take your hand off it' },
  { key: 'right',   kind: 'axes',   prompt: 'Hold the stick fully RIGHT',       hint: 'All the way over' },
  { key: 'left',    kind: 'axes',   prompt: 'Hold the stick fully LEFT',        hint: 'All the way over' },
  { key: 'forward', kind: 'axes',   prompt: 'Push the stick fully FORWARD',     hint: 'Away from you' },
  { key: 'back',    kind: 'axes',   prompt: 'Pull the stick fully BACK',        hint: 'Towards you' },
  { key: 'trigger', kind: 'button', prompt: 'Squeeze the trigger',              hint: 'This takes the picture' },
  { key: 'action',  kind: 'button', prompt: 'Press the button you want for BLEEP', hint: 'Any other button on the stick' },
]

export function createCalibration(id = '') {
  let index = 0
  const samples = {}
  const buttons = {}
  const edges = createEdgeTracker()
  let latest = []
  let primed = false

  return {
    step() { return CALIBRATION_STEPS[index] || null },
    stepIndex() { return index },
    done() { return index >= CALIBRATION_STEPS.length },
    // The live axis values, so the screen can show the stick moving and the
    // player can see the thing is alive before being asked to trust it.
    live() { return latest },

    // Called every frame with the current pad. Returns true if the step
    // advanced on its own.
    //
    // Axis steps commit on any button press as well as on an explicit commit()
    // from the UI — holding a stick hard over and then reaching for a mouse is
    // exactly how you fail to hold it hard over.
    observe(pad) {
      if (!pad) return false
      latest = Array.from(pad.axes || [])
      const rising = edges.update(pad)
      // The first frame establishes the baseline. Without it, a button already
      // held when calibration opens reads as a press on frame one and skips a
      // step before the player has read it.
      if (!primed) { primed = true; return false }

      const step = CALIBRATION_STEPS[index]
      if (!step) return false

      if (step.kind === 'axes') {
        if (rising.length) { this.commit(); return true }
        return false
      }
      // Button steps: take the first rising edge that is not already spoken
      // for, so the trigger cannot be bound twice.
      const taken = new Set(Object.values(buttons))
      const pick = rising.find(i => !taken.has(i))
      if (pick == null) return false
      buttons[step.key] = pick
      index += 1
      return true
    },

    // Explicit capture from the UI's own button.
    commit() {
      const step = CALIBRATION_STEPS[index]
      if (!step || step.kind !== 'axes') return false
      samples[step.key] = latest.slice()
      index += 1
      return true
    },

    // Let the player skip binding a button they do not have. The game falls
    // back to "any button" for whatever was skipped.
    skip() {
      const step = CALIBRATION_STEPS[index]
      if (!step || step.kind !== 'button') return false
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
      if (!centre) return { ok: false, reason: 'Calibration did not record a centre position.' }

      const learn = (posKey, negKey, exclude) => {
        const pos = samples[posKey]
        const neg = samples[negKey]
        if (!pos || !neg) return null
        let best = -1
        let bestIdx = -1
        for (let i = 0; i < centre.length; i++) {
          if (i === exclude) continue
          const travel = Math.abs((pos[i] ?? 0) - (neg[i] ?? 0))
          if (travel > best) { best = travel; bestIdx = i }
        }
        if (bestIdx < 0 || best < MIN_AXIS_TRAVEL) return null
        const p = clamp1(pos[bestIdx] ?? 0)
        const n = clamp1(neg[bestIdx] ?? 0)
        // Whichever raw end the player called positive becomes `max` when it is
        // the numerically larger one and `min` when it is not; `sign` carries
        // the difference. This is the whole of the axis-inversion problem —
        // pulling back on a stick reads positive on some drivers and negative
        // on others, and nothing but watching the player move it can tell you.
        return p >= n
          ? { index: bestIdx, centre: clamp1(centre[bestIdx] ?? 0), min: n, max: p, sign: 1 }
          : { index: bestIdx, centre: clamp1(centre[bestIdx] ?? 0), min: p, max: n, sign: -1 }
      }

      const x = learn('right', 'left', -1)
      if (!x) return { ok: false, reason: 'No axis moved far enough left and right. Check the stick is the selected device.' }
      // BACK is the positive end of pitch, not forward. Getting this backwards
      // is the bug this ordering exists to prevent: the uncalibrated default
      // profile passes the raw pitch axis straight through, and on the usual
      // driver convention that axis is positive when the stick is pulled back.
      // Learning forward-as-positive therefore produced a calibrated stick that
      // flew inverted relative to the same stick before calibration — the one
      // comparison none of the tests were making.
      const y = learn('back', 'forward', x.index)
      if (!y) return { ok: false, reason: 'No axis moved far enough forward and back.' }

      return {
        ok: true,
        profile: {
          id,
          version: PROFILE_VERSION,
          calibrated: true,
          x,
          y,
          triggerButtons: buttons.trigger == null ? [] : [buttons.trigger],
          actionButtons: buttons.action == null ? [] : [buttons.action],
          deadZone: STICK_DEAD_ZONE,
          expo: STICK_EXPO,
        },
      }
    },
  }
}

// ── Reader ───────────────────────────────────────────────────────────────────
// The per-frame object both games hold. It owns pad selection, the profile and
// the edge tracking; it does not own any game state, and deliberately has no
// opinion about what a trigger press means.

export function createStickReader({ profileFor = loadProfile } = {}) {
  const edges = createEdgeTracker()
  let pad = null
  let profile = null
  let axes = { x: 0, y: 0 }
  let pendingTrigger = 0
  let pendingAction = 0
  let preferredId = null

  // Which bucket a pressed button falls into. An explicitly bound list wins.
  // An EMPTY list means "any button that isn't bound to the other thing", so an
  // uncalibrated stick still fires RTT's shutter and ACT's bleep off any button
  // it has — the two games read different buckets and never see each other, so
  // there is no conflict in handing the same button to both.
  const claims = (own, other, i) => (own && own.length ? own.includes(i) : !(other && other.includes(i)))

  return {
    // Pin the device the setup screen is working with, so plugging in a second
    // pad mid-calibration cannot steal it.
    prefer(id) { preferredId = id },

    // Drop the cached profile so the next poll picks up a fresh calibration.
    // Needed because the profile is only re-read when the DEVICE changes, and
    // recalibrating does not change the device.
    refresh() { profile = null },

    poll() {
      const pads = listPads()
      const next = pickPad(pads, preferredId)
      if (!next) {
        if (pad) edges.reset()
        pad = null
        profile = null
        axes = { x: 0, y: 0 }
        return
      }
      // Re-read the profile whenever the device changes, including a
      // recalibration mid-session (the setup screen bumps the id through
      // prefer() to force this).
      if (!pad || pad.id !== next.id || !profile) {
        profile = profileFor(next.id) || defaultProfile(next.id)
        edges.reset()
      }
      pad = next

      axes = readStickAxes(pad, profile)
      for (const i of edges.update(pad)) {
        if (claims(profile.triggerButtons, profile.actionButtons, i)) pendingTrigger += 1
        if (claims(profile.actionButtons, profile.triggerButtons, i)) pendingAction += 1
      }
    },

    axes() { return axes },
    // Post-profile magnitude, which is what "is this stick actually being
    // flown" has to be measured on.
    deflection() { return Math.hypot(axes.x, axes.y) },
    awake() { return Math.hypot(axes.x, axes.y) > STICK_WAKE },
    connected() { return !!pad },
    padId() { return pad ? pad.id : null },
    profile() { return profile },
    // For the setup screen's raw readout — the diagnostic a player with a
    // misbehaving stick can read out to us.
    raw() {
      if (!pad) return { axes: [], buttons: [] }
      return { axes: Array.from(pad.axes || []), buttons: pressedButtons(pad) }
    },

    consumeEdges(kind = 'trigger') {
      if (kind === 'action') { const n = pendingAction; pendingAction = 0; return n }
      const n = pendingTrigger; pendingTrigger = 0; return n
    },

    dispose() { pad = null; profile = null; edges.reset() },
  }
}
