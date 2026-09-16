import { describe, it, expect } from 'vitest'
import {
  makeSim, advanceSim, orderMissionField, orderCamera, resetDispenser, fieldValue, fmtFieldValue,
  MISSION_FIELDS, MISSION_FIELD_BY_KEY, FIELD_WINDOW, DISPENSER_LIGHTS, RELEASE_WINDOW,
  CAMERA_WINDOW, CODE_WINDOW, CODE_ACK_WINDOW, SCORE,
} from '../../utils/cbat/cutSim'
import { CUT_TUNING } from '../../utils/cbat/cutDifficulty'

// The Real CBAT variant of the sim (`makeSim(d, { cbat: true })`): the Mission
// display is the real one — field orders through Message, a six-light
// dispenser and RELEASE — camera orders carry a Clock time, and a comms code's
// timer reaching zero brings up a button. The SkyWatch sim must not change.

const run = (sim, ms, step = 100) => { for (let t = 0; t < ms; t += step) advanceSim(sim, step) }
const pendingOrders = (sim) => MISSION_FIELDS.filter(f => sim.mission.fields[f.key].order)
// Commentary lines are the reliable record of a discrete fault: the score
// itself also carries the per-second green trickle and other tasks' misses.
const logged = (sim, text) => sim.log.filter(e => e.text === text)

