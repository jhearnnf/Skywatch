import { describe, it, expect } from 'vitest'
import {
  mulberry32, generateRttRun, makeRttSim, advanceRtt, fireShutter, rttStats,
  isTargetVisible, isTargetOccluded, targetDirectionAt, targetWorldAt,
  angularError, lookVector, polarToWorld, captureRadius, maxRttScore, isRunOver,
  activeTargetIndex, targetAngularSize, stationAt, directionOf, coverBlocks,
  trackRtt, isLocked, trackingPoints, zoomStep, fovForZoom, reticleHeightPercent,
  RTT_KINDS, RTT_SCORE, RTT_TRACK_SCORE, RTT_LOCK_MS, RTT_FRAMES_PER_TARGET, SHUTTER_COOLDOWN_MS,
  AZ_LIMIT_DEG, ELEV_MIN_DEG, ELEV_MAX_DEG, STATION_ALT_M, RTT_GAP_MS,
  TARGET_EXIT_MS, BASE_CAPTURE_DEG, AIRFRAME, airframeDisturbance,
  MAX_SEPARATION_DEG, MAX_ARC_DEG, START_ELEV_DEG, CAMERA_FOV_DEG, WIDE_FOV_DEG,
  ZOOM_IN_DEG, ZOOM_OUT_DEG, ZOOM_TIME_MS, PLATFORM_SPEED_MPS, MAX_TARGET_RANGE_M,
  KIND_MOTION, TARGET_PREVIEW_MS, manoeuvreDurationMs, RTT_LOOKS, TARGET_NAMES,
  OCCLUSION_HEAD_MS, OCCLUSION_TAIL_MS, OCCLUSION_GAP_MS,
  MAX_OCCLUDED_FRACTION, MAX_OCCLUSION_ARC_FRAC,
} from '../rttSim'
import { RTT_TUNING, rttTuning } from '../rttDifficulty'

const DEG = Math.PI / 180
const HARD = RTT_TUNING.hard
const EASIER = RTT_TUNING.easier
const CBAT_HARD = rttTuning('hard', true)
const CBAT_EASIER = rttTuning('easier', true)
const ALL_TUNINGS = [HARD, EASIER, CBAT_HARD, CBAT_EASIER]

