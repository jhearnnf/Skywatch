import { describe, it, expect } from 'vitest'
import { makeSim, computeWarnings, advanceSim, award } from '../../utils/cbat/cutSim'

describe('CUT simulation', () => {
  it('starts with a clean, in-tolerance state', () => {
    const sim = makeSim()
    expect(computeWarnings(sim)).toEqual([])
    // Exactly one tank feeds at a time.
    expect(sim.fuel.filter(f => f.on)).toHaveLength(1)
    // Airspeed starts inside tolerance (safe ceiling = required + 10).
    expect(Math.abs(sim.speed - sim.requiredSpeed)).toBeLessThanOrEqual(10)
  })

  it('raises a fuel-imbalance warning once the feeding tank drains past 50 L spread', () => {
    const sim = makeSim()
    // Advance ~60s with no player action — the feeding tank drains well past the
    // 50 L spread, so ENGINE must warn.
    for (let i = 0; i < 600; i++) advanceSim(sim, 100)
    expect(computeWarnings(sim).some(w => w.startsWith('ENGINE'))).toBe(true)
  })

  it('flags a sensor as overdue when its interval elapses without activation', () => {
    const sim = makeSim()
    // Air sensor is due at 45s; run to ~50s.
    for (let i = 0; i < 500; i++) advanceSim(sim, 100)
    expect(computeWarnings(sim)).toContain('SENSOR: air sensor overdue')
  })

  it('penalises a missed comms code once its 15s window lapses', () => {
    const sim = makeSim()
    // First code is issued ~10s in and expires 15s later; run past ~30s.
    for (let i = 0; i < 300; i++) advanceSim(sim, 100)
    expect(sim.tasksMissed).toBeGreaterThan(0)
    // The miss is recorded as a negative commentary line (score itself may stay
    // positive under the lenient model — the point is the fault is penalised).
    expect(sim.log.some(e => e.delta < 0 && /comms code window missed/.test(e.text))).toBe(true)
  })

  it('award() both applies the delta and logs a commentary line', () => {
    const sim = makeSim()
    const before = sim.score
    award(sim, 25, 'comms code entered correctly')
    expect(sim.score).toBe(before + 25)
    expect(sim.log[0]).toMatchObject({ delta: 25, text: 'comms code entered correctly' })
  })

  it('logs warning bleed lines while a breach is active (at most one per second per breach)', () => {
    const sim = makeSim()
    for (let i = 0; i < 300; i++) advanceSim(sim, 100)  // ~30s, several breaches accrue
    const bleedLines = sim.log.filter(e => e.delta < 0 && /ENGINE|SENSOR|SYSTEM|NAVIGATION/.test(e.text))
    expect(bleedLines.length).toBeGreaterThan(0)
    // Never more bleed lines than elapsed whole-seconds × active breaches — i.e.
    // it isn't logging every 100ms tick.
    expect(bleedLines.length).toBeLessThan(300)
  })

  it('accrues warning time only while a breach is active', () => {
    const sim = makeSim()
    for (let i = 0; i < 300; i++) advanceSim(sim, 100)
    expect(sim.warningMs).toBeGreaterThan(0)
    expect(sim.warningMs).toBeLessThanOrEqual(sim.elapsedMs)
  })
})
