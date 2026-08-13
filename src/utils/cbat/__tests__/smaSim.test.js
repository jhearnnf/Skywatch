import { describe, it, expect } from 'vitest'
import {
  createSmaSim, smaStats, maxSmaScore, CONTROL_RATE, LEAD_IN_MS, POINTS_PER_SEC,
} from '../smaSim'
import { SMA_TUNING } from '../smaDifficulty'

// A fixed rng so a run replays exactly. 0.5 everywhere puts every drift phase at
// π and every gust at the middle of its window, which makes the arithmetic in
// the tests below something a reader can follow.
const halves = () => 0.5

// Deliberately NOT the shipping tuning: a drift of zero isolates the control law
// from the forcing function, which is the only way to assert what an input does
// without the answer depending on where in the sinusoid the run happened to be.
const still = { durationMs: 10000, driftRate: 0, ringRadius: 0.16, gusts: false }

function run(sim, ms, input, stepMs = 20) {
  for (let t = 0; t < ms; t += stepMs) sim.step(stepMs, input)
}

describe('SMA control law', () => {
  it('is rate control — a held input keeps moving the dot', () => {
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, 500, { x: 1, y: 0 })
    const halfway = sim.state.x
    run(sim, 500, { x: 1, y: 0 })
    // Position control would have parked the dot; rate control moves it again by
    // the same amount. This is the one property the guide states outright ("the
    // dot never holds position between corrections") so it is the one to pin.
    //
    // Half-second legs rather than whole ones because two seconds at full
    // deflection would run into the bezel clamp and hide the second move.
    expect(halfway).toBeCloseTo(CONTROL_RATE / 2, 3)
    expect(sim.state.x).toBeCloseTo(CONTROL_RATE, 3)
  })

  it('leaves the dot where it is when the control is centred and nothing drifts', () => {
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, 500, { x: 1, y: 0 })
    const parked = sim.state.x
    run(sim, 2000, { x: 0, y: 0 })
    expect(sim.state.x).toBeCloseTo(parked, 6)
  })

  it('sends the dot down on a positive y and up on a negative one', () => {
    // The sign that matters most: gamepad.js defines +y as STICK FORWARD, and
    // the guide says pushing the stick away brings the dot down. A flip here
    // would teach the reverse of the one control habit this test trains.
    const down = createSmaSim({ rng: halves, tuning: still })
    run(down, 500, { x: 0, y: 1 })
    expect(down.state.y).toBeGreaterThan(0)

    const up = createSmaSim({ rng: halves, tuning: still })
    run(up, 500, { x: 0, y: -1 })
    expect(up.state.y).toBeLessThan(0)
  })

  it('sends the dot right on a positive x', () => {
    // The right pedal is +x, and it is what you press when the dot has gone left.
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, 500, { x: 1, y: 0 })
    expect(sim.state.x).toBeGreaterThan(0)
  })

  it('clamps the dot to the bezel radially, so error never exceeds 1', () => {
    // Radially, not per-axis: the display is a circle, and a per-axis clamp
    // would let the dot sit in a corner that does not exist and read 1.41.
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, 8000, { x: 1, y: 1 })
    expect(Math.hypot(sim.state.x, sim.state.y)).toBeLessThanOrEqual(1.0001)
    expect(sim.state.error).toBeLessThanOrEqual(1)
  })
})

describe('SMA drift', () => {
  it('moves the dot with no input at all', () => {
    const sim = createSmaSim({ rng: halves, tuning: SMA_TUNING.hard })
    run(sim, 6000, { x: 0, y: 0 })
    expect(Math.hypot(sim.state.x, sim.state.y)).toBeGreaterThan(0.02)
  })

  it('replays identically from the same seed and differs from another', () => {
    const a = createSmaSim({ rng: halves, tuning: SMA_TUNING.hard })
    const b = createSmaSim({ rng: halves, tuning: SMA_TUNING.hard })
    run(a, 20000, { x: 0, y: 0 })
    run(b, 20000, { x: 0, y: 0 })
    expect(a.state.x).toBe(b.state.x)
    expect(a.state.y).toBe(b.state.y)

    let n = 0
    const other = createSmaSim({ rng: () => ((n++ * 0.37) % 1), tuning: SMA_TUNING.hard })
    run(other, 20000, { x: 0, y: 0 })
    expect(other.state.x).not.toBe(a.state.x)
  })

  it('does not trace a repeating figure — the two axes never lock together', () => {
    // Shared frequencies would draw a Lissajous figure, and a player who noticed
    // would be tracking a shape rather than a disturbance. Sampling the ratio of
    // the two drift velocities across a run catches that: on a locked pair it
    // would be constant.
    const sim = createSmaSim({ rng: halves, tuning: { ...SMA_TUNING.hard, gusts: false } })
    const ratios = []
    let prev = { x: 0, y: 0 }
    for (let i = 0; i < 60; i++) {
      sim.step(500, { x: 0, y: 0 })
      const dx = sim.state.x - prev.x
      const dy = sim.state.y - prev.y
      prev = { x: sim.state.x, y: sim.state.y }
      if (Math.abs(dx) > 1e-6) ratios.push(dy / dx)
    }
    const spread = Math.max(...ratios) - Math.min(...ratios)
    expect(spread).toBeGreaterThan(1)
  })
})

