import { describe, it, expect } from 'vitest'
import {
  createDrill, stepDrill, createFlight, stepFlight, telemetry, makeChallenge, challengeMatched,
  challengePoints, buildCourse, ringCrossing, makeRng, angleDiff, drillSummary, turnNeedleFor, pitchFromAxes,
  CHALLENGE_KINDS, DRILL_SECONDS, CHALLENGE_TIMEOUT_S, STANDARD_RATE, TURN_GAIN, VS_GAIN, VS_REFERENCE_SPEED,
  MAX_POINTS, MIN_POINTS, RING_POINTS, BULLSEYE_POINTS, TURN_NEEDLE_AT_STANDARD, worldY, ALT_MIN_GAP, ALT_MAX_GAP, TOLERANCE,
} from '../instrumentsDrill'

const DT = 1 / 60
const clamp1 = v => Math.max(-1, Math.min(1, v))
const DEG = Math.PI / 180

// A crude pilot that flies whichever dial is lit onto its target, and flies
// wings level at the current height otherwise. If it can solve every
// challenge the generator sets, the targets are reachable in time.
function autopilot(d) {
  const f = d.flight
  const c = d.challenge
  let bank = 0
  let pitch = 0
  let throttle = 0
  if (c && d.phase === 'challenge') {
    switch (c.kind) {
      case 'altitude': pitch = Math.max(-15, Math.min(15, (c.target - f.altitude) / 15)); break
      case 'airspeed': throttle = Math.abs(c.target - f.speed) > 3 ? Math.sign(c.target - f.speed) : 0; break
      case 'heading': bank = Math.max(-45, Math.min(45, angleDiff(f.headingDeg, c.target) * 0.8)); break
      case 'vs': pitch = Math.asin(Math.max(-1, Math.min(1, c.target / (((f.speed + VS_REFERENCE_SPEED) / 2) * 101.2686 * VS_GAIN)))) / DEG; break
      case 'turn': bank = Math.atan((c.target * DEG * f.speed * 0.514444) / (TURN_GAIN * 9.81)) / DEG; break
      case 'attitude': bank = c.target.bank; pitch = c.target.pitch; break
    }
  }
  return {
    roll: clamp1((bank - f.bankDeg) / 4),
    pitch: clamp1((pitch - f.pitchDeg) / 2),
    throttle,
  }
}

function fly(seed) {
  const d = createDrill({ seed })
  const events = []
  let guard = 0
  while (d.phase !== 'done' && guard++ < DRILL_SECONDS * 70) {
    events.push(...stepDrill(d, autopilot(d), DT))
  }
  return { d, events }
}

describe('instruments drill flight model', () => {
  it('holds bank and pitch when the stick is let go', () => {
    const f = createFlight()
    for (let i = 0; i < 20; i++) stepFlight(f, { roll: 1, pitch: 1 }, DT)
    const { bankDeg, pitchDeg } = f
    for (let i = 0; i < 60; i++) stepFlight(f, {}, DT)
    expect(f.bankDeg).toBeCloseTo(bankDeg)
    expect(f.pitchDeg).toBeCloseTo(pitchDeg)
  })

  it('turns right in a right bank and climbs nose up, and the dials agree', () => {
    const f = createFlight()
    f.bankDeg = 30
    f.pitchDeg = 5
    const h0 = f.headingDeg
    const a0 = f.altitude
    for (let i = 0; i < 60; i++) stepFlight(f, {}, DT)
    const t = telemetry(f)
    expect(angleDiff(h0, f.headingDeg)).toBeGreaterThan(5)
    expect(f.altitude).toBeGreaterThan(a0)
    expect(t.turnRate).toBeGreaterThan(0)
    expect(t.turnNeedle).toBeGreaterThan(0)
    expect(t.vsFpm).toBeGreaterThan(0)
  })

  it('puts the turn needle on the standard-rate mark at standard rate', () => {
    expect(turnNeedleFor(STANDARD_RATE)).toBe(TURN_NEEDLE_AT_STANDARD)
    expect(turnNeedleFor(-STANDARD_RATE)).toBe(-TURN_NEEDLE_AT_STANDARD)
  })

  it('flies north along -z at heading 0 and east along +x at 090', () => {
    const f = createFlight({ headingDeg: 0 })
    stepFlight(f, {}, 1)
    expect(f.z).toBeLessThan(0)
    expect(Math.abs(f.x)).toBeLessThan(1e-6)
    const g = createFlight({ headingDeg: 90 })
    stepFlight(g, {}, 1)
    expect(g.x).toBeGreaterThan(0)
  })

  it('never flies through the floor', () => {
    const f = createFlight()
    f.pitchDeg = -25
    for (let i = 0; i < 60 * 60; i++) stepFlight(f, {}, DT)
    expect(f.altitude).toBeGreaterThanOrEqual(500)
  })
})

describe('instruments drill pitch controls', () => {
  // Flown like a real aircraft on every control (user's call, 2026-09-23).
  // smaInput's y: -1 = up arrow / W / drag away; for a joystick +1 = pushed
  // forward, -1 = pulled back.
  it('pushes the nose down on the up arrow, W or a drag away from you', () => {
    for (const source of ['keyboard', 'pad', 'pointer']) {
      expect(pitchFromAxes(source, -1)).toBeLessThan(0)
      expect(pitchFromAxes(source, 1)).toBeGreaterThan(0)
    }
  })

  it('leaves the joystick as it was: forward is nose down, back is nose up', () => {
    expect(pitchFromAxes('gamepad', 1)).toBeLessThan(0)
    expect(pitchFromAxes('gamepad', -1)).toBeGreaterThan(0)
  })

  it('does nothing with the stick centred, on any control', () => {
    for (const source of ['keyboard', 'pad', 'pointer', 'gamepad', undefined]) {
      expect(pitchFromAxes(source, 0)).toBe(0)
    }
  })
})

