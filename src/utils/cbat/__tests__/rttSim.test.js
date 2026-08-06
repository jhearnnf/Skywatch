import { describe, it, expect } from 'vitest'
import {
  mulberry32, generateRttRun, makeRttSim, advanceRtt, fireShutter, rttStats,
  isTargetVisible, isTargetOccluded, targetDirectionAt, occlusionSpan,
  angularError, lookVector, polarToWorld, captureRadius, maxRttScore, isRunOver,
  activeTargetIndex, targetAngularSize,
  RTT_KINDS, RTT_SCORE, RTT_FRAMES_PER_TARGET, SHUTTER_COOLDOWN_MS,
  AZ_LIMIT_DEG, ELEV_MIN_DEG, ELEV_MAX_DEG, STATION_ALT_M, RTT_GAP_MS,
  TARGET_EXIT_MS, BASE_CAPTURE_DEG, AIRFRAME, airframeDisturbance,
  MAX_SEPARATION_DEG, MAX_ARC_DEG, START_ELEV_DEG, CAMERA_FOV_DEG,
  OCCLUSION_HEAD_MS, OCCLUSION_TAIL_MS, OCCLUSION_GAP_MS,
  MAX_OCCLUDED_FRACTION, MAX_OCCLUSION_ARC_FRAC,
} from '../rttSim'
import { RTT_TUNING } from '../rttDifficulty'

const DEG = Math.PI / 180
const HARD = RTT_TUNING.hard
const EASIER = RTT_TUNING.easier

// A shot aimed exactly at a target, as the scene would report it.
function shotAt(sim, index, errorRad = 0, occluded = false) {
  return fireShutter(sim, [{ index, errorRad, occluded }])
}

// Take a frame without tripping the shutter cooldown.
function shootAfterCooldown(sim, index, errorRad = 0, occluded = false) {
  advanceRtt(sim, SHUTTER_COOLDOWN_MS)
  return shotAt(sim, index, errorRad, occluded)
}

describe('geometry', () => {
  it('points azimuth 0 down -Z, positive azimuth to the right and positive elevation up', () => {
    const [x0, y0, z0] = lookVector(0, 0)
    expect(x0).toBeCloseTo(0)
    expect(y0).toBeCloseTo(0)
    expect(z0).toBeCloseTo(-1)
    expect(lookVector(90 * DEG, 0)[0]).toBeCloseTo(1)
    expect(lookVector(0, 30 * DEG)[1]).toBeCloseTo(0.5)
  })

  it('measures the angle between two look directions', () => {
    expect(angularError(0, 0, 0, 0)).toBeCloseTo(0)
    expect(angularError(0, 0, 10 * DEG, 0) / DEG).toBeCloseTo(10)
    expect(angularError(0, 0, 0, -7 * DEG) / DEG).toBeCloseTo(7)
    // Off-axis in both at once — genuinely spherical, not the sum of the two.
    const both = angularError(0, 0, 10 * DEG, 10 * DEG) / DEG
    expect(both).toBeGreaterThan(10)
    expect(both).toBeLessThan(20)
  })

  it('places a polar point at the stated range', () => {
    const p = polarToWorld(0.3, -0.2, 500)
    expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(500)
  })

  it('widens the capture cone on Easier', () => {
    expect(captureRadius(EASIER)).toBeGreaterThan(captureRadius(HARD))
  })
})