describe('CUT sim — Real CBAT variant', () => {
  it('starts with no station drop and no field order, and a dispenser at zero', () => {
    const sim = makeSim('hard', { cbat: true })
    expect(sim.cbat).toBe(true)
    expect(sim.loadArmed).toBe(false)
    expect(sim.messages.some(m => m.text.startsWith('MISSION: drop'))).toBe(false)
    expect(pendingOrders(sim)).toHaveLength(0)
    expect(sim.mission.lights).toBe(0)
  })

  it('leaves the SkyWatch sim exactly as it was', () => {
    const sim = makeSim('hard')
    expect(sim.cbat).toBe(false)
    expect(sim.loadArmed).toBe(true)
    expect(sim.messages.some(m => m.text.startsWith('MISSION: drop'))).toBe(true)
    run(sim, 180_000)
    // Nothing from the variant ever fires: no field orders, no camera times, no button at zero.
    expect(sim.messages.some(m => m.text.startsWith('MISSION: set'))).toBe(false)
    expect(sim.messages.some(m => /select camera \w+ at \d\d:\d\d:\d\d/.test(m.text))).toBe(false)
    expect(sim.codeAck).toBeNull()
  })

  it('orders one field value at a time through Message, at the tuned cadence', () => {
    const sim = makeSim('hard', { cbat: true })
    run(sim, CUT_TUNING.hard.fieldFirstMs + 100)
    const orders = pendingOrders(sim)
    expect(orders).toHaveLength(1)
    const [field] = orders
    const st = sim.mission.fields[field.key]
    expect(st.order).toHaveLength(field.digits)
    const line = sim.messages.find(m => m.id === st.messageId)
    expect(line.text).toBe(`MISSION: set ${field.order} to ${fmtFieldValue(field, st.order)}`)
  })

  it('lets an unconfirmed order lapse after its window, as a fault', () => {
    const sim = makeSim('hard', { cbat: true })
    orderMissionField(sim)
    const [field] = pendingOrders(sim)
    run(sim, FIELD_WINDOW + 200)
    expect(sim.mission.fields[field.key].order).toBeNull()
    expect(sim.tasksMissed).toBeGreaterThanOrEqual(1)
    const fault = logged(sim, `${field.order} not set`)
    expect(fault).toHaveLength(1)
    expect(fault[0].delta).toBe(SCORE.fieldMissed)
    expect(sim.messages.some(m => m.text === `MISSION: ${field.order} order missed`)).toBe(true)
  })

  it('never orders a field that is already waiting on a value', () => {
    const sim = makeSim('hard', { cbat: true })
    const seen = new Set()
    for (let i = 0; i < MISSION_FIELDS.length; i++) {
      const field = orderMissionField(sim)
      expect(field).not.toBeNull()
      expect(seen.has(field.key)).toBe(false)
      seen.add(field.key)
    }
    expect(orderMissionField(sim)).toBeNull()
    expect(sim.messages.filter(m => m.text.startsWith('MISSION: set'))).toHaveLength(MISSION_FIELDS.length)
  })

  it('generates values of the right shape for every field', () => {
    for (const f of MISSION_FIELDS) {
      for (let i = 0; i < 50; i++) {
        const v = fieldValue(f)
        expect(v).toMatch(new RegExp(`^\\d{${f.digits}}$`))
        if (f.key === 'loadTime') expect(Number(v.slice(0, 2))).toBeLessThan(24)
        if (f.digits === 6) {
          expect(Number(v.slice(2, 4))).toBeLessThan(60)
          expect(Number(v.slice(4, 6))).toBeLessThan(60)
          expect(fmtFieldValue(f, v)).toMatch(/^\d\d:\d\d:\d\d$/)
        }
        if (f.key === 'vidMag') expect(Number(v)).toBeGreaterThanOrEqual(1)
      }
    }
    expect(MISSION_FIELD_BY_KEY.vidDur.digits).toBe(2)
  })

  it('lights the dispenser one lamp at a time, then expects RELEASE within the window', () => {
    const sim = makeSim('hard', { cbat: true })
    const [lo, hi] = CUT_TUNING.hard.lightGapMs
    // One lamp per tick at most, each at least `lo` after the last.
    let last = 0
    let lastAt = 0
    while (sim.mission.lights < DISPENSER_LIGHTS) {
      advanceSim(sim, 100)
      expect(sim.mission.lights - last).toBeLessThanOrEqual(1)
      if (sim.mission.lights > last) {
        if (last > 0) expect(sim.elapsedMs - lastAt).toBeGreaterThanOrEqual(lo)
        expect(sim.elapsedMs - lastAt).toBeLessThanOrEqual(hi + 100)
        last = sim.mission.lights
        lastAt = sim.elapsedMs
      }
      expect(sim.elapsedMs).toBeLessThan(DISPENSER_LIGHTS * (hi + 100) + 1000)
    }
    expect(sim.mission.fullAt).toBe(sim.elapsedMs)
    run(sim, RELEASE_WINDOW + 200)
    // Not released: fault, and the dispenser empties for the next fill.
    const fault = logged(sim, 'load not released')
    expect(fault).toHaveLength(1)
    expect(fault[0].delta).toBe(SCORE.releaseMissed)
    expect(sim.mission.lights).toBe(0)
    expect(sim.messages.some(m => m.text === 'MISSION: release window missed')).toBe(true)
  })

  it('resetDispenser empties the lights and schedules the next fill', () => {
    const sim = makeSim('easier', { cbat: true })
    sim.mission.lights = DISPENSER_LIGHTS
    sim.mission.fullAt = sim.elapsedMs
    resetDispenser(sim, 5_000)
    expect(sim.mission.lights).toBe(0)
    expect(sim.mission.fullAt).toBeNull()
    expect(sim.mission.nextLightAt).toBe(sim.elapsedMs + 5_000)
  })

  it('camera orders name a Clock time and lapse as a fault if never pressed', () => {
    const sim = makeSim('hard', { cbat: true })
    run(sim, CUT_TUNING.hard.cameraFirstMs[1] + 100)
    expect(sim.requiredCamera).not.toBeNull()
    expect(sim.cameraDueAt).toBeGreaterThan(0)
    const line = sim.messages.find(m => m.id === sim.cameraMessageId)
    expect(line.text).toMatch(new RegExp(`^SENSOR: select camera ${sim.requiredCamera} at \\d\\d:\\d\\d:\\d\\d$`))
    const cam = sim.requiredCamera
    run(sim, sim.cameraDueAt - sim.elapsedMs + CAMERA_WINDOW + 200)
    expect(sim.requiredCamera).toBeNull()
    const fault = sim.log.filter(e => e.text.startsWith(`camera ${cam} not selected at`))
    expect(fault).toHaveLength(1)
    expect(fault[0].delta).toBe(SCORE.cameraMissed)
  })

  it('orderCamera always names the camera that is not live', () => {
    const sim = makeSim('hard', { cbat: true })
    sim.camera = 'Bravo'
    orderCamera(sim, 10_000)
    expect(sim.requiredCamera).toBe('Alpha')
    expect(sim.cameraDueAt).toBe(sim.elapsedMs + 10_000)
  })

  it('brings up the button when a code timer reaches zero, and faults it if ignored', () => {
    const sim = makeSim('hard', { cbat: true })
    run(sim, CUT_TUNING.hard.firstCodeMs + 100)
    expect(sim.code).not.toBeNull()
    // The player got the code in: no miss at zero, but the button still appears.
    sim.code.entered = true
    run(sim, CODE_WINDOW)
    expect(sim.code).toBeNull()
    expect(logged(sim, 'comms code window missed')).toHaveLength(0)
    expect(sim.codeAck).not.toBeNull()
    run(sim, CODE_ACK_WINDOW + 200)
    expect(sim.codeAck).toBeNull()
    const fault = logged(sim, 'comms button not pressed')
    expect(fault).toHaveLength(1)
    expect(fault[0].delta).toBe(SCORE.codeAckMissed)
  })

  it('still faults a code that was never entered, and brings up the button anyway', () => {
    const sim = makeSim('hard', { cbat: true })
    run(sim, CUT_TUNING.hard.firstCodeMs + 100)
    run(sim, CODE_WINDOW)
    expect(sim.code).toBeNull()
    expect(logged(sim, 'comms code window missed')).toHaveLength(1)
    expect(sim.codeAck).not.toBeNull()
  })

  it('keeps every variant-only score constant on the sheet', () => {
    for (const k of ['field', 'fieldSpeedBonus', 'fieldWrong', 'fieldMissed', 'release', 'releaseSpeedBonus',
      'releasePremature', 'releaseMissed', 'cameraEarly', 'cameraMissed', 'codeAck', 'codeAckSpeedBonus', 'codeAckMissed']) {
      expect(typeof SCORE[k]).toBe('number')
    }
  })

  it('a do-nothing run lands in the same region as the SkyWatch variant', () => {
    // Both variants bleed the same green trickle and warning costs; the
    // variant's extra misses are small, so idle scores stay comparable.
    const a = makeSim('hard'); run(a, 180_000)
    const b = makeSim('hard', { cbat: true }); run(b, 180_000)
    expect(Math.abs(a.score - b.score)).toBeLessThan(250)
  })
})
