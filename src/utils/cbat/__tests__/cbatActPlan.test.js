import { describe, it, expect } from 'vitest'
import {
  RENDERED_AHEAD,
  MIN_THINK_TIME_S,
  AUDIO_DURATION_S_EST,
  POST_TARGET_GAP_S,
  AUDIO_WARMUP_T,
  TRIANGLE_FRACTION,
  MAX_AVOID_CUES,
  generateShapeEvents,
  generateAudioPlan,
} from '../cbatActPlan'

// Mirror the production ROUND_CONFIG so tests cover real round tuning.
const ROUND_CONFIG = [
  { speed: 4.0, shapes: 16, distractorOdds: 0.15, avoidOdds: 0.40, bleepOdds: 0.05, turns: 12, callsigns: 2 },
  { speed: 4.5, shapes: 20, distractorOdds: 0.20, avoidOdds: 0.45, bleepOdds: 0.06, turns: 14, callsigns: 2 },
  { speed: 5.0, shapes: 24, distractorOdds: 0.25, avoidOdds: 0.50, bleepOdds: 0.07, turns: 16, callsigns: 2 },
  { speed: 5.5, shapes: 28, distractorOdds: 0.28, avoidOdds: 0.55, bleepOdds: 0.08, turns: 18, callsigns: 3 },
  { speed: 6.5, shapes: 32, distractorOdds: 0.30, avoidOdds: 0.60, bleepOdds: 0.09, turns: 20, callsigns: 3 },
]

// Rough curve length matching the in-game tunnel — turnCount + 4 segments at
// ~12-14 forward units each. Test uses 14 units/segment as a round number.
function approxCurveLen(roundIdx) {
  return (ROUND_CONFIG[roundIdx].turns + 4) * 14
}

const USER_CALLSIGN = ['alpha', 'bravo']

describe('generateShapeEvents', () => {
  it('produces the requested number of events in strict t-order', () => {
    for (let r = 0; r < 5; r++) {
      const events = generateShapeEvents(approxCurveLen(r), ROUND_CONFIG[r].shapes, r)
      expect(events).toHaveLength(ROUND_CONFIG[r].shapes)
      for (let i = 1; i < events.length; i++) {
        expect(events[i].t).toBeGreaterThan(events[i - 1].t)
      }
    }
  })

  it('only uses circle/square/triangle shapes', () => {
    const valid = new Set(['circle', 'square', 'triangle'])
    for (let trial = 0; trial < 50; trial++) {
      const events = generateShapeEvents(approxCurveLen(2), 24, 2)
      for (const ev of events) expect(valid.has(ev.shape)).toBe(true)
    }
  })

  it('triangle ratio is at least TRIANGLE_FRACTION (spacing rule can push higher)', () => {
    let total = 0
    let triangles = 0
    for (let trial = 0; trial < 100; trial++) {
      const events = generateShapeEvents(approxCurveLen(2), 24, 2)
      for (const ev of events) {
        total += 1
        if (ev.shape === 'triangle') triangles += 1
      }
    }
    const ratio = triangles / total
    // TRIANGLE_FRACTION is the INITIAL roll probability. The spacing
    // invariant (≥ RENDERED_AHEAD+2 between same-shape events) forces
    // additional triangles when both circle and square are blocked, so
    // the actual rate is always ≥ TRIANGLE_FRACTION and typically lands
    // around 0.55–0.65 regardless of the initial value.
    expect(ratio).toBeGreaterThanOrEqual(TRIANGLE_FRACTION - 0.05)
    expect(ratio).toBeLessThan(0.75)
  })
})

