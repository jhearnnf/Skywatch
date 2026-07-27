import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { pickAim, steerInput, gateCentre, wobbleAt, PILOT_DODGE } from '../actDemoPilot'

// The pilot's job is to fly ACT's tunnel like a person would, so the tests fly
// it: a stand-in tunnel, a row of gates, and the same integration the game
// runs, then look at what the scorer would have recorded.

// ── CbatAct's constants and integration, mirrored ──────────────────────────
const TUNNEL_RADIUS = 2.0
const BALL_RADIUS   = 0.18
const SHAPE_RADIUS  = 0.7
const TURN_RATE     = 0.006
const MAX_ROT_PER_TICK = 0.9
const MAX_FWD_DEVIATION_COS = Math.cos(Math.PI * 5 / 12)
const THREAD_RADIUS = SHAPE_RADIUS - BALL_RADIUS
const UP = new THREE.Vector3(0, 1, 0)

// A tunnel with the same character as buildTunnelCurve: a straight opening,
// then sweeping bends on alternating axes.
function testCurve() {
  const pts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 14),
    new THREE.Vector3(0, 0, 28),
    new THREE.Vector3(9, 0, 40),
    new THREE.Vector3(9, 6, 52),
    new THREE.Vector3(2, 6, 64),
    new THREE.Vector3(2, -3, 76),
    new THREE.Vector3(10, -3, 88),
  ]
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5)
}

// Gates spread down the tunnel, pushed off the axis the way the generator does.
function testGates(count = 10) {
  const out = []
  for (let i = 0; i < count; i++) {
    const spin = i * 1.7
    out.push({
      id: `g${i}`,
      t: 0.18 + (i * 0.075),
      offsetU: Math.cos(spin) * 0.9,
      offsetV: Math.sin(spin) * 0.9,
    })
  }
  return out
}

// One run of the demo pilot through the tunnel, integrated exactly as
// CbatAct's game loop does (rotate → clamp to cone → advance → re-project t →
// snap to wall → score the gates it just passed).
function fly(curve, events, { speed = 5, avoidId = null, wobble = true, dt = 1 / 60 } = {}) {
  const totalLen = curve.getLength()
  const maxR = TUNNEL_RADIUS - BALL_RADIUS
  const pos = curve.getPointAt(0)
  const fwd = curve.getTangentAt(0).normalize()
  let t = 0
  let idx = 0
  let elapsed = 0
  let scrapeS = 0
  const threaded = []
  const missed = []

  while (t < 1 && elapsed < 120) {
    const aim = pickAim(curve, events, t, {
      avoidTargetId: avoidId,
      wobble: wobble ? wobbleAt(elapsed) : 0,
    })
    const input = steerInput({ position: pos, forward: fwd, aim, turnRate: TURN_RATE, dt })

    // 1. steer
    const camRight = new THREE.Vector3().crossVectors(fwd, UP).normalize()
    const yaw   = Math.max(-MAX_ROT_PER_TICK, Math.min(MAX_ROT_PER_TICK, -input.dx * TURN_RATE))
    const pitch = Math.max(-MAX_ROT_PER_TICK, Math.min(MAX_ROT_PER_TICK,  input.dy * TURN_RATE))
    if (yaw)   fwd.applyAxisAngle(UP, yaw)
    if (pitch) fwd.applyAxisAngle(camRight, pitch)
    fwd.normalize()

    // Forward-deviation cone.
    const tan = curve.getTangentAt(t)
    const dot = fwd.dot(tan)
    if (dot < MAX_FWD_DEVIATION_COS) {
      const perp = fwd.clone().addScaledVector(tan, -dot)
      if (perp.length() > 1e-6) {
        perp.normalize()
        const sinDev = Math.sqrt(1 - MAX_FWD_DEVIATION_COS ** 2)
        fwd.copy(tan).multiplyScalar(MAX_FWD_DEVIATION_COS).addScaledVector(perp, sinDev)
      } else {
        fwd.copy(tan)
      }
    }

    // 2. advance + re-project onto the curve
    pos.addScaledVector(fwd, speed * dt)
    let bestT = t
    let bestDist = curve.getPointAt(t).distanceTo(pos)
    for (let i = 1; i <= 12; i++) {
      for (const sign of [1, -1]) {
        const ti = Math.min(1, Math.max(0, t + sign * 0.06 * (i / 12)))
        const d = curve.getPointAt(ti).distanceTo(pos)
        if (d < bestDist) { bestDist = d; bestT = ti }
      }
    }
    t = Math.max(t, bestT, Math.min(1, t + (speed * dt) / totalLen))

    // 3. wall
    const centre = curve.getPointAt(t)
    const tanNew = curve.getTangentAt(t)
    const lateral = pos.clone().sub(centre)
    lateral.addScaledVector(tanNew, -lateral.dot(tanNew))
    if (lateral.length() > maxR) {
      lateral.multiplyScalar(maxR / lateral.length())
      pos.copy(centre).add(lateral)
      scrapeS += dt
    }

    // 4. score whatever we just flew through
    while (idx < events.length && events[idx].t <= t) {
      const ev = events[idx++]
      const gc = gateCentre(curve, ev)
      const gTan = curve.getTangentAt(ev.t)
      const off = pos.clone().sub(gc)
      off.addScaledVector(gTan, -off.dot(gTan))
      ;(off.length() < THREAD_RADIUS ? threaded : missed).push(ev.id)
    }

    elapsed += dt
  }
  return { threaded, missed, scrapeS }
}