// How far a target moves through the world in its window, in m/s: the length
// of its track over the time. Only the pass itself — the track also runs back
// before it, for the target's early appearance.
function worldSpeed(t) {
  let len = 0
  const pass = t.track.filter(pt => pt.t >= 0)
  for (let i = 1; i < pass.length; i++) {
    const a = pass[i - 1].p, b = pass[i].p
    len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return len / (t.windowMs / 1000)
}

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
// trim it out, on top of the aircraft's steady flight.
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

  // Seen from the MOVING aircraft, at every moment of the pass — not just its
  // ends. A target the aircraft flies towards gets steeper below it, and one
  // that turns can swing anywhere.
  it('keeps every pass inside the gimbal limits and short of the fog, all the way through', () => {
    // The extremes over every moment of every pass, asserted once: a few
    // hundred thousand separate expect() calls take longer than the test limit.
    let maxAz = 0, minElev = Infinity, maxElev = -Infinity, maxRange = 0
    for (let seed = 1; seed <= 40; seed++) {
      for (const tuning of ALL_TUNINGS) {
        const { targets } = generateRttRun(tuning, mulberry32(seed))
        for (const t of targets) {
          for (let k = 0; k <= t.windowMs; k += 50) {
            const d = targetDirectionAt(t, t.tStartMs + k)
            maxAz = Math.max(maxAz, Math.abs(d.az))
            minElev = Math.min(minElev, d.elev)
            maxElev = Math.max(maxElev, d.elev)
            maxRange = Math.max(maxRange, d.range)
          }
        }
      }
    }
    expect(maxAz / DEG).toBeLessThanOrEqual(AZ_LIMIT_DEG)
    expect(minElev / DEG).toBeGreaterThanOrEqual(ELEV_MIN_DEG)
    expect(maxElev / DEG).toBeLessThanOrEqual(ELEV_MAX_DEG)
    expect(maxRange).toBeLessThanOrEqual(MAX_TARGET_RANGE_M)
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

  it('sits ground targets on the ground plane for their whole track', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const tuning of [HARD, CBAT_HARD]) {
        const { targets } = generateRttRun(tuning, mulberry32(seed))
        for (const t of targets.filter(t => t.ground)) {
          for (const pt of t.track) expect(pt.p[1]).toBeCloseTo(-STATION_ALT_M, 6)
        }
      }
    }
  })

  it('moves each kind through the world at its own speed', () => {
    // Real speeds, not angles: a foot patrol walks and a jet flies, whatever
    // the aircraft is doing. A jet's speed is capped (MAX_ARC_DEG) but still
    // far beyond a walker's, and a static installation does not move at all.
    const { targets } = generateRttRun(HARD, mulberry32(11))
    const person = targets.find(t => t.kind === 'person')
    const jet = targets.find(t => t.kind === 'jet')
    expect(worldSpeed(person)).toBeLessThan(RTT_KINDS.person.speedMps * 1.2)
    expect(worldSpeed(jet)).toBeGreaterThan(worldSpeed(person) * 20)
    expect(targets.find(t => t.kind === 'static').track).toHaveLength(1)
  })

  it('slows every pass down on Easier without touching its window', () => {
    for (const kind of EASIER.kinds) {
      expect(RTT_KINDS[kind].windowMs).toBe(RTT_KINDS[kind].windowMs)
    }
    const h = generateRttRun(HARD, mulberry32(5)).targets.find(t => t.kind === 'vehicle')
    const e = generateRttRun(EASIER, mulberry32(5)).targets.find(t => t.kind === 'vehicle')
    expect(e.windowMs).toBe(h.windowMs)
    expect(worldSpeed(e)).toBeLessThan(worldSpeed(h))
  })

  // Going behind cover must be a test of prediction, never a way to lose a
  // target for good. Each of these is one of the guarantees that makes that
  // true — a player on the target when it disappeared always gets a real
  // chance at every frame they are still owed.
  describe('occlusion fairness', () => {
    const everyPass = (fn) => {
      for (let seed = 1; seed <= 60; seed++) {
        for (const tuning of ALL_TUNINGS) {
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
    // Measured on the real track from the moving aircraft, so the platform's
    // own motion counts as well as the target's.
    it('never hides a target long enough for it to re-emerge outside the frame', () => {
      everyPass((t) => {
        for (const o of t.occlusions) {
          const a = targetDirectionAt(t, t.tStartMs + o.fromMs)
          const b = targetDirectionAt(t, t.tStartMs + o.toMs)
          const arcWhileHidden = angularError(a.az, a.elev, b.az, b.elev) / DEG
          expect(arcWhileHidden).toBeLessThanOrEqual(MAX_OCCLUSION_ARC_FRAC * CAMERA_FOV_DEG + 0.01)
        }
      })
    })

    // Cover is drawn as a fixed structure in front of the target, so a target
    // that never moves can't honestly go behind it for part of a pass — it was
    // simply blinking out of existence where it stood.
    it('never hides a static target', () => {
      let statics = 0
      everyPass((t) => {
        if (t.kind !== 'static') return
        statics++
        expect(t.occlusions).toEqual([])
      })
      expect(statics).toBeGreaterThan(0)
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
    const t = targets.find(x => x.kind === 'vehicle')
    expect(targetDirectionAt(t, t.tStartMs).az).toBeCloseTo(t.startAz)
    expect(targetDirectionAt(t, t.tEndMs).az).toBeCloseTo(t.endAz)
    expect(targetDirectionAt(t, t.tStartMs).elev).toBeCloseTo(t.startElev)
  })

  // The scene keeps a finished target on screen for TARGET_EXIT_MS so it can be
  // SEEN to leave rather than blinking out. Two things have to hold for that.
  it('can extrapolate past the window, so an exiting target keeps travelling', () => {
    const { targets } = generateRttRun(HARD, mulberry32(3))
    // The fastest pass in the run, so the extrapolation is a real distance
    // rather than a rounding-sized nudge.
    const t = [...targets].sort((a, b) => worldSpeed(b) - worldSpeed(a))[0]
    const overrun = TARGET_EXIT_MS / 2
    const after = t.tEndMs + overrun
    const end = targetWorldAt(t, t.tEndMs)

    // Clamped (the default, and what scoring uses) freezes at the end.
    expect(targetWorldAt(t, after)).toEqual(end)
    // Unclamped carries on down the last stretch of track at the same speed.
    const last = t.track[t.track.length - 1], prev = t.track[t.track.length - 2]
    const perMs = (last.p[0] - prev.p[0]) / (last.t - prev.t)
    const drift = targetWorldAt(t, after, false)
    expect(drift[0] - end[0]).toBeCloseTo(perMs * overrun, 6)
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

  // The scene draws exactly the cover the sim built, and the sim's list of
  // hidden stretches is worked out from that same cover. If the two ever
  // disagreed, the player would be scored on something other than what they
  // can see.
  it('is hidden exactly when the cover in the scene blocks the sightline', () => {
    let checked = 0, hidden = 0, disagree = 0
    for (const tuning of [HARD, CBAT_HARD]) {
      for (let seed = 1; seed <= 10; seed++) {
        const { targets } = generateRttRun(tuning, mulberry32(seed))
        const covers = targets.flatMap(t => t.cover)
        for (const t of targets) {
          for (let k = 0; k < t.windowMs; k += 10) {
            const abs = t.tStartMs + k
            const blocked = covers.some(c => coverBlocks(c, stationAt(abs), targetWorldAt(t, abs), -1e-6))
            checked++
            if (blocked) hidden++
            if (isTargetOccluded(t, abs) !== blocked) disagree++
          }
        }
      }
    }
    expect(disagree).toBe(0)
    expect(hidden).toBeGreaterThan(0)
    expect(checked).toBeGreaterThan(10000)
    expect(targetAngularSize({ size: 10, range: 500 })).toBeCloseTo(0.02)
  })

  it('is only ever hidden by its own cover', () => {
    let crossed = 0
    for (let seed = 1; seed <= 30; seed++) {
      const { targets } = generateRttRun(CBAT_HARD, mulberry32(seed))
      for (const t of targets) {
        const others = targets.filter(o => o !== t).flatMap(o => o.cover)
        for (let k = 0; k < t.windowMs; k += 50) {
          const abs = t.tStartMs + k
          if (others.some(c => coverBlocks(c, stationAt(abs), targetWorldAt(t, abs)))) crossed++
        }
      }
    }
    expect(crossed).toBe(0)
  })
})

// The aircraft flies through the area (player report, 2026-10-01: the camera
// moves "as if it was bolted to a helicopter"). Both themes.
describe('moving platform', () => {
  it('flies straight ahead at a steady speed', () => {
    expect(stationAt(0)).toEqual([0, 0, -0])
    const [x, y, z] = stationAt(10000)
    expect([x, y]).toEqual([0, 0])
    expect(z).toBeCloseTo(-PLATFORM_SPEED_MPS * 10)
  })

  it('makes a static installation slide across the picture as the aircraft passes', () => {
    let moved = 0
    for (let seed = 1; seed <= 20; seed++) {
      for (const t of generateRttRun(HARD, mulberry32(seed)).targets) {
        if (t.kind !== 'static') continue
        expect(t.track).toHaveLength(1)
        if (angularError(t.startAz, t.startElev, t.endAz, t.endElev) > 1 * DEG) moved++
      }
    }
    expect(moved).toBeGreaterThan(0)
  })

  // The next target is in the world well before the pass before it ends,
  // already moving, rather than appearing when the camera arrives at it.
  it('has every moving target out there and travelling before its pass', () => {
    for (const t of generateRttRun(HARD, mulberry32(4)).targets) {
      if (t.kind === 'static') continue
      expect(t.track[0].t).toBe(-TARGET_PREVIEW_MS)
      const early = targetWorldAt(t, t.tStartMs - TARGET_PREVIEW_MS, false)
      const start = targetWorldAt(t, t.tStartMs)
      expect(Math.hypot(start[0] - early[0], start[2] - early[2])).toBeGreaterThan(1)
      // Scoring still only ever sees the pass itself.
      expect(targetWorldAt(t, t.tStartMs - 1000)).toEqual(start)
    }
    // Longer than the gap, so it is there before the pass ahead of it is over.
    expect(TARGET_PREVIEW_MS).toBeGreaterThan(RTT_GAP_MS + 3000)
  })

  it('reads a direction back the way polarToWorld lays it out', () => {
    const [x, y, z] = polarToWorld(0.4, -0.3, 600)
    const d = directionOf(x, y, z)
    expect(d.az).toBeCloseTo(0.4)
    expect(d.elev).toBeCloseTo(-0.3)
    expect(d.range).toBeCloseTo(600)
  })
})

// Real CBAT only: tight turns and bursts (player report: targets made "tight
// turns that I physically couldn't keep them in focus 100% of the time").
describe('manoeuvres', () => {
  it('only happens on Real CBAT, and never to a static target', () => {
    let count = 0
    for (let seed = 1; seed <= 30; seed++) {
      for (const t of generateRttRun(HARD, mulberry32(seed)).targets) expect(t.manoeuvres).toEqual([])
      for (const t of generateRttRun(CBAT_HARD, mulberry32(seed)).targets) {
        if (t.kind === 'static') expect(t.manoeuvres).toEqual([])
        count += t.manoeuvres.length
      }
    }
    expect(count).toBeGreaterThan(100)
  })

  // The user's rule (2026-10-01): a truck can't reverse without stopping
  // first, and an aircraft can't switch direction mid-air. Measured off the
  // finished tracks, 100 ms apart, against each kind's real limits.
  it('keeps every target inside what its real counterpart could do', () => {
    const worst = {}
    for (let seed = 1; seed <= 40; seed++) {
      for (const tuning of [CBAT_HARD, CBAT_EASIER]) {
        for (const t of generateRttRun(tuning, mulberry32(seed)).targets) {
          if (t.kind === 'static') continue
          const w = worst[t.kind] ??= { accel: 0, turn: 0, lat: 0, flip: 0, keptSpeed: 1 }
          let slowest = Infinity, fastest = 0
          const pts = t.track
          const vel = []
          for (let i = 1; i < pts.length; i++) {
            const dt = (pts[i].t - pts[i - 1].t) / 1000
            const vx = (pts[i].p[0] - pts[i - 1].p[0]) / dt
            const vz = (pts[i].p[2] - pts[i - 1].p[2]) / dt
            vel.push({ speed: Math.hypot(vx, vz), heading: Math.atan2(vz, vx), dt })
          }
          for (let i = 1; i < vel.length; i++) {
            const a = vel[i - 1], b = vel[i]
            slowest = Math.min(slowest, b.speed)
            fastest = Math.max(fastest, b.speed)
            w.accel = Math.max(w.accel, Math.abs(b.speed - a.speed) / b.dt)
            // A heading can't be read off a target that has all but stopped.
            if (a.speed < 0.2 || b.speed < 0.2) continue
            let dh = b.heading - a.heading
            while (dh > Math.PI) dh -= 2 * Math.PI
            while (dh < -Math.PI) dh += 2 * Math.PI
            const rate = Math.abs(dh) / b.dt
            w.turn = Math.max(w.turn, rate)
            w.lat = Math.max(w.lat, rate * (a.speed + b.speed) / 2)
            // Moving one way and then the other a tenth of a second later.
            if (Math.abs(dh) > Math.PI / 2) w.flip++
          }
          w.keptSpeed = Math.min(w.keptSpeed, slowest / fastest)
        }
      }
    }
    for (const [kind, w] of Object.entries(worst)) {
      const m = KIND_MOTION[kind]
      expect(w.flip, kind).toBe(0)
      expect(w.turn / DEG, kind).toBeLessThanOrEqual(m.maxTurnDegS * 1.1)
      expect(w.lat, kind).toBeLessThanOrEqual(m.aLat * 1.1)
      if (m.accel) expect(w.accel, kind).toBeLessThanOrEqual(m.accel * 1.15)
      // A jet never brakes to manoeuvre.
      else expect(w.keptSpeed, kind).toBeGreaterThan(0.97)
    }
    expect(Object.keys(worst)).toEqual(expect.arrayContaining(['person', 'vehicle', 'boat', 'helicopter', 'jet']))
  })

  it('turns a target by the heading change it was planned with', () => {
    const runs = []
    for (let seed = 1; seed <= 30; seed++) runs.push(...generateRttRun(CBAT_HARD, mulberry32(seed)).targets)
    const t = runs.find(x => x.kind === 'vehicle' && x.manoeuvres.some(m => m.type === 'turn'))
    const m = t.manoeuvres.find(x => x.type === 'turn')
    const headingAt = (local) => {
      const a = targetWorldAt(t, t.tStartMs + local - 50)
      const b = targetWorldAt(t, t.tStartMs + local + 50)
      return Math.atan2(b[2] - a[2], b[0] - a[0])
    }
    let turned = headingAt(m.atMs + m.durMs) - headingAt(m.atMs)
    while (turned > Math.PI) turned -= 2 * Math.PI
    while (turned < -Math.PI) turned += 2 * Math.PI
    // The planned turn, plus the little the steady curve adds over the time.
    expect(Math.abs(turned - m.dPsi)).toBeLessThan(10 * DEG)
  })

  it('gives each manoeuvre the time its limits demand', () => {
    const { person, vehicle, jet } = KIND_MOTION
    // A foot patrol turns round in seconds; a truck takes longer to turn
    // less, because it has to brake for it.
    const walkerTurn = manoeuvreDurationMs(person, 1.4, 0, Math.PI, person.turnSpeed)
    const truckTurn = manoeuvreDurationMs(vehicle, 14, 0, 60 * DEG, vehicle.turnSpeed)
    expect(walkerTurn).toBeLessThan(truckTurn)
    // A jet doesn't brake to manoeuvre at all.
    expect(manoeuvreDurationMs(jet, 150, 0, 0, 0.5)).toBeNull()
    // Turning against the curve it is already on is easier than turning into it.
    const into = manoeuvreDurationMs(jet, 150, 1 / 700, 40 * DEG, 1)
    const away = manoeuvreDurationMs(jet, 150, 1 / 700, -40 * DEG, 1)
    expect(away).toBeLessThan(into)
  })

  it('makes manoeuvres a regular part of a Real CBAT run', () => {
    let moving = 0, count = 0
    for (let seed = 1; seed <= 30; seed++) {
      for (const t of generateRttRun(CBAT_HARD, mulberry32(seed)).targets) {
        if (t.kind === 'static') continue
        moving++
        count += t.manoeuvres.length
      }
    }
    expect(count / moving).toBeGreaterThan(0.5)
  })

  it('never happens while the target is behind cover', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const t of generateRttRun(CBAT_HARD, mulberry32(seed)).targets) {
        for (const m of t.manoeuvres) {
          for (const o of t.occlusions) {
            expect(m.atMs + m.durMs <= o.fromMs || m.atMs >= o.toMs).toBe(true)
          }
        }
      }
    }
  })
})

// Real CBAT only: other aircraft flying through, which are not targets.
describe('decoys', () => {
  it('only fly on Real CBAT', () => {
    expect(generateRttRun(HARD, mulberry32(1)).decoys).toEqual([])
    expect(generateRttRun(CBAT_HARD, mulberry32(1)).decoys.length).toBeGreaterThan(0)
  })

  it('stay further away than any target can be, so they never pass in front of one', () => {
    let nearest = Infinity
    for (let seed = 1; seed <= 20; seed++) {
      for (const d of generateRttRun(CBAT_HARD, mulberry32(seed)).decoys) {
        for (let k = 0; k <= d.windowMs; k += 100) {
          const w = targetWorldAt(d, d.tStartMs + k)
          const st = stationAt(d.tStartMs + k)
          nearest = Math.min(nearest, Math.hypot(w[0] - st[0], w[1] - st[1], w[2] - st[2]))
        }
      }
    }
    expect(nearest).toBeGreaterThan(MAX_TARGET_RANGE_M)
  })

  it('fly more often on Hard than on Easier', () => {
    let hard = 0, easier = 0
    for (let seed = 1; seed <= 20; seed++) {
      hard += generateRttRun(CBAT_HARD, mulberry32(seed)).decoys.length
      easier += generateRttRun(CBAT_EASIER, mulberry32(seed)).decoys.length
    }
    expect(hard).toBeGreaterThan(easier)
  })
})

// Real CBAT only: wide and coarse while searching, zoomed in on the target.
describe('zoom', () => {
  it('runs from the wide search view to the normal zoomed view', () => {
    expect(fovForZoom(0)).toBeCloseTo(WIDE_FOV_DEG)
    expect(fovForZoom(1)).toBeCloseTo(CAMERA_FOV_DEG)
    expect(fovForZoom(0.5)).toBeLessThan(WIDE_FOV_DEG)
    expect(fovForZoom(0.5)).toBeGreaterThan(CAMERA_FOV_DEG)
  })

  it('zooms in near the target, out away from it, and holds in between', () => {
    const half = ZOOM_TIME_MS / 2
    expect(zoomStep(0, (ZOOM_IN_DEG - 1) * DEG, half, false)).toEqual({ z: 0.5, zoomingIn: true })
    expect(zoomStep(1, (ZOOM_OUT_DEG + 1) * DEG, half, true)).toEqual({ z: 0.5, zoomingIn: false })
    // Between the two thresholds it keeps going the way it was going.
    const between = ((ZOOM_IN_DEG + ZOOM_OUT_DEG) / 2) * DEG
    expect(zoomStep(0.5, between, half, true).z).toBe(1)
    expect(zoomStep(0.5, between, half, false).z).toBe(0)
    // No live target: zoom out to look for the next one.
    expect(zoomStep(1, null, ZOOM_TIME_MS, true)).toEqual({ z: 0, zoomingIn: false })
  })

  it('draws the box as the capture cone at whatever the zoom is', () => {
    const cone = captureRadius(HARD)
    expect(reticleHeightPercent(cone, WIDE_FOV_DEG)).toBeLessThan(reticleHeightPercent(cone, CAMERA_FOV_DEG))
    expect(reticleHeightPercent(9 * DEG, 18)).toBeCloseTo(200)
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

// Real CBAT: the target has to be held in the box, for the frames and for the
// whole pass.
describe('Real CBAT tracking scoring', () => {
  const sim = () => makeRttSim(CBAT_HARD, mulberry32(9))
  const onTarget = (s, index = 0) => [{ index, errorRad: 0, occluded: false }]
  const hold = (s, ms, index = 0, errorRad = 0) => {
    for (let t = 0; t < ms; t += 20) {
      advanceRtt(s, 20)
      trackRtt(s, [{ index, errorRad, occluded: false }], 20)
    }
  }

  it('wastes a frame snapped before the target has been held in the box', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tStartMs + 100)
    trackRtt(s, onTarget(s), 100)
    expect(isLocked(s, 0)).toBe(false)
    const res = fireShutter(s, onTarget(s))
    expect(res.kind).toBe('unsteady')
    expect(s.progress[0].frames).toBe(0)
    expect(s.score).toBe(RTT_SCORE.wastedFrame)
  })

  it('counts a frame once the target has been held for the lock time', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tStartMs)
    hold(s, RTT_LOCK_MS + 20)
    expect(isLocked(s, 0)).toBe(true)
    const res = fireShutter(s, onTarget(s))
    expect(res.kind).toBe('hit')
    expect(res.points).toBe(RTT_TRACK_SCORE.frameBase + RTT_TRACK_SCORE.frameCentreBonus)
  })

  it('loses the lock the moment the target leaves the box', () => {
    const s = sim()
    advanceRtt(s, s.run.targets[0].tStartMs)
    hold(s, RTT_LOCK_MS + 20)
    hold(s, 20, 0, s.captureRad * 1.5)
    expect(isLocked(s, 0)).toBe(false)
  })

  it('keeps the pass open after the third frame, so holding it still scores', () => {
    const s = sim()
    const t = s.run.targets[0]
    advanceRtt(s, t.tStartMs)
    hold(s, RTT_LOCK_MS + 20)
    for (let f = 0; f < RTT_FRAMES_PER_TARGET; f++) {
      expect(fireShutter(s, onTarget(s)).kind).toBe('hit')
      hold(s, SHUTTER_COOLDOWN_MS + 20)
    }
    expect(s.progress[0].resolved).toBe(false)
    hold(s, t.tEndMs - s.elapsedMs + 20)
    expect(s.progress[0].resolved).toBe(true)
    expect(s.progress[0].trackFrac).toBeCloseTo(1)
  })

  it('pays full tracking points short of a perfect hold, and little for a late pick-up', () => {
    const w = 8000
    expect(trackingPoints({ trackMs: w, inBoxMs: w * RTT_TRACK_SCORE.trackFullAt }, w).points)
      .toBe(RTT_TRACK_SCORE.trackMax)
    expect(trackingPoints({ trackMs: w, inBoxMs: w * 0.5 }, w).points)
      .toBeLessThan(RTT_TRACK_SCORE.trackMax)
    // Picked up in the last half-second and held perfectly: measured over at
    // least half the window, so nowhere near full marks.
    expect(trackingPoints({ trackMs: 500, inBoxMs: 500 }, w).points).toBeLessThan(RTT_TRACK_SCORE.trackMax / 4)
    expect(trackingPoints({ trackMs: 0, inBoxMs: 0 }, w).points).toBe(0)
  })

  it('does nothing on SkyWatch, where frames score wherever the shutter fires', () => {
    const s = makeRttSim(HARD, mulberry32(9))
    advanceRtt(s, s.run.targets[0].tStartMs + 100)
    trackRtt(s, onTarget(s), 100)
    expect(s.progress[0].inBoxMs).toBe(0)
    expect(isLocked(s, 0)).toBe(true)
  })
})

describe('maxRttScore', () => {
  it('is three dead-centre frames plus the bonus, per target', () => {
    const perTarget = RTT_FRAMES_PER_TARGET * (RTT_SCORE.frameBase + RTT_SCORE.frameCentreBonus) + RTT_SCORE.targetComplete
    expect(maxRttScore(HARD)).toBe(HARD.targets * perTarget)
    expect(maxRttScore(EASIER)).toBeLessThan(maxRttScore(HARD))
  })

  // Raised from 150 a target when the platform started moving, so new runs can
  // climb past the scores already on the boards.
  it('is 165 a target, on both themes, because they share a board', () => {
    expect(maxRttScore(HARD)).toBe(HARD.targets * 165)
    expect(maxRttScore(CBAT_HARD)).toBe(maxRttScore(HARD))
    expect(maxRttScore(CBAT_EASIER)).toBe(maxRttScore(EASIER))
  })

  it('is reachable by a flawless Real CBAT run', () => {
    const s = makeRttSim(CBAT_EASIER, mulberry32(2))
    s.run.targets.forEach((t, i) => {
      const on = [{ index: i, errorRad: 0, occluded: false }]
      const step = (ms) => { advanceRtt(s, ms); trackRtt(s, on, ms) }
      s.elapsedMs = t.tStartMs
      step(RTT_LOCK_MS + 10)
      for (let f = 0; f < RTT_FRAMES_PER_TARGET; f++) {
        expect(fireShutter(s, on).kind).toBe('hit')
        step(SHUTTER_COOLDOWN_MS + 10)
      }
      while (s.elapsedMs < t.tEndMs) step(Math.min(50, t.tEndMs - s.elapsedMs + 1))
    })
    advanceRtt(s, s.durationMs)
    expect(rttStats(s).totalScore).toBe(maxRttScore(CBAT_EASIER))
    expect(rttStats(s).timeInBoxPct).toBe(100)
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

// SkyWatch varies the light each run is flown in and names its targets; Real
// CBAT always looks like the real test.
describe('presentation', () => {
  it('flies Real CBAT in the plain dusk look, with no target names', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = makeRttSim(CBAT_HARD, mulberry32(seed))
      expect(s.look).toBe('dusk')
      for (const t of s.run.targets) expect(t.name).toBeUndefined()
    }
  })

  it('varies SkyWatch runs across every look, thermal included but rarer', () => {
    const seen = {}
    for (let seed = 1; seed <= 200; seed++) {
      const look = makeRttSim(HARD, mulberry32(seed)).look
      seen[look] = (seen[look] ?? 0) + 1
    }
    for (const look of RTT_LOOKS) expect(seen[look]).toBeGreaterThan(0)
    expect(seen.thermal).toBeLessThan(seen.dusk + seen.dawn + seen.overcast)
  })

  it('names every SkyWatch target from its own kind s list', () => {
    const s = makeRttSim(HARD, mulberry32(3))
    for (const t of s.run.targets) expect(TARGET_NAMES[t.kind]).toContain(t.name)
  })

  it('keeps the same targets for a seed whatever the look', () => {
    // The look and names are drawn after the run, so they can't shift it.
    const a = makeRttSim(HARD, mulberry32(8)).run.targets.map(t => t.startAz)
    const b = generateRttRun(HARD, mulberry32(8)).targets.map(t => t.startAz)
    expect(a).toEqual(b)
  })
})
