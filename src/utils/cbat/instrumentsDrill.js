// The Instruments practice drill: fly an aircraft for a minute with all six
// dials live beside it. Every few seconds every dial but one greys out, that
// one shows a pink (magenta) target reading, and the player flies until the live
// reading sits on the target. The faster the match, the more points.
//
// Everything here is pure and seedable so the drill can be flown in a test.
// The page steps it once per frame and draws whatever it says.
//
// ── Why the course is rebuilt after every challenge ─────────────────────────
// A challenge can ask for any heading, so a player can finish one facing the
// way the course came from. Rather than drag them back round, a challenge
// clears the rings and the next course is laid ahead of wherever the aircraft
// is pointing when the challenge ends. Nothing is ever behind you.
//
// ── Frames ──────────────────────────────────────────────────────────────────
// World units are 10 m. x is east, y is up, z is SOUTH (three.js looks down
// -z), so north is -z. Heading is degrees clockwise from north, bank is
// positive to the right, pitch positive nose up.

export const DRILL_SECONDS = 60

// Arcade flight constants. Real turn and climb rates are far too slow for a
// one-minute drill (a real standard-rate turn takes 30 s to go through 90°),
// so turns and climbs are scaled up. The dials still agree with each other:
// the turn needle, the heading card and the bank all move together.
export const BANK_RATE = 90          // deg/s at full roll input
export const PITCH_RATE = 25         // deg/s at full pitch input
export const MAX_BANK = 60
export const MAX_PITCH = 25
export const TURN_GAIN = 4           // x the coordinated-turn rate for the bank
export const VS_GAIN = 0.4           // x the true climb rate for the pitch
// Climb rate is worked out from a blend of the real speed and this one, so a
// slow aircraft still climbs well enough to finish an altitude challenge.
export const VS_REFERENCE_SPEED = 220
export const THROTTLE_RATE = 0.5     // throttle travel per second held
export const MIN_SPEED = 140         // kt, throttle closed, level
export const MAX_SPEED = 340         // kt, throttle open, level
export const SPEED_RESPONSE = 0.5    // 1/s, how quickly speed chases the throttle
export const SPEED_PITCH_DRAG = 30   // kt/s lost per unit sin(pitch) climbing
export const ALT_FLOOR = 500
export const ALT_CEILING = 9800

// The turn coordinator's standard-rate mark, in the drill's scaled rate.
// 25° of bank at 220 kt puts the needle on the mark.
export const STANDARD_RATE = 9       // deg/s
export const TURN_NEEDLE_AT_STANDARD = 20   // needle deflection at the mark

// World scale: 1 unit = 10 m.
const KT_TO_UNITS = 0.514444 / 10
const FT_TO_UNITS = 0.3048 / 10
const G = 9.81
const DEG = Math.PI / 180

export const START_ALTITUDE = 3000
export const START_SPEED = 220

// ── Course ──────────────────────────────────────────────────────────────────
export const RING_RADIUS = 2.5
export const BULLSEYE_RADIUS = RING_RADIUS * 7 / 17
export const RING_COUNT = 5
export const RING_SPACING = 35       // units, about 3 s apart at 220 kt
const RING_LATERAL = 4
const RING_VERTICAL = 3
const FIRST_RING_AHEAD = 30

// ── Challenges ──────────────────────────────────────────────────────────────
export const CHALLENGE_KINDS = ['altitude', 'airspeed', 'heading', 'vs', 'turn', 'attitude']
export const HOLD_MS = 500           // the match must be held this long
export const CHALLENGE_TIMEOUT_S = 20
export const SOLVED_PAUSE_S = 1.2    // the green flash before the course comes back
export const FIRST_CHALLENGE_S = 4
export const CRUISE_MIN_S = 3
export const CRUISE_MAX_S = 6
export const RING_POINTS = 1
// Through the middle of a gate: the gates are drawn as the SkyWatch crosshair
// logo, whose inner circle is 7/17 of the outer, and that inner circle is the
// bullseye. Worth double, and drawn on both themes, since both post to one board.
export const BULLSEYE_POINTS = 2
export const MAX_POINTS = 10
export const MIN_POINTS = 5
const FULL_POINTS_S = 3              // answered this fast earns the full 10
const MIN_POINTS_S = 15              // and this slow or slower earns 5

// Altitude targets: how far from the current height, and the band they stay in.
export const ALT_MIN_GAP = 100
export const ALT_MAX_GAP = 225
const ALT_TARGET_MIN = 1000
const ALT_TARGET_MAX = 9000