describe('SMA scoring', () => {
  it('scores nothing during the lead-in', () => {
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, LEAD_IN_MS - 100, { x: 0, y: 0 })
    // Parked dead centre the whole time, and still zero — the lead-in is free
    // rather than generous.
    expect(sim.state.score).toBe(0)
    expect(sim.state.scoredMs).toBe(0)
  })

  it('pays the full rate for a dot held dead centre, once scoring starts', () => {
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, LEAD_IN_MS + 2000, { x: 0, y: 0 })
    // Two scored seconds at the full rate. The frame straddling the boundary is
    // only scored for its part past it, which is what keeps this exact.
    expect(sim.state.score).toBeCloseTo(2 * POINTS_PER_SEC, 4)
  })

  it('pays nothing at all once the dot is outside the ring', () => {
    const sim = createSmaSim({ rng: halves, tuning: still })
    // Drive well past the ring during the lead-in, then hold it there.
    run(sim, LEAD_IN_MS, { x: 1, y: 0 })
    const banked = sim.state.score
    run(sim, 3000, { x: 0, y: 0 })
    expect(sim.state.error).toBeGreaterThan(still.ringRadius)
    expect(sim.state.score).toBeCloseTo(banked, 6)
  })

  it('pays less the further from the crosshair the dot sits', () => {
    const near = createSmaSim({ rng: halves, tuning: still })
    const far = createSmaSim({ rng: halves, tuning: still })
    // Nudge each to a different steady offset inside the ring, then hold.
    near.step(50, { x: 1, y: 0 })
    far.step(150, { x: 1, y: 0 })
    run(near, LEAD_IN_MS + 2000, { x: 0, y: 0 })
    run(far, LEAD_IN_MS + 2000, { x: 0, y: 0 })
    expect(far.state.error).toBeGreaterThan(near.state.error)
    expect(far.state.score).toBeLessThan(near.state.score)
    expect(far.state.score).toBeGreaterThan(0)
  })

  it('finishes after the lead-in plus the scored duration, and stops stepping', () => {
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, LEAD_IN_MS + still.durationMs + 500, { x: 0, y: 0 })
    expect(sim.state.finished).toBe(true)
    expect(sim.state.elapsedMs).toBe(LEAD_IN_MS + still.durationMs)
    const frozen = sim.state.score
    run(sim, 5000, { x: 1, y: 1 })
    expect(sim.state.score).toBe(frozen)
  })

  it('reports a perfect run as exactly maxSmaScore', () => {
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, LEAD_IN_MS + still.durationMs, { x: 0, y: 0 })
    expect(smaStats(sim).totalScore).toBe(maxSmaScore(still))
  })
})

