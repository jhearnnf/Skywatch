import { describe, it, expect } from 'vitest'
import { makeSim, computeWarnings, advanceSim, award, grade } from '../../utils/cbat/cutSim'
import { CUT_TUNING } from '../../utils/cbat/cutDifficulty'

// The sim carries its difficulty tuning, so every case below names one. These
// were all written against the original cadences, which are now 'hard'.

describe('CUT simulation', () => {
  it('starts with a clean, in-tolerance state', () => {
    const sim = makeSim('hard')
    expect(computeWarnings(sim)).toEqual([])
    // Exactly one tank feeds at a time.
    expect(sim.fuel.filter(f => f.on)).toHaveLength(1)
    // Airspeed starts inside tolerance (safe ceiling = required + 10).
    expect(Math.abs(sim.speed - sim.requiredSpeed)).toBeLessThanOrEqual(10)
  })

  it('raises a fuel-imbalance warning once the feeding tank drains past 50 L spread', () => {
    const sim = makeSim('hard')
    // Advance ~60s with no player action — the feeding tank drains well past the
    // 50 L spread, so ENGINE must warn.
    for (let i = 0; i < 600; i++) advanceSim(sim, 100)
    expect(computeWarnings(sim).some(w => w.startsWith('ENGINE'))).toBe(true)
  })

  it('flags a sensor as overdue when its interval elapses without activation', () => {
    const sim = makeSim('hard')
    // Air sensor is due at 45s; run to ~50s.
    for (let i = 0; i < 500; i++) advanceSim(sim, 100)
    expect(computeWarnings(sim)).toContain('SENSOR: air sensor overdue')
  })

  it('only ever orders the camera that is not already selected', () => {
    // Run several sims well past the first camera order (40–55s) and keep going
    // so a second order lands too; every order must be the opposite camera.
    for (let n = 0; n < 25; n++) {
      const sim = makeSim('hard')
      let seen = 0
      for (let i = 0; i < 1500; i++) {
        const before = sim.requiredCamera
        advanceSim(sim, 100)
        if (sim.requiredCamera && sim.requiredCamera !== before) {
          expect(sim.requiredCamera).not.toBe(sim.camera)
          seen += 1
        }
      }
      expect(seen).toBeGreaterThan(0)
    }
  })

  it('penalises a missed comms code once its window lapses', () => {
    const sim = makeSim('hard')
    // First code is issued ~10s in and closes 30s later; run past ~45s.
    for (let i = 0; i < 450; i++) advanceSim(sim, 100)
    expect(sim.tasksMissed).toBeGreaterThan(0)
    // The miss is recorded as a negative commentary line (score itself may stay
    // positive under the lenient model — the point is the fault is penalised).
    expect(sim.log.some(e => e.delta < 0 && /comms code window missed/.test(e.text))).toBe(true)
  })

  it('award() both applies the delta and logs a commentary line', () => {
    const sim = makeSim('hard')
    const before = sim.score
    award(sim, 25, 'comms code entered correctly')
    expect(sim.score).toBe(before + 25)
    expect(sim.log[0]).toMatchObject({ delta: 25, text: 'comms code entered correctly' })
  })

  it('logs warning bleed lines while a breach is active (at most one per second per breach)', () => {
    const sim = makeSim('hard')
    for (let i = 0; i < 300; i++) advanceSim(sim, 100)  // ~30s, several breaches accrue
    const bleedLines = sim.log.filter(e => e.delta < 0 && /ENGINE|SENSOR|SYSTEM|NAVIGATION/.test(e.text))
    expect(bleedLines.length).toBeGreaterThan(0)
    // Never more bleed lines than elapsed whole-seconds × active breaches — i.e.
    // it isn't logging every 100ms tick.
    expect(bleedLines.length).toBeLessThan(300)
  })

  it('accrues warning time only while a breach is active', () => {
    const sim = makeSim('hard')
    for (let i = 0; i < 300; i++) advanceSim(sim, 100)
    expect(sim.warningMs).toBeGreaterThan(0)
    expect(sim.warningMs).toBeLessThanOrEqual(sim.elapsedMs)
  })
})

// Easier is the same test at a lower load: the systems wander away from you
// more slowly and the Message feed asks for things less often. Nothing about
// the tolerances, the scoring or the 180s length changes.
describe('CUT simulation — Easier difficulty', () => {
  const runFor = (sim, ms) => { for (let i = 0; i < ms / 100; i++) advanceSim(sim, 100) }

  it('drains fuel, bleeds airspeed and moves pressure more slowly than Hard', () => {
    const easy = makeSim('easier')
    const hard = makeSim('hard')
    // Same starting state on both, so the only difference is the drift rate.
    easy.speed = hard.speed = 400
    easy.requiredSpeed = hard.requiredSpeed = 400
    easy.pressure = hard.pressure = 100
    easy.pump = hard.pump = false
    runFor(easy, 10_000)
    runFor(hard, 10_000)

    expect(easy.fuel[0].level).toBeGreaterThan(hard.fuel[0].level)
    expect(easy.speed).toBeGreaterThan(hard.speed)
    expect(easy.pressure).toBeGreaterThan(hard.pressure)
  })

  it('takes longer to break the fuel tolerance with no player action', () => {
    const easy = makeSim('easier')
    const hard = makeSim('hard')
    runFor(easy, 20_000)
    runFor(hard, 20_000)
    // Hard has already broken the 50 L spread at 20s; Easier hasn't.
    expect(computeWarnings(hard).some(w => w.startsWith('ENGINE'))).toBe(true)
    expect(computeWarnings(easy).some(w => w.startsWith('ENGINE'))).toBe(false)
  })

  it('sends fewer messages across a full run', () => {
    // Averaged over several runs — the schedules are randomised within a band,
    // so a single pair could tie by luck.
    let easyTotal = 0
    let hardTotal = 0
    for (let n = 0; n < 8; n++) {
      const easy = makeSim('easier')
      const hard = makeSim('hard')
      runFor(easy, 180_000)
      runFor(hard, 180_000)
      easyTotal += easy.messages.length
      hardTotal += hard.messages.length
    }
    expect(easyTotal).toBeLessThan(hardTotal)
  })

  it('keeps the shared tolerances and run length identical', () => {
    const easy = makeSim('easier')
    const hard = makeSim('hard')
    // Sensor intervals are tolerance timers, not message cadence — untouched.
    expect(easy.airDueAt).toBe(hard.airDueAt)
    expect(easy.groundDueAt).toBe(hard.groundDueAt)
    expect(computeWarnings(easy)).toEqual([])
  })

  it('grades on its own lower bands', () => {
    expect(grade(800, CUT_TUNING.easier).label).toBe('Outstanding')
    expect(grade(800, CUT_TUNING.hard).label).toBe('Good')
    // Default is Hard, so an ungraded call can't silently inflate a score.
    expect(grade(800).label).toBe('Good')
  })
})