// The sensor is bolted to an aircraft, so the aim wanders and the player has to
// trim it out. The station itself never moves — see the note in rttSim.
describe('airframeDisturbance', () => {
  const sample = (scale = 1) => {
    const out = []
    for (let t = 0; t < 200; t += 0.017) out.push(airframeDisturbance(t, scale))
    return out
  }

  it('is a pure function of time', () => {
    expect(airframeDisturbance(12.34)).toEqual(airframeDisturbance(12.34))
    expect(airframeDisturbance(12.34)).not.toEqual(airframeDisturbance(12.35))
  })

  it('starts near centre, so a run does not open already off target', () => {
    const d = airframeDisturbance(0)
    expect(Math.abs(d.az) / DEG).toBeLessThan(0.4)
    expect(Math.abs(d.elev) / DEG).toBeLessThan(0.4)
  })

  it('stays well inside the capture cone — it costs centring, never the hit', () => {
    const cone = BASE_CAPTURE_DEG
    for (const d of sample()) {
      expect(Math.abs(d.az) / DEG).toBeLessThan(cone * 0.6)
      expect(Math.abs(d.elev) / DEG).toBeLessThan(cone * 0.6)
    }
  })

  it('actually moves — enough to have to be flown, not a rounding error', () => {
    const azs = sample().map(d => d.az / DEG)
    const swing = Math.max(...azs) - Math.min(...azs)
    expect(swing).toBeGreaterThan(AIRFRAME.wanderDeg)
  })

  it('rolls the horizon without touching the boresight', () => {
    // Roll turns the picture; it cannot move where the camera is pointing, so
    // it is free of any scoring consequence.
    const rolls = sample().map(d => Math.abs(d.roll) / DEG)
    expect(Math.max(...rolls)).toBeGreaterThan(0.2)
    expect(Math.max(...rolls)).toBeLessThanOrEqual(AIRFRAME.wanderRollDeg + 1e-9)
  })

  it('scales down for a steadier platform', () => {
    const full = sample(1).map(d => Math.abs(d.az))
    const gentle = sample(0.6).map(d => Math.abs(d.az))
    expect(Math.max(...gentle)).toBeLessThan(Math.max(...full))
    // Math.abs so a signed zero doesn't fail the comparison.
    const off = airframeDisturbance(9.5, 0)
    expect([off.az, off.elev, off.roll].map(Math.abs)).toEqual([0, 0, 0])
  })
})