describe('smaStats', () => {
  it('measures the percentages against the scored window, not the whole run', () => {
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, LEAD_IN_MS + still.durationMs, { x: 0, y: 0 })
    const stats = smaStats(sim)
    // The dot never left the centre inside the scoring window, so 100% on
    // target — even though the run also contains 2.5s of unscored lead-in.
    expect(stats.onTargetPct).toBe(100)
    expect(stats.rmsErrorPct).toBe(0)
    expect(stats.totalTime).toBeCloseTo((LEAD_IN_MS + still.durationMs) / 1000, 6)
  })

  it('records the worst error even when it was recovered from', () => {
    const sim = createSmaSim({ rng: halves, tuning: still })
    run(sim, LEAD_IN_MS, { x: 0, y: 0 })
    run(sim, 900, { x: 1, y: 0 })      // out to the bezel-ish
    const strayed = sim.state.error
    run(sim, 900, { x: -1, y: 0 })     // and back
    const stats = smaStats(sim)
    expect(sim.state.error).toBeLessThan(strayed)
    expect(stats.worstErrorPct).toBe(Math.round(strayed * 100))
  })

  it('survives a finished run with no scored time at all', () => {
    const sim = createSmaSim({ rng: halves, tuning: { ...still, durationMs: 0 } })
    sim.step(LEAD_IN_MS, { x: 0, y: 0 })
    const stats = smaStats(sim)
    expect(stats.onTargetPct).toBe(0)
    expect(stats.rmsErrorPct).toBe(0)
    expect(Number.isFinite(stats.totalScore)).toBe(true)
  })
})

describe('SMA gusts', () => {
  it('are scheduled on Hard and absent on Easier', () => {
    const hard = createSmaSim({ rng: halves, tuning: SMA_TUNING.hard })
    const easier = createSmaSim({ rng: halves, tuning: SMA_TUNING.easier })
    expect(hard.state.gusts.length).toBeGreaterThan(0)
    expect(easier.state.gusts).toHaveLength(0)
    // Every one lands inside the run, or it may as well not exist.
    for (const g of hard.state.gusts) {
      expect(g.at).toBeLessThan(LEAD_IN_MS + SMA_TUNING.hard.durationMs)
    }
  })

  it('shove the dot a bounded distance and then stop pushing', () => {
    const tuning = { durationMs: 60000, driftRate: 0, ringRadius: 0.16, gusts: true }
    const sim = createSmaSim({ rng: halves, tuning })
    const first = sim.state.gusts[0]
    // Up to just before the gust: nothing has moved (no drift in this tuning).
    run(sim, Math.floor(first.at / 20) * 20, { x: 0, y: 0 })
    expect(Math.hypot(sim.state.x, sim.state.y)).toBeLessThan(1e-9)

    run(sim, 400, { x: 0, y: 0 })
    expect(Math.hypot(sim.state.x, sim.state.y)).toBeGreaterThan(0.05)

    // A gust is an impulse to the dot's VELOCITY, not to its position, so the
    // shove is still being delivered for a couple of seconds after it fires —
    // the total displacement is the integral of a decaying velocity, which
    // comes to GUST_PEAK × GUST_TAU ≈ 0.39 of the display radius. Bounded well
    // inside the face is the property that matters: a gust must be something a
    // player recovers from in half a second of full deflection, not something
    // that pins the dot to the bezel.
    run(sim, 5000, { x: 0, y: 0 })
    const settled = { x: sim.state.x, y: sim.state.y }
    expect(Math.hypot(settled.x, settled.y)).toBeLessThan(0.5)

    // And by then it really has stopped: seven decay constants on, the dot is
    // at rest rather than still drifting outward.
    run(sim, 3000, { x: 0, y: 0 })
    const crept = Math.hypot(sim.state.x - settled.x, sim.state.y - settled.y)
    expect(crept).toBeLessThan(0.01)
  })
})

describe('SMA difficulty split', () => {
  it('gives Hard a higher ceiling and a tighter ring than Easier', () => {
    // A one-minute Hard run and a thirty-second Easier one, at 10 points a
    // second held dead centre.
    expect(maxSmaScore(SMA_TUNING.hard)).toBe(600)
    expect(maxSmaScore(SMA_TUNING.easier)).toBe(300)
    expect(SMA_TUNING.hard.ringRadius).toBeLessThan(SMA_TUNING.easier.ringRadius)
    expect(SMA_TUNING.hard.driftRate).toBeGreaterThan(SMA_TUNING.easier.driftRate)
  })

  it('sends each difficulty to its own board', () => {
    expect(SMA_TUNING.hard.gameKey).toBe('sma')
    expect(SMA_TUNING.easier.gameKey).toBe('sma-easier')
  })

  it('keeps every grade band under its own difficulty ceiling', () => {
    for (const tuning of Object.values(SMA_TUNING)) {
      const max = maxSmaScore(tuning)
      expect(tuning.grades.outstanding).toBeLessThan(max)
      expect(tuning.grades.outstanding).toBeGreaterThan(tuning.grades.good)
      expect(tuning.grades.good).toBeGreaterThan(tuning.grades.needsWork)
    }
  })
})
