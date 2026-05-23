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
  { speed: 4.0, shapes: 16, distractorOdds: 0.15, avoidOdds: 0.18, bleepOdds: 0.05, turns: 12, callsigns: 2 },
  { speed: 4.5, shapes: 20, distractorOdds: 0.20, avoidOdds: 0.22, bleepOdds: 0.06, turns: 14, callsigns: 2 },
  { speed: 5.0, shapes: 24, distractorOdds: 0.25, avoidOdds: 0.25, bleepOdds: 0.07, turns: 16, callsigns: 2 },
  { speed: 5.5, shapes: 28, distractorOdds: 0.28, avoidOdds: 0.28, bleepOdds: 0.08, turns: 18, callsigns: 3 },
  { speed: 6.5, shapes: 32, distractorOdds: 0.30, avoidOdds: 0.30, bleepOdds: 0.09, turns: 20, callsigns: 3 },
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

  it('produces ~TRIANGLE_FRACTION triangles on average', () => {
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
    // Allow a generous window — the TRIANGLE_FRACTION is the per-event roll
    // before the Markov repeat-bias kicks in. With repeat-bias only applying
    // to circle/square, the actual triangle rate should be very close to
    // TRIANGLE_FRACTION ± a few percent.
    expect(ratio).toBeGreaterThan(TRIANGLE_FRACTION - 0.08)
    expect(ratio).toBeLessThan(TRIANGLE_FRACTION + 0.08)
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

  it('produces at least 1 avoid cue per round on average (MIN_AVOID_CUES top-up works)', () => {
    // Even on rolls where avoidOdds picks 0, the top-up should add cues until
    // we hit the floor — UNLESS the round is too short to fit any. Most
    // rounds should comfortably hit 2+; some R1 trials may hit only 1 if
    // events line up badly. Test the average across many trials.
    for (let r = 0; r < 5; r++) {
      let totalAvoids = 0
      const TRIALS = 50
      for (let trial = 0; trial < TRIALS; trial++) {
        const cfg = ROUND_CONFIG[r]
        const curveLen = approxCurveLen(r)
        const events = generateShapeEvents(curveLen, cfg.shapes, r)
        const cues = generateAudioPlan(events, cfg, USER_CALLSIGN, r, curveLen)
        totalAvoids += cues.filter(c => c.kind === 'avoid').length
      }
      const avgAvoids = totalAvoids / TRIALS
      expect(avgAvoids).toBeGreaterThan(1.0)
    }
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
