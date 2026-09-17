import { describe, it, expect } from 'vitest'
import {
  makeSim, advanceSim, orderCamera,
  MISSION_FIELDS, CAMERA_WINDOW, CODE_ACK_WINDOW, SCORE,
} from '../../utils/cbat/cutSim'
import { CUT_TUNING } from '../../utils/cbat/cutDifficulty'

// The Mission display (CbatCut.missionSim.test.js) runs under both themes.
// The Real CBAT variant of the sim (`makeSim(d, { cbat: true })`) adds camera
// orders that carry a Clock time and a button when a comms code's timer
// reaches zero; the SkyWatch sim must see neither.

const run = (sim, ms, step = 100) => { for (let t = 0; t < ms; t += step) advanceSim(sim, step) }
const pendingOrders = (sim) => MISSION_FIELDS.filter(f => sim.mission.fields[f.key].order)
// Commentary lines are the reliable record of a discrete fault: the score
// itself also carries the per-second green trickle and other tasks' misses.
const logged = (sim, text) => sim.log.filter(e => e.text === text)

describe('CUT sim — Real CBAT variant', () => {
  it('starts with no field order and a dispenser at zero, under either theme', () => {
    for (const cbat of [false, true]) {
      const sim = makeSim('hard', { cbat })
      expect(sim.cbat).toBe(cbat)
      expect(pendingOrders(sim)).toHaveLength(0)
      expect(sim.mission.drop).toBeNull()
      expect(sim.messages.some(m => m.text.startsWith('MISSION: set'))).toBe(false)
    }
  })

  it('runs the Mission display for the SkyWatch sim but none of the variant extras', () => {
    const sim = makeSim('hard')
    run(sim, 180_000)
    expect(sim.messages.some(m => m.text.startsWith('MISSION: set'))).toBe(true)
    expect(sim.messages.some(m => /^MISSION: load drop at \d\d:\d\d:\d\d missed$/.test(m.text))).toBe(true)
    // Nothing from the variant ever fires: no camera times, no button at zero.
    expect(sim.messages.some(m => /select camera \w+ at \d\d:\d\d:\d\d/.test(m.text))).toBe(false)
    expect(sim.messages.some(m => /^SENSOR: select camera \w+$/.test(m.text))).toBe(true)
    expect(sim.codeAck).toBeNull()
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
    run(sim, sim.tuning.codeWindowMs)
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
    run(sim, sim.tuning.codeWindowMs)
    expect(sim.code).toBeNull()
    expect(logged(sim, 'comms code window missed')).toHaveLength(1)
    expect(sim.codeAck).not.toBeNull()
  })

  it('keeps every variant-only score constant on the sheet', () => {
    for (const k of ['field', 'fieldSpeedBonus', 'fieldWrong', 'fieldMissed', 'release', 'releaseLate',
      'releasePremature', 'releaseMissed', 'cameraEarly', 'cameraMissed', 'codeAck', 'codeAckSpeedBonus', 'codeAckMissed']) {
      expect(typeof SCORE[k]).toBe('number')
    }
  })

  it('a do-nothing run lands in the same region as the SkyWatch sim', () => {
    // Both bleed the same green trickle and warning costs; the variant's extra
    // misses are small, so idle scores stay comparable.
    const a = makeSim('hard'); run(a, 180_000)
    const b = makeSim('hard', { cbat: true }); run(b, 180_000)
    expect(Math.abs(a.score - b.score)).toBeLessThan(250)
  })
})