describe('generateRttRun', () => {
  it('is deterministic for a seed', () => {
    const a = generateRttRun(HARD, mulberry32(42))
    const b = generateRttRun(HARD, mulberry32(42))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('produces the difficulty s target count', () => {
    expect(generateRttRun(HARD, mulberry32(1)).targets).toHaveLength(HARD.targets)
    expect(generateRttRun(EASIER, mulberry32(1)).targets).toHaveLength(EASIER.targets)
  })

  it('never overlaps two passes, and always leaves the stated gap', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { targets } = generateRttRun(HARD, mulberry32(seed))
      for (let i = 1; i < targets.length; i++) {
        expect(targets[i].tStartMs - targets[i - 1].tEndMs).toBe(RTT_GAP_MS)
      }
    }
  })

  it('keeps every pass inside the gimbal limits', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const tuning of [HARD, EASIER]) {
        const { targets } = generateRttRun(tuning, mulberry32(seed))
        for (const t of targets) {
          for (const az of [t.startAz, t.endAz]) {
            expect(Math.abs(az) / DEG).toBeLessThanOrEqual(AZ_LIMIT_DEG + 1e-6)
          }
          for (const elev of [t.startElev, t.endElev]) {
            expect(elev / DEG).toBeGreaterThanOrEqual(ELEV_MIN_DEG - 1e-6)
            expect(elev / DEG).toBeLessThanOrEqual(ELEV_MAX_DEG + 1e-6)
          }
        }
      }
    }
  })

  // Acquisition must never dominate the run. Every pass is a real slew from the
  // last one, but never a hunt across the whole gimbal — and the FIRST pass is
  // measured from where the camera actually starts, not from anywhere.
  it('places every pass a bounded slew from where the last one ended', () => {
    const gaps = []
    for (let seed = 1; seed <= 40; seed++) {
      for (const tuning of [HARD, EASIER]) {
        const { targets } = generateRttRun(tuning, mulberry32(seed))
        let from = 0 // the camera's starting azimuth
        for (const t of targets) {
          gaps.push(Math.abs(t.startAz - from) / DEG)
          from = t.endAz
        }
      }
    }

    // The hard bound: a pass whose own arc runs up against the gimbal limits
    // can be pushed past the requested band, but never further than the arc.
    // At the 55°/s slew rate even the worst case is about three seconds.
    for (const gap of gaps) expect(gap).toBeLessThanOrEqual(MAX_SEPARATION_DEG + MAX_ARC_DEG)

    // And that worst case has to stay rare — the normal experience is a slew
    // inside the band, not a sprint across the gimbal.
    const inBand = gaps.filter(g => g <= MAX_SEPARATION_DEG + 6).length
    expect(inBand / gaps.length).toBeGreaterThan(0.9)
  })

  it('starts the first pass within one slew of where the camera is pointing', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { targets } = generateRttRun(HARD, mulberry32(seed))
      expect(Math.abs(targets[0].startAz) / DEG).toBeLessThanOrEqual(MAX_SEPARATION_DEG + 6)
    }
  })

  it('puts the ground targets below where the camera starts looking', () => {
    // START_ELEV_DEG exists so a run does not open by having to pitch down
    // before anything can be found at all.
    for (const kind of ['static', 'person', 'boat', 'vehicle']) {
      expect(RTT_KINDS[kind].elevDeg[1]).toBeLessThan(0)
    }
    expect(START_ELEV_DEG).toBeLessThan(0)
    expect(START_ELEV_DEG).toBeGreaterThan(ELEV_MIN_DEG)
  })

  it('opens on the gentlest kind and only uses the difficulty s roster', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const tuning of [HARD, EASIER]) {
        const { targets } = generateRttRun(tuning, mulberry32(seed))
        expect(targets[0].kind).toBe(tuning.kinds[0])
        for (const t of targets) expect(tuning.kinds).toContain(t.kind)
      }
    }
  })

  it('never puts fast air in an Easier run', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { targets } = generateRttRun(EASIER, mulberry32(seed))
      expect(targets.some(t => t.kind === 'jet')).toBe(false)
    }
  })

  it('sits ground targets on the ground plane, at the range their depression implies', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { targets } = generateRttRun(HARD, mulberry32(seed))
      for (const t of targets.filter(t => t.ground)) {
        // Constant depression across the pass — a circle around the station.
        expect(t.startElev).toBeCloseTo(t.endElev)
        const y = polarToWorld(t.startAz, t.startElev, t.range)[1]
        expect(y).toBeCloseTo(-STATION_ALT_M, 0)
      }
    }
  })

  it('crosses at the rate the kind s real speed implies', () => {
    // A jet must cover far more sky than a walker in its window, without either
    // number being tuned by hand — the arc is speed ÷ range × window.
    const { targets } = generateRttRun(HARD, mulberry32(11))
    const arc = t => Math.abs(t.endAz - t.startAz)
    const person = targets.find(t => t.kind === 'person')
    const jet = targets.find(t => t.kind === 'jet')
    expect(arc(jet)).toBeGreaterThan(arc(person) * 5)
    expect(targets.find(t => t.kind === 'static').startAz)
      .toBe(targets.find(t => t.kind === 'static').endAz)
  })

  it('slows every pass down on Easier without touching its window', () => {
    // Same seed, same kinds up to the roster difference — the shared kinds must
    // cover less sky on Easier and take exactly as long doing it.
    for (const kind of EASIER.kinds) {
      expect(RTT_KINDS[kind].windowMs).toBe(RTT_KINDS[kind].windowMs)
    }
    const hard = generateRttRun(HARD, mulberry32(5)).targets
    const easier = generateRttRun(EASIER, mulberry32(5)).targets
    const arcPerSec = t => Math.abs(t.endAz - t.startAz) / (t.windowMs / 1000) * t.range
    const h = hard.find(t => t.kind === 'vehicle')
    const e = easier.find(t => t.kind === 'vehicle')
    expect(e.windowMs).toBe(h.windowMs)
    expect(arcPerSec(e)).toBeLessThan(arcPerSec(h))
  })

  // Going behind cover must be a test of prediction, never a way to lose a
  // target for good. Each of these is one of the guarantees that makes that
  // true — a player on the target when it disappeared always gets a real
  // chance at every frame they are still owed.
  describe('occlusion fairness', () => {
    const everyPass = (fn) => {
      for (let seed = 1; seed <= 60; seed++) {
        for (const tuning of [HARD, EASIER]) {
          for (const t of generateRttRun(tuning, mulberry32(seed)).targets) fn(t, tuning)
        }
      }
    }

    it('leaves a clear stretch to acquire before any cover starts', () => {
      everyPass((t) => {
        for (const o of t.occlusions) expect(o.fromMs).toBeGreaterThanOrEqual(OCCLUSION_HEAD_MS)
      })
    })

    it('leaves enough clear time after the last cover for all three frames', () => {
      // Two shutter cooldowns to take three frames, and the rest to re-acquire.
      const needed = (RTT_FRAMES_PER_TARGET - 1) * SHUTTER_COOLDOWN_MS
      expect(OCCLUSION_TAIL_MS).toBeGreaterThan(needed)
      everyPass((t) => {
        for (const o of t.occlusions) {
          expect(t.windowMs - o.toMs).toBeGreaterThanOrEqual(OCCLUSION_TAIL_MS)
        }
      })
    })

    // THE one the whole thing turns on. If a target moves further than the
    // frame while it is hidden, it comes back somewhere the player cannot see
    // and the pass is lost rather than merely interrupted.
    it('never hides a target long enough for it to re-emerge outside the frame', () => {
      everyPass((t) => {
        const ratePerMs = Math.abs(t.endAz - t.startAz) / t.windowMs
        for (const o of t.occlusions) {
          const arcWhileHidden = ratePerMs * (o.toMs - o.fromMs) / DEG
          expect(arcWhileHidden).toBeLessThanOrEqual(MAX_OCCLUSION_ARC_FRAC * CAMERA_FOV_DEG + 0.01)
        }
      })
    })

    it('caps how much of a pass can be spent hidden', () => {
      everyPass((t) => {
        const hidden = t.occlusions.reduce((n, o) => n + (o.toMs - o.fromMs), 0)
        expect(hidden).toBeLessThanOrEqual(t.windowMs * MAX_OCCLUDED_FRACTION + 2)
      })
    })

    it('leaves room to re-acquire and shoot between two stretches of cover', () => {
      everyPass((t) => {
        for (let i = 1; i < t.occlusions.length; i++) {
          const gap = t.occlusions[i].fromMs - t.occlusions[i - 1].toMs
          expect(gap).toBeGreaterThanOrEqual(OCCLUSION_GAP_MS)
          expect(gap).toBeGreaterThan(SHUTTER_COOLDOWN_MS)
        }
      })
    })

    it('stays within the difficulty s count, and inside the window', () => {
      everyPass((t, tuning) => {
        expect(t.occlusions.length).toBeLessThanOrEqual(tuning.maxOcclusions)
        for (const o of t.occlusions) {
          expect(o.toMs).toBeGreaterThan(o.fromMs)
          expect(o.toMs).toBeLessThan(t.windowMs)
        }
      })
    })

    // The rule has to bite where it matters: fast air is exactly the case that
    // was losing targets behind cloud.
    it('hides fast air for a much shorter time than a walker', () => {
      const longest = (kind) => {
        let best = 0
        for (let seed = 1; seed <= 60; seed++) {
          for (const t of generateRttRun(HARD, mulberry32(seed)).targets) {
            if (t.kind !== kind) continue
            for (const o of t.occlusions) best = Math.max(best, o.toMs - o.fromMs)
          }
        }
        return best
      }
      const jet = longest('jet')
      const person = longest('person')
      expect(jet).toBeGreaterThan(0)
      expect(jet).toBeLessThan(person)
    })
  })

  it('gives Easier at most one, shorter occlusion per pass', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { targets } = generateRttRun(EASIER, mulberry32(seed))
      for (const t of targets) {
        expect(t.occlusions.length).toBeLessThanOrEqual(1)
        for (const o of t.occlusions) expect(o.toMs - o.fromMs).toBeLessThanOrEqual(2100 * EASIER.occlusionScale + 1)
      }
    }
  })
})