export const TOLERANCE = {
  altitude: 60,     // ft (targets are always ALT_MIN_GAP or more away)
  airspeed: 8,      // kt
  heading: 6,       // deg
  vs: 250,          // fpm
  turn: 1.5,        // deg/s
  bank: 5,          // deg
  pitch: 3,         // deg
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
export const normDeg = d => ((d % 360) + 360) % 360
// Signed shortest difference b - a, in (-180, 180].
export const angleDiff = (a, b) => {
  const d = normDeg(b - a)
  return d > 180 ? d - 360 : d
}

// Mulberry32. Seedable so a test can fly the same drill twice.
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length]
const between = (rng, lo, hi) => lo + rng() * (hi - lo)

// ── Flight model ────────────────────────────────────────────────────────────

// The throttle that holds a given speed in level flight.
export const throttleFor = speed => clamp((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0, 1)

export function createFlight({ headingDeg = 0 } = {}) {
  return {
    x: 0,
    z: 0,
    altitude: START_ALTITUDE,
    speed: START_SPEED,
    throttle: throttleFor(START_SPEED),
    headingDeg,
    pitchDeg: 0,
    bankDeg: 0,
  }
}

export function turnRateFor(bankDeg, speedKt) {
  const v = Math.max(60, speedKt) * 0.514444
  return TURN_GAIN * (G * Math.tan(bankDeg * DEG) / v) / DEG
}

export function verticalSpeedFor(pitchDeg, speedKt) {
  const speed = (speedKt + VS_REFERENCE_SPEED) / 2
  return speed * 101.2686 * Math.sin(pitchDeg * DEG) * VS_GAIN
}

// Advance the aircraft. `input.roll` and `input.pitch` are [-1, 1] rates
// (right and nose up positive); `input.throttle` is -1, 0 or 1. Bank and pitch
// HOLD when the input is released, as a trimmed aircraft does: that is what
// lets a player set 30° of bank and let go of the stick to read the dials.
//
// `input.throttleLevel` (0..1), when given, is a real throttle lever: it SETS
// the throttle outright, as a lever does, and the -1/0/1 rate is ignored.
export function stepFlight(f, input, dt) {
  const roll = clamp(input?.roll ?? 0, -1, 1)
  const pitch = clamp(input?.pitch ?? 0, -1, 1)
  const thr = clamp(input?.throttle ?? 0, -1, 1)
  const lever = input?.throttleLevel

  f.bankDeg = clamp(f.bankDeg + roll * BANK_RATE * dt, -MAX_BANK, MAX_BANK)
  f.pitchDeg = clamp(f.pitchDeg + pitch * PITCH_RATE * dt, -MAX_PITCH, MAX_PITCH)
  f.throttle = typeof lever === 'number'
    ? clamp(lever, 0, 1)
    : clamp(f.throttle + thr * THROTTLE_RATE * dt, 0, 1)

  const targetSpeed = MIN_SPEED + f.throttle * (MAX_SPEED - MIN_SPEED)
  f.speed += ((targetSpeed - f.speed) * SPEED_RESPONSE - Math.sin(f.pitchDeg * DEG) * SPEED_PITCH_DRAG) * dt
  f.speed = clamp(f.speed, 100, 400)

  f.headingDeg = normDeg(f.headingDeg + turnRateFor(f.bankDeg, f.speed) * dt)

  const vs = verticalSpeedFor(f.pitchDeg, f.speed)
  f.altitude += (vs / 60) * dt
  // The floor and ceiling level the aircraft off rather than let it through,
  // so a player can never crash out of a practice drill.
  if (f.altitude < ALT_FLOOR) { f.altitude = ALT_FLOOR; if (f.pitchDeg < 0) f.pitchDeg = 0 }
  if (f.altitude > ALT_CEILING) { f.altitude = ALT_CEILING; if (f.pitchDeg > 0) f.pitchDeg = 0 }

  const ground = f.speed * KT_TO_UNITS * Math.cos(f.pitchDeg * DEG) * dt
  const h = f.headingDeg * DEG
  f.x += Math.sin(h) * ground
  f.z -= Math.cos(h) * ground
  return f
}

// Stick input -> the drill's pitch rate (+ is nose up), flown like a real
// aircraft on every control. `y` is the input layer's (smaInput.js): +y is the
// down arrow, a drag towards you, and a joystick pushed FORWARD (SMA flips the
// stick so the apparatus flies like an aircraft).
//   joystick   already a real stick: forward is nose down, back is nose up
//   keys/drag  given the same treatment: the up arrow, W and a drag away from
//              you push the nose DOWN; the down arrow and a drag towards you
//              pull it up. So the pitch is the inverse of the arcade mapping.
export function pitchFromAxes(source, y) {
  if (!y) return 0
  return source === 'gamepad' ? -y : y
}

// What the six dials read.
export function telemetry(f) {
  const turnRate = turnRateFor(f.bankDeg, f.speed)
  return {
    altitude: f.altitude,
    airspeed: f.speed,
    headingDeg: f.headingDeg,
    vsFpm: verticalSpeedFor(f.pitchDeg, f.speed),
    pitchDeg: f.pitchDeg,
    bankDeg: f.bankDeg,
    turnRate,
    turnNeedle: turnNeedleFor(turnRate),
  }
}

export const turnNeedleFor = rate => clamp((rate / STANDARD_RATE) * TURN_NEEDLE_AT_STANDARD, -45, 45)

export const worldY = altitudeFt => altitudeFt * FT_TO_UNITS

// ── Course ──────────────────────────────────────────────────────────────────

// Rings laid out ahead of the aircraft along its current heading, weaving a
// little either side and up and down so they have to be flown, not just
// waited for. Each ring faces along the course.
export function buildCourse(f, rng) {
  const h = f.headingDeg * DEG
  const fwd = { x: Math.sin(h), z: -Math.cos(h) }
  const right = { x: Math.cos(h), z: Math.sin(h) }
  const y0 = worldY(f.altitude)
  const rings = []
  for (let i = 0; i < RING_COUNT; i++) {
    const along = FIRST_RING_AHEAD + i * RING_SPACING
    // The first ring is dead ahead, so a new course never opens with a jink.
    const side = i === 0 ? 0 : between(rng, -RING_LATERAL, RING_LATERAL)
    const up = i === 0 ? 0 : between(rng, -RING_VERTICAL, RING_VERTICAL)
    rings.push({
      id: i,
      x: f.x + fwd.x * along + right.x * side,
      z: f.z + fwd.z * along + right.z * side,
      y: Math.max(worldY(ALT_FLOOR + 200), y0 + up),
      nx: fwd.x,
      nz: fwd.z,
      state: 'open',   // open | hit | missed
    })
  }
  return rings
}

// Did the aircraft pass the ring's plane between `prev` and `cur`, and was it
// inside the hoop when it did? null if it has not reached the ring yet.
export function ringCrossing(ring, prev, cur) {
  const side = p => (p.x - ring.x) * ring.nx + (p.z - ring.z) * ring.nz
  const a = side(prev)
  const b = side(cur)
  if (a > 0 || b < 0) return null
  const t = a === b ? 0 : a / (a - b)
  const px = prev.x + (cur.x - prev.x) * t
  const py = prev.y + (cur.y - prev.y) * t
  const pz = prev.z + (cur.z - prev.z) * t
  const d = Math.hypot(px - ring.x, py - ring.y, pz - ring.z)
  if (d <= BULLSEYE_RADIUS) return 'bullseye'
  return d <= RING_RADIUS ? 'hit' : 'missed'
}

// A ring the aircraft has turned away from would otherwise stay open forever
// and hold the next course back.
const RING_ABANDON_DIST = 80

// ── Challenges ──────────────────────────────────────────────────────────────

// A target for one dial that is reachable from where the aircraft is now and
// not already met, so a challenge never completes itself on the first frame.
export function makeChallenge(kind, t, rng) {
  switch (kind) {
    case 'altitude': {
      // A short climb or descent, 100-200 ft (at most 225 after rounding).
      // 200-400 ft took too long to fly on a one-minute clock (user,
      // 2026-09-23). Rounded to 50 ft so the target sits on a hundreds-hand
      // mark or halfway between, then kept at least ALT_MIN_GAP away so
      // rounding can never land it inside the match window.
      const dist = pick(rng, [100, 150, 200])
      let dir = rng() < 0.5 ? -1 : 1
      const out = a => a < ALT_TARGET_MIN || a > ALT_TARGET_MAX
      if (out(t.altitude + dir * dist)) dir = -dir
      let target = Math.round((t.altitude + dir * dist) / 50) * 50
      while (Math.abs(target - t.altitude) < ALT_MIN_GAP) target += 50 * dir
      return { kind, target }
    }
    case 'airspeed': {
      const delta = pick(rng, [40, 50, 60, 70]) * (rng() < 0.5 ? -1 : 1)
      let target = Math.round((t.airspeed + delta) / 10) * 10
      if (target < 150 || target > 320) target = Math.round((t.airspeed - delta) / 10) * 10
      return { kind, target: clamp(target, 150, 320) }
    }
    case 'heading': {
      const delta = pick(rng, [60, 90, 120, 150]) * (rng() < 0.5 ? -1 : 1)
      return { kind, target: normDeg(Math.round((t.headingDeg + delta) / 30) * 30) }
    }
    case 'vs': {
      const options = [-2000, -1000, 0, 1000, 2000].filter(v => Math.abs(v - t.vsFpm) > 600)
      return { kind, target: pick(rng, options) }
    }
    case 'turn': {
      const options = [-STANDARD_RATE, 0, STANDARD_RATE].filter(v => Math.abs(v - t.turnRate) > 4)
      return { kind, target: pick(rng, options) }
    }
    case 'attitude': {
      const pairs = []
      for (const bank of [-40, -30, -20, -10, 0, 10, 20, 30, 40]) {
        for (const pitch of [-10, 0, 10]) {
          if (Math.abs(bank - t.bankDeg) > 15 || Math.abs(pitch - t.pitchDeg) > 7) pairs.push({ bank, pitch })
        }
      }
      return { kind, target: pick(rng, pairs) }
    }
    default:
      throw new Error(`Unknown challenge kind: ${kind}`)
  }
}

// Is the live reading on the target?
export function challengeMatched(c, t) {
  switch (c.kind) {
    case 'altitude': return Math.abs(t.altitude - c.target) <= TOLERANCE.altitude
    case 'airspeed': return Math.abs(t.airspeed - c.target) <= TOLERANCE.airspeed
    case 'heading': return Math.abs(angleDiff(t.headingDeg, c.target)) <= TOLERANCE.heading
    case 'vs': return Math.abs(t.vsFpm - c.target) <= TOLERANCE.vs
    case 'turn': return Math.abs(t.turnRate - c.target) <= TOLERANCE.turn
    case 'attitude':
      return Math.abs(t.bankDeg - c.target.bank) <= TOLERANCE.bank
        && Math.abs(t.pitchDeg - c.target.pitch) <= TOLERANCE.pitch
    default: return false
  }
}

// Full marks for a quick answer, sliding to half for a slow one.
export function challengePoints(seconds) {
  if (seconds <= FULL_POINTS_S) return MAX_POINTS
  if (seconds >= MIN_POINTS_S) return MIN_POINTS
  const f = (seconds - FULL_POINTS_S) / (MIN_POINTS_S - FULL_POINTS_S)
  return Math.round(MAX_POINTS - f * (MAX_POINTS - MIN_POINTS))
}

// ── The drill ───────────────────────────────────────────────────────────────
//
// phase: cruise    rings out, dials all live, counting down to a challenge
//        challenge one dial lit, course cleared, flying free to match it
//        solved    the matched dial flashes green; the course comes back after
//        done      the minute is up
//
// The clock runs through every phase. That is the point of the scoring: a
// quick match earns more AND gets you to the next one sooner.

export function createDrill({ seed = Date.now() } = {}) {
  const rng = makeRng(seed)
  const flight = createFlight()
  return {
    rng,
    flight,
    phase: 'cruise',
    elapsed: 0,
    score: 0,
    ringsHit: 0,       // every gate flown through, bullseyes included
    bullseyes: 0,
    ringsMissed: 0,
    streak: 0,         // gates in a row without a miss, for the HUD
    bestStreak: 0,
    rings: buildCourse(flight, rng),
    nextChallengeAt: FIRST_CHALLENGE_S,
    challenge: null,     // { kind, target, startedAt, heldMs, matched }
    lastKind: null,
    solvedUntil: 0,
    results: [],         // { kind, seconds, points, solved }
  }
}

// Advance the drill by `dt` seconds. Returns the events that happened on this
// step, for the page to animate: { type: 'ring', result } | { type:
// 'challenge', kind } | { type: 'solved', kind, points, seconds } | { type:
// 'timeout', kind } | { type: 'end' }.
export function stepDrill(d, input, dt) {
  const events = []
  if (d.phase === 'done') return events
  dt = Math.max(0, Math.min(dt, 0.1))
  d.elapsed += dt

  const f = d.flight
  const prev = { x: f.x, y: worldY(f.altitude), z: f.z }
  stepFlight(f, input, dt)
  const cur = { x: f.x, y: worldY(f.altitude), z: f.z }

  if (d.elapsed >= DRILL_SECONDS) {
    d.elapsed = DRILL_SECONDS
    d.phase = 'done'
    d.challenge = null
    events.push({ type: 'end' })
    return events
  }

  if (d.phase === 'cruise') {
    for (const ring of d.rings) {
      if (ring.state !== 'open') continue
      let result = ringCrossing(ring, prev, cur)
      if (!result && Math.hypot(cur.x - ring.x, cur.z - ring.z) > RING_ABANDON_DIST) {
        const ahead = (ring.x - cur.x) * Math.sin(f.headingDeg * DEG) - (ring.z - cur.z) * Math.cos(f.headingDeg * DEG)
        if (ahead < 0) result = 'missed'
      }
      if (!result) continue
      ring.state = result
      if (result === 'missed') {
        d.ringsMissed += 1
        d.streak = 0
      } else {
        d.ringsHit += 1
        if (result === 'bullseye') d.bullseyes += 1
        d.score += result === 'bullseye' ? BULLSEYE_POINTS : RING_POINTS
        d.streak += 1
        d.bestStreak = Math.max(d.bestStreak, d.streak)
      }
      // Where, so the view can burst the gate that was just flown.
      events.push({ type: 'ring', result, x: ring.x, y: ring.y, z: ring.z, nx: ring.nx, nz: ring.nz })
    }
    if (d.rings.every(r => r.state !== 'open')) d.rings = buildCourse(f, d.rng)

    if (d.elapsed >= d.nextChallengeAt) {
      const kinds = CHALLENGE_KINDS.filter(k => k !== d.lastKind)
      const kind = pick(d.rng, kinds)
      d.challenge = { ...makeChallenge(kind, telemetry(f), d.rng), startedAt: d.elapsed, heldMs: 0, matched: false }
      d.lastKind = kind
      d.rings = []
      d.phase = 'challenge'
      events.push({ type: 'challenge', kind })
    }
    return events
  }

  if (d.phase === 'challenge') {
    const c = d.challenge
    c.matched = challengeMatched(c, telemetry(f))
    c.heldMs = c.matched ? c.heldMs + dt * 1000 : 0
    const seconds = d.elapsed - c.startedAt
    if (c.heldMs >= HOLD_MS) {
      const points = challengePoints(seconds)
      d.score += points
      d.results.push({ kind: c.kind, seconds, points, solved: true })
      d.phase = 'solved'
      d.solvedUntil = d.elapsed + SOLVED_PAUSE_S
      c.points = points
      events.push({ type: 'solved', kind: c.kind, points, seconds })
    } else if (seconds >= CHALLENGE_TIMEOUT_S) {
      d.results.push({ kind: c.kind, seconds, points: 0, solved: false })
      d.challenge = null
      resumeCruise(d)
      events.push({ type: 'timeout', kind: c.kind })
    }
    return events
  }

  if (d.phase === 'solved' && d.elapsed >= d.solvedUntil) {
    d.challenge = null
    resumeCruise(d)
  }
  return events
}

function resumeCruise(d) {
  d.phase = 'cruise'
  d.rings = buildCourse(d.flight, d.rng)
  d.nextChallengeAt = d.elapsed + between(d.rng, CRUISE_MIN_S, CRUISE_MAX_S)
}

// Headline numbers for the results card.
export function drillSummary(d) {
  const solved = d.results.filter(r => r.solved)
  return {
    score: d.score,
    solved: solved.length,
    attempted: d.results.length,
    avgSeconds: solved.length ? solved.reduce((s, r) => s + r.seconds, 0) / solved.length : null,
    ringsHit: d.ringsHit,
    bullseyes: d.bullseyes,
    bestStreak: d.bestStreak,
  }
}

// On-screen names for each dial, used in the prompt.
export const DIAL_LABEL = {
  altitude: 'Altimeter',
  airspeed: 'Airspeed',
  heading: 'Heading',
  vs: 'Vertical Speed',
  turn: 'Turn',
  attitude: 'Attitude',
}

// What to do with the controls, per dial, for the prompt under the scene.
export const DIAL_HOW = {
  altitude: 'Climb or descend until both altimeter hands sit on the pink hands.',
  airspeed: 'Use the throttle until the needle sits on the pink needle.',
  heading: 'Bank to turn until the pink marker is at the top of the dial.',
  vs: 'Raise or lower the nose until the needle sits on the pink needle.',
  turn: 'Bank until the aircraft symbol lines up with the pink one.',
  attitude: 'Bank and pitch until the horizon lines up with the pink line.',
}