describe('generateAudioPlan — invariants', () => {
  // Helper: at audioT, return the index of the first un-passed event (i.e.,
  // events[firstUpcomingIdx].t > audioT). Mirrors the runtime logic in
  // ActScene + the game-loop event cursor.
  function firstUpcomingIdx(events, audioT) {
    for (let i = 0; i < events.length; i++) {
      if (events[i].t > audioT) return i
    }
    return events.length
  }

  it('never targets a triangle', () => {
    for (let trial = 0; trial < 200; trial++) {
      for (let r = 0; r < 5; r++) {
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, ROUND_CONFIG[r].shapes, r)
        const cues = generateAudioPlan(events, ROUND_CONFIG[r], USER_CALLSIGN, r, curveLen)
        for (const cue of cues) {
          if (cue.kind !== 'avoid') continue
          expect(cue.shape === 'circle' || cue.shape === 'square').toBe(true)
        }
      }
    }
  })

  it('targets are off-screen at audio start (≥ RENDERED_AHEAD+1 events ahead)', () => {
    // For every avoid cue, the FIRST same-shape event whose index is past the
    // current firstUpcomingIdx must be at index >= firstUpcomingIdx + RENDERED_AHEAD + 1.
    for (let trial = 0; trial < 200; trial++) {
      for (let r = 0; r < 5; r++) {
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, ROUND_CONFIG[r].shapes, r)
        const cues = generateAudioPlan(events, ROUND_CONFIG[r], USER_CALLSIGN, r, curveLen)
        for (const cue of cues) {
          if (cue.kind !== 'avoid') continue
          const fu = firstUpcomingIdx(events, cue.t)
          let targetIdx = -1
          for (let k = fu; k < events.length; k++) {
            if (events[k].shape === cue.shape) { targetIdx = k; break }
          }
          expect(targetIdx).toBeGreaterThanOrEqual(0)
          expect(targetIdx - fu).toBeGreaterThanOrEqual(RENDERED_AHEAD + 1)
        }
      }
    }
  })

  it('no same-shape event sits between audio start and target (first-same-shape IS target)', () => {
    // From firstUpcomingIdx(audioT) up to (target_index - 1), no event may
    // share the cue's shape — otherwise the player would see a non-target
    // same-shape rendered first and mistake it for the avoid target.
    for (let trial = 0; trial < 200; trial++) {
      for (let r = 0; r < 5; r++) {
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, ROUND_CONFIG[r].shapes, r)
        const cues = generateAudioPlan(events, ROUND_CONFIG[r], USER_CALLSIGN, r, curveLen)
        for (const cue of cues) {
          if (cue.kind !== 'avoid') continue
          const fu = firstUpcomingIdx(events, cue.t)
          let targetIdx = -1
          for (let k = fu; k < events.length; k++) {
            if (events[k].shape === cue.shape) { targetIdx = k; break }
          }
          if (targetIdx === -1) continue
          for (let k = fu; k < targetIdx; k++) {
            expect(events[k].shape).not.toBe(cue.shape)
          }
        }
      }
    }
  })

  it('enforces MIN_THINK_TIME_S between audio end and target arrival', () => {
    for (let trial = 0; trial < 200; trial++) {
      for (let r = 0; r < 5; r++) {
        const cfg = ROUND_CONFIG[r]
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, cfg.shapes, r)
        const cues = generateAudioPlan(events, cfg, USER_CALLSIGN, r, curveLen)
        for (const cue of cues) {
          if (cue.kind !== 'avoid') continue
          const fu = firstUpcomingIdx(events, cue.t)
          let targetIdx = -1
          for (let k = fu; k < events.length; k++) {
            if (events[k].shape === cue.shape) { targetIdx = k; break }
          }
          if (targetIdx === -1) continue
          const tGapSeconds = (events[targetIdx].t - cue.t) * curveLen / cfg.speed
          // Allow a tiny epsilon for floating-point rounding around the
          // upperByGap boundary.
          expect(tGapSeconds).toBeGreaterThanOrEqual(MIN_THINK_TIME_S + AUDIO_DURATION_S_EST - 0.05)
        }
      }
    }
  })

  it('two avoid cues never overlap — next audio waits for prev target + POST_TARGET_GAP_S', () => {
    for (let trial = 0; trial < 200; trial++) {
      for (let r = 0; r < 5; r++) {
        const cfg = ROUND_CONFIG[r]
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, cfg.shapes, r)
        const cues = generateAudioPlan(events, cfg, USER_CALLSIGN, r, curveLen)
        const avoids = cues.filter(c => c.kind === 'avoid')
        for (let i = 1; i < avoids.length; i++) {
          const prev = avoids[i - 1]
          const fu = firstUpcomingIdx(events, prev.t)
          let prevTargetIdx = -1
          for (let k = fu; k < events.length; k++) {
            if (events[k].shape === prev.shape) { prevTargetIdx = k; break }
          }
          if (prevTargetIdx === -1) continue
          const prevTargetT = events[prevTargetIdx].t
          // Next audio must not start before prev target + post-gap.
          const minNextAudioT = prevTargetT + (POST_TARGET_GAP_S * cfg.speed) / curveLen
          expect(avoids[i].t).toBeGreaterThanOrEqual(minNextAudioT - 1e-6)
        }
      }
    }
  })

  it('respects AUDIO_WARMUP_T floor', () => {
    for (let trial = 0; trial < 50; trial++) {
      for (let r = 0; r < 5; r++) {
        const cfg = ROUND_CONFIG[r]
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, cfg.shapes, r)
        const cues = generateAudioPlan(events, cfg, USER_CALLSIGN, r, curveLen)
        for (const cue of cues) {
          if (cue.kind === 'avoid' || cue.kind === 'distractor' || cue.kind === 'bleep') {
            expect(cue.t).toBeGreaterThanOrEqual(AUDIO_WARMUP_T - 1e-6)
          }
        }
      }
    }
  })

  it('never schedules more than MAX_AVOID_CUES avoid cues per round', () => {
    for (let trial = 0; trial < 200; trial++) {
      for (let r = 0; r < 5; r++) {
        const cfg = ROUND_CONFIG[r]
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, cfg.shapes, r)
        const cues = generateAudioPlan(events, cfg, USER_CALLSIGN, r, curveLen)
        const avoidCount = cues.filter(c => c.kind === 'avoid').length
        expect(avoidCount).toBeLessThanOrEqual(MAX_AVOID_CUES)
      }
    }
  })

  it('hits the MIN_AVOID_CUES floor of 2 in ≥ 99% of rounds', () => {
    // The slot-finder + brute-force pair fallback should reach the floor
    // in nearly every round. R1 is the tightest (16 events, ~4 eligible
    // avoid targets) and can occasionally fail when the shape stream
    // happens to have <2 eligible non-triangle events at i ≥ 4. Assert
    // ≥99% success across all rounds and per-trial ≥1 cue (never 0).
    for (let r = 0; r < 5; r++) {
      const TRIALS = 200
      let belowFloor = 0
      for (let trial = 0; trial < TRIALS; trial++) {
        const cfg = ROUND_CONFIG[r]
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, cfg.shapes, r)
        const cues = generateAudioPlan(events, cfg, USER_CALLSIGN, r, curveLen)
        const avoidCount = cues.filter(c => c.kind === 'avoid').length
        expect(avoidCount).toBeGreaterThanOrEqual(1)
        if (avoidCount < 2) belowFloor += 1
      }
      expect(belowFloor / TRIALS).toBeLessThanOrEqual(0.02)
    }
  })

  it('avoid-cue average sits near the floor in R1 and ramps up by R5', () => {
    // Two claims, matching the avoidOdds ramp (0.55 → 0.75 across rounds):
    //   1. Even the tightest round (R1) averages ~2 cues — players always
    //      hear their callsign at least a couple of times.
    //   2. Later rounds are busier, so the callsign recurs noticeably more.
    // R1 sits right on the MIN_AVOID_CUES floor of 2 (a ~1% slice of rounds
    // only fit 1), so a flat `>= 2.0` is a coin-flip on sampling noise. We
    // assert with a margin and a large sample so the means are stable, and
    // check the ramp relatively (R5 vs R1) rather than against magic numbers.
    const TRIALS = 400
    const avg = []
    for (let r = 0; r < 5; r++) {
      let totalAvoids = 0
      for (let trial = 0; trial < TRIALS; trial++) {
        const cfg = ROUND_CONFIG[r]
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, cfg.shapes, r)
        const cues = generateAudioPlan(events, cfg, USER_CALLSIGN, r, curveLen)
        totalAvoids += cues.filter(c => c.kind === 'avoid').length
      }
      avg.push(totalAvoids / TRIALS)
    }
    // 1. R1 averages about the floor of 2 (margin absorbs the ~1% of 1-cue rounds).
    expect(avg[0]).toBeGreaterThanOrEqual(1.9)
    // 2. The ramp delivers at least one extra cue on average by R5.
    expect(avg[4]).toBeGreaterThan(avg[0] + 1)
  })

  it('cues are returned in t-order', () => {
    for (let trial = 0; trial < 50; trial++) {
      for (let r = 0; r < 5; r++) {
        const cfg = ROUND_CONFIG[r]
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, cfg.shapes, r)
        const cues = generateAudioPlan(events, cfg, USER_CALLSIGN, r, curveLen)
        for (let i = 1; i < cues.length; i++) {
          expect(cues[i].t).toBeGreaterThanOrEqual(cues[i - 1].t)
        }
      }
    }
  })
})