describe('steerInput', () => {
  it('turns the nose toward the aim point', () => {
    const position = new THREE.Vector3(0, 0, 0)
    const forward  = new THREE.Vector3(0, 0, 1)
    const aim      = new THREE.Vector3(3, 2, 10)

    const before = forward.angleTo(aim.clone().normalize())
    const { dx, dy } = steerInput({ position, forward, aim, turnRate: TURN_RATE, dt: 1 / 60 })

    // Fed back through the game's own conversion, exactly as the loop does it.
    const camRight = new THREE.Vector3().crossVectors(forward, UP).normalize()
    const after = forward.clone()
      .applyAxisAngle(UP, -dx * TURN_RATE)
      .applyAxisAngle(camRight, dy * TURN_RATE)
      .normalize()

    expect(after.angleTo(aim.clone().normalize())).toBeLessThan(before)
  })

  it('holds still when it is already pointed at the aim', () => {
    const { dx, dy } = steerInput({
      position: new THREE.Vector3(0, 0, 0),
      forward:  new THREE.Vector3(0, 0, 1),
      aim:      new THREE.Vector3(0, 0, 9),
      turnRate: TURN_RATE,
      dt: 1 / 60,
    })
    expect(Math.abs(dx)).toBeLessThan(1e-6)
    expect(Math.abs(dy)).toBeLessThan(1e-6)
  })

  it('never asks for more rotation in a frame than a steady hand would', () => {
    // Aim behind the ball — the worst case the controller can be handed.
    const { dx, dy } = steerInput({
      position: new THREE.Vector3(0, 0, 0),
      forward:  new THREE.Vector3(0, 0, 1),
      aim:      new THREE.Vector3(0, 0, -9),
      turnRate: TURN_RATE,
      dt: 1 / 60,
    })
    expect(Math.abs(dx * TURN_RATE)).toBeLessThanOrEqual(2.2 / 60 + 1e-9)
    expect(Math.abs(dy * TURN_RATE)).toBeLessThanOrEqual(2.2 / 60 + 1e-9)
  })
})

describe('pickAim', () => {
  const curve = testCurve()
  const events = testGates()

  it('aims at the centre of the next gate', () => {
    const aim = pickAim(curve, events, 0, { wobble: 0 })
    expect(aim.distanceTo(gateCentre(curve, events[0]))).toBeLessThan(1e-6)
  })

  it('skips gates already behind the ball', () => {
    const aim = pickAim(curve, events, events[2].t + 0.001, { wobble: 0 })
    expect(aim.distanceTo(gateCentre(curve, events[3]))).toBeLessThan(1e-6)
  })

  it('keeps the wobble small enough to still thread', () => {
    for (const w of [-1, -0.5, 0.5, 1]) {
      const aim = pickAim(curve, events, 0, { wobble: w })
      expect(aim.distanceTo(gateCentre(curve, events[0]))).toBeLessThan(THREAD_RADIUS)
    }
  })

  it('dodges wide of an avoid target without flying into the wall', () => {
    const target = events[0]
    const aim = pickAim(curve, events, 0, { avoidTargetId: target.id, wobble: 0 })

    const gTan = curve.getTangentAt(target.t)
    const fromGate = aim.clone().sub(gateCentre(curve, target))
    fromGate.addScaledVector(gTan, -fromGate.dot(gTan))
    expect(fromGate.length()).toBeGreaterThan(THREAD_RADIUS)

    const fromAxis = aim.clone().sub(curve.getPointAt(target.t))
    fromAxis.addScaledVector(gTan, -fromAxis.dot(gTan))
    expect(fromAxis.length()).toBeLessThanOrEqual(PILOT_DODGE + 1e-6)
    expect(PILOT_DODGE).toBeLessThan(TUNNEL_RADIUS - BALL_RADIUS)
  })

  it('rides the centreline home once the last gate is behind it', () => {
    const aim = pickAim(curve, events, 0.99, { wobble: 0 })
    expect(aim.distanceTo(curve.getPointAt(1))).toBeLessThan(1e-6)
  })
})

describe('flying the tunnel', () => {
  const curve = testCurve()

  it('threads nearly every gate', () => {
    const events = testGates()
    const { threaded, missed } = fly(curve, events)
    expect(threaded.length + missed.length).toBe(events.length)
    expect(threaded.length / events.length).toBeGreaterThanOrEqual(0.85)
  })

  it('holds up at the fastest round speed', () => {
    const events = testGates()
    const { threaded } = fly(curve, events, { speed: 6.5 })
    expect(threaded.length / events.length).toBeGreaterThanOrEqual(0.8)
  })

  it('misses the gate it was told to avoid, and only that one', () => {
    const events = testGates()
    const avoid = events[5]
    const { threaded, missed } = fly(curve, events, { avoidId: avoid.id })
    expect(missed).toContain(avoid.id)
    expect(threaded).not.toContain(avoid.id)
    expect(threaded.length / (events.length - 1)).toBeGreaterThanOrEqual(0.8)
  })

  it('keeps off the tunnel wall', () => {
    const { scrapeS } = fly(curve, testGates())
    expect(scrapeS).toBe(0)
  })

  it('wobbles — the flight is not a rail', () => {
    const events = testGates()
    const straight = fly(curve, events, { wobble: false })
    const human = fly(curve, events, { wobble: true })
    // Same competence, different line.
    expect(human.threaded.length).toBeGreaterThanOrEqual(straight.threaded.length - 2)
    expect(wobbleAt(0)).not.toBe(wobbleAt(1.7))
  })
})