describe('target state', () => {
  it('is visible only inside its window', () => {
    const { targets } = generateRttRun(HARD, mulberry32(3))
    const t = targets[0]
    expect(isTargetVisible(t, t.tStartMs - 1)).toBe(false)
    expect(isTargetVisible(t, t.tStartMs)).toBe(true)
    expect(isTargetVisible(t, t.tEndMs - 1)).toBe(true)
    expect(isTargetVisible(t, t.tEndMs)).toBe(false)
  })

  it('walks from its start direction to its end direction', () => {
    const { targets } = generateRttRun(HARD, mulberry32(3))
    const t = targets.find(x => x.startAz !== x.endAz)
    expect(targetDirectionAt(t, t.tStartMs).az).toBeCloseTo(t.startAz)
    expect(targetDirectionAt(t, t.tEndMs).az).toBeCloseTo(t.endAz)
    expect(targetDirectionAt(t, t.tStartMs + t.windowMs / 2).az)
      .toBeCloseTo((t.startAz + t.endAz) / 2)
  })

  // The scene keeps a finished target on screen for TARGET_EXIT_MS so it can be
  // SEEN to leave rather than blinking out. Two things have to hold for that.
  it('can extrapolate past the window, so an exiting target keeps travelling', () => {
    const { targets } = generateRttRun(HARD, mulberry32(3))
    // The fastest pass in the run, so the extrapolation is a real distance
    // rather than a rounding-sized nudge.
    const t = [...targets].sort((a, b) =>
      Math.abs(b.endAz - b.startAz) - Math.abs(a.endAz - a.startAz))[0]
    const overrun = TARGET_EXIT_MS / 2
    const after = t.tEndMs + overrun

    // Clamped (the default, and what scoring uses) freezes at the end.
    expect(targetDirectionAt(t, after).az).toBeCloseTo(t.endAz)
    // Unclamped carries on down the track at the same rate it was travelling.
    const drift = targetDirectionAt(t, after, false).az
    const perMs = (t.endAz - t.startAz) / t.windowMs
    expect(drift - t.endAz).toBeCloseTo(perMs * overrun, 6)
    expect(Math.sign(drift - t.endAz)).toBe(Math.sign(t.endAz - t.startAz))
  })

  it('finishes its exit before the next pass begins', () => {
    // Otherwise a target still fading off screen would overlap the next one,
    // and the scene mounts exactly one target at a time.
    expect(TARGET_EXIT_MS).toBeLessThan(RTT_GAP_MS)
  })

  it('reports occluded exactly across the stretch the generator placed', () => {
    const { targets } = generateRttRun(HARD, mulberry32(7))
    const t = targets.find(x => x.occlusions.length > 0)
    const o = t.occlusions[0]
    expect(isTargetOccluded(t, t.tStartMs + o.fromMs - 1)).toBe(false)
    expect(isTargetOccluded(t, t.tStartMs + o.fromMs)).toBe(true)
    expect(isTargetOccluded(t, t.tStartMs + o.toMs - 1)).toBe(true)
    expect(isTargetOccluded(t, t.tStartMs + o.toMs)).toBe(false)
  })

  // The occluder in the scene is built from this, so it has to describe the arc
  // the target actually walks — otherwise what the player sees and what the sim
  // scores drift apart.
  it('describes an occlusion s arc so the scene can cover exactly it', () => {
    const { targets } = generateRttRun(HARD, mulberry32(7))
    const t = targets.find(x => x.occlusions.length > 0 && x.startAz !== x.endAz)
    const o = t.occlusions[0]
    const span = occlusionSpan(t, o)
    const a = targetDirectionAt(t, t.tStartMs + o.fromMs)
    const b = targetDirectionAt(t, t.tStartMs + o.toMs)
    expect(span.az).toBeCloseTo((a.az + b.az) / 2)
    expect(span.halfArc * 2).toBeCloseTo(angularError(a.az, a.elev, b.az, b.elev))
    expect(targetAngularSize(t)).toBeCloseTo(t.size / t.range)
  })
})