describe('instruments drill challenges', () => {
  it('never sets a target that is already met', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = makeRng(seed)
      const f = createFlight({ headingDeg: Math.floor(rng() * 360) })
      f.bankDeg = (rng() - 0.5) * 80
      f.pitchDeg = (rng() - 0.5) * 30
      f.speed = 150 + rng() * 170
      f.altitude = 1000 + rng() * 8000
      const t = telemetry(f)
      for (const kind of CHALLENGE_KINDS) {
        const c = makeChallenge(kind, t, rng)
        expect({ seed, kind, met: challengeMatched(c, t) }).toEqual({ seed, kind, met: false })
      }
    }
  })

  // 200-400 ft took too long to fly (user, 2026-09-23): altitude targets are
  // a short climb or descent, but never so short the match is already made.
  it('sets altitude targets 100-225 ft away, clear of the match window, on a 50 ft mark', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const rng = makeRng(seed)
      const f = createFlight()
      f.altitude = 500 + rng() * 9300
      const c = makeChallenge('altitude', telemetry(f), rng)
      const gap = Math.abs(c.target - f.altitude)
      expect(gap).toBeGreaterThanOrEqual(ALT_MIN_GAP)
      expect(gap).toBeLessThanOrEqual(ALT_MAX_GAP)
      expect(gap).toBeGreaterThan(TOLERANCE.altitude)
      expect(c.target % 50).toBe(0)
    }
  })

  it('scores a quick match 10 and a slow one 5', () => {
    expect(challengePoints(1)).toBe(MAX_POINTS)
    expect(challengePoints(9)).toBeGreaterThan(MIN_POINTS)
    expect(challengePoints(9)).toBeLessThan(MAX_POINTS)
    expect(challengePoints(CHALLENGE_TIMEOUT_S)).toBe(MIN_POINTS)
  })

  it('can solve every challenge it sets, across many drills', () => {
    const kindsSeen = new Set()
    for (let seed = 1; seed <= 40; seed++) {
      const { d } = fly(seed)
      expect(d.phase).toBe('done')
      for (const r of d.results) {
        kindsSeen.add(r.kind)
        expect({ seed, kind: r.kind, solved: r.solved }).toEqual({ seed, kind: r.kind, solved: true })
      }
      expect(d.results.length).toBeGreaterThanOrEqual(4)
    }
    expect([...kindsSeen].sort()).toEqual([...CHALLENGE_KINDS].sort())
  })

  it('never lights the same dial twice in a row', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { events } = fly(seed)
      const kinds = events.filter(e => e.type === 'challenge').map(e => e.kind)
      for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1])
    }
  })

  it('adds up the score from rings and matches', () => {
    const { d } = fly(7)
    const matchPoints = d.results.reduce((s, r) => s + r.points, 0)
    // A bullseye is a gate too, worth BULLSEYE_POINTS instead of RING_POINTS.
    expect(d.score).toBe(matchPoints + (d.ringsHit - d.bullseyes) * RING_POINTS + d.bullseyes * BULLSEYE_POINTS)
    const s = drillSummary(d)
    expect(s.solved).toBe(d.results.length)
    expect(s.avgSeconds).toBeGreaterThan(0)
  })

  it('times out a challenge that is never flown and moves on', () => {
    const d = createDrill({ seed: 3 })
    const events = []
    while (d.phase !== 'done') events.push(...stepDrill(d, {}, DT))
    const timeouts = events.filter(e => e.type === 'timeout')
    expect(timeouts.length).toBeGreaterThan(0)
    expect(d.results.every(r => !r.solved || r.points > 0)).toBe(true)
  })
})

describe('instruments drill course', () => {
  it('lays a new course ahead of the aircraft whichever way it is pointing', () => {
    for (const heading of [0, 90, 180, 270, 45]) {
      const f = createFlight({ headingDeg: heading })
      f.x = 100
      f.z = -40
      const rings = buildCourse(f, makeRng(heading + 1))
      const fwd = { x: Math.sin(heading * DEG), z: -Math.cos(heading * DEG) }
      for (const r of rings) {
        const ahead = (r.x - f.x) * fwd.x + (r.z - f.z) * fwd.z
        expect(ahead).toBeGreaterThan(0)
      }
    }
  })

  it('counts a ring flown through the middle as hit and one flown past as missed', () => {
    const f = createFlight()
    const [ring] = buildCourse(f, makeRng(1))
    const y = worldY(f.altitude)
    const before = { x: ring.x, y, z: ring.z + 1 }
    const after = { x: ring.x, y, z: ring.z - 1 }
    expect(ringCrossing(ring, before, after)).toBe('bullseye')
    // Off centre but inside the hoop: a plain hit.
    expect(ringCrossing(ring, { ...before, x: ring.x + 1.8 }, { ...after, x: ring.x + 1.8 })).toBe('hit')
    expect(ringCrossing(ring, { ...before, x: ring.x + 10 }, { ...after, x: ring.x + 10 })).toBe('missed')
    expect(ringCrossing(ring, { ...before, z: ring.z + 5 }, before)).toBe(null)
  })

  it('clears the rings during a challenge and brings a course back after', () => {
    const d = createDrill({ seed: 11 })
    let sawChallenge = false
    while (d.phase !== 'done') {
      stepDrill(d, autopilot(d), DT)
      if (d.phase === 'challenge') { sawChallenge = true; expect(d.rings).toEqual([]) }
      if (d.phase === 'cruise' && sawChallenge) { expect(d.rings.length).toBeGreaterThan(0); break }
    }
    expect(sawChallenge).toBe(true)
  })
})