describe('shutter scoring', () => {
  const sim = () => makeRttSim(HARD, mulberry32(9))

  it('starts the clock before the first target, so nothing is on screen', () => {
    const s = sim()
    expect(activeTargetIndex(s)).toBe(-1)
    advanceRtt(s, s.run.targets[0].tStartMs)
    expect(activeTargetIndex(s)).toBe(0)
  })

  it('pays more for a frame closer to dead centre', () => {
    const centre = sim()
    advanceRtt(centre, centre.run.targets[0].tStartMs + 100)
    const perfect = shotAt(centre, 0, 0)

    const edge = sim()
    advanceRtt(edge, edge.run.targets[0].tStartMs + 100)
    const scraped = shotAt(edge, 0, edge.captureRad * 0.99)

    expect(perfect.kind).toBe('hit')
    expect(scraped.kind).toBe('hit')
    expect(perfect.points).toBe(RTT_SCORE.frameBase + RTT_SCORE.frameCentreBonus)
    expect(scraped.points).toBeLessThan(perfect.points)
    expect(scraped.points).toBeGreaterThanOrEqual(RTT_SCORE.frameBase)
  })

  it('completes a target on the third frame and pays the bonus once', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tStartMs + 100)
    expect(shotAt(s, 0).completed).toBeFalsy()
    expect(shootAfterCooldown(s, 0).completed).toBeFalsy()
    const third = shootAfterCooldown(s, 0)
    expect(third.completed).toBe(true)
    expect(third.points).toBe(RTT_SCORE.frameBase + RTT_SCORE.frameCentreBonus + RTT_SCORE.targetComplete)
    expect(s.targetsCompleted).toBe(1)

    // A fourth frame has nothing left to hit — the target is resolved.
    const fourth = shootAfterCooldown(s, 0)
    expect(fourth.kind).toBe('miss')
    expect(s.targetsCompleted).toBe(1)
  })

  it('refuses a second frame inside the shutter cooldown, without penalty', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tStartMs + 100)
    shotAt(s, 0)
    const before = s.score
    const blocked = shotAt(s, 0)
    expect(blocked.kind).toBe('cooldown')
    expect(blocked.points).toBe(0)
    expect(s.score).toBe(before)
    expect(s.framesTaken).toBe(1)   // a blocked press is not a frame at all

    advanceRtt(s, SHUTTER_COOLDOWN_MS)
    expect(shotAt(s, 0).kind).toBe('hit')
  })

  it('cannot be farmed by holding the trigger down', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tStartMs + 100)
    // 60 presses in a single frame of animation.
    for (let i = 0; i < 60; i++) shotAt(s, 0)
    expect(s.progress[0].frames).toBe(1)
  })

  it('wastes a frame fired outside the capture cone', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tStartMs + 100)
    const res = shotAt(s, 0, s.captureRad * 1.01)
    expect(res.kind).toBe('miss')
    expect(s.score).toBe(RTT_SCORE.wastedFrame)
    expect(s.progress[0].frames).toBe(0)
  })

  it('wastes a frame fired through cover, and says so', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tStartMs + 100)
    const res = shotAt(s, 0, 0, true)
    expect(res.kind).toBe('occluded')
    expect(s.score).toBe(RTT_SCORE.wastedFrame)
    expect(s.progress[0].frames).toBe(0)
  })

  it('wastes a frame fired at nothing at all', () => {
    const s = sim()
    const res = fireShutter(s, [])
    expect(res.kind).toBe('miss')
    expect(s.score).toBe(RTT_SCORE.wastedFrame)
  })

  it('picks the best-centred eligible target when more than one is offered', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tStartMs + 100)
    const res = fireShutter(s, [
      { index: 1, errorRad: s.captureRad * 0.8, occluded: false },
      { index: 0, errorRad: s.captureRad * 0.1, occluded: false },
    ])
    expect(res.targetIndex).toBe(0)
  })

  it('books the shortfall once when a pass closes unfinished', () => {
    const s = sim()
    const t = s.run.targets[0]
    advanceRtt(s, t.tStartMs + 100)
    shotAt(s, 0)                                   // one frame of three
    advanceRtt(s, t.windowMs)                      // window closes
    const owed = RTT_FRAMES_PER_TARGET - 1
    expect(s.progress[0].resolved).toBe(true)
    const afterLoss = s.score
    expect(afterLoss).toBe((RTT_SCORE.frameBase + RTT_SCORE.frameCentreBonus) + owed * RTT_SCORE.missedFrame)
    advanceRtt(s, 5000)                            // no double charge
    expect(s.score).toBe(afterLoss)
  })

  it('costs a completely missed target the whole completion bonus', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tEndMs)
    expect(s.score).toBe(RTT_FRAMES_PER_TARGET * RTT_SCORE.missedFrame)
    expect(RTT_FRAMES_PER_TARGET * -RTT_SCORE.missedFrame).toBe(RTT_SCORE.targetComplete)
  })

  it('runs out when the last pass is done', () => {
    const s = sim()
    expect(isRunOver(s)).toBe(false)
    advanceRtt(s, s.durationMs)
    expect(isRunOver(s)).toBe(true)
  })
})

describe('rttStats', () => {
  it('reports the run, including average centring in degrees', () => {
    const s = makeRttSim(HARD, mulberry32(4))
    advanceRtt(s, s.run.targets[0].tStartMs + 50)
    shotAt(s, 0, 0)
    shootAfterCooldown(s, 0, s.captureRad)          // 0° then the full cone
    shootAfterCooldown(s, 0, 0)
    shootAfterCooldown(s, 0, s.captureRad * 2)      // a wasted frame

    const stats = rttStats(s)
    expect(stats.framesTaken).toBe(4)
    expect(stats.framesOnTarget).toBe(3)
    expect(stats.targetsCompleted).toBe(1)
    expect(stats.totalTargets).toBe(HARD.targets)
    expect(stats.avgCentringErrorDeg).toBeCloseTo((s.captureRad / 3) / DEG, 2)
  })

  it('reports zero average centring rather than NaN when nothing landed', () => {
    const s = makeRttSim(HARD, mulberry32(4))
    expect(rttStats(s).avgCentringErrorDeg).toBe(0)
  })
})

describe('maxRttScore', () => {
  it('is three dead-centre frames plus the bonus, per target', () => {
    const perTarget = RTT_FRAMES_PER_TARGET * (RTT_SCORE.frameBase + RTT_SCORE.frameCentreBonus) + RTT_SCORE.targetComplete
    expect(maxRttScore(HARD)).toBe(HARD.targets * perTarget)
    expect(maxRttScore(EASIER)).toBeLessThan(maxRttScore(HARD))
  })

  it('is actually reachable by a flawless run', () => {
    const s = makeRttSim(EASIER, mulberry32(2))
    for (let i = 0; i < s.run.targets.length; i++) {
      const t = s.run.targets[i]
      s.elapsedMs = t.tStartMs + 10
      for (let f = 0; f < RTT_FRAMES_PER_TARGET; f++) {
        advanceRtt(s, SHUTTER_COOLDOWN_MS)
        expect(shotAt(s, i, 0).kind).toBe('hit')
      }
    }
    advanceRtt(s, s.durationMs)
    expect(rttStats(s).totalScore).toBe(maxRttScore(EASIER))
  })

  // A run where nothing is even attempted must be clearly negative, so a grade
  // of "Failed" is impossible to reach by doing nothing well.
  it('leaves a do-nothing run deep in Failed territory', () => {
    const s = makeRttSim(HARD, mulberry32(2))
    advanceRtt(s, s.durationMs)
    expect(rttStats(s).totalScore).toBeLessThan(0)
  })
})
