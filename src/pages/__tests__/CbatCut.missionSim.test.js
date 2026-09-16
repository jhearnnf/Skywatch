import { describe, it, expect } from 'vitest'
import {
  makeSim, advanceSim, orderMissionField, startDrop, orderLoadField, clearDrop, dispenserLights, dispenserArmed,
  fieldValue, fmtFieldValue, clockAt,
  MISSION_FIELDS, MISSION_FIELD_BY_KEY, LOAD_FIELDS, VIDEO_FIELDS, LOAD_ORDER, FIELD_WINDOW, DISPENSER_LIGHTS,
  RELEASE_WINDOW, SCORE,
} from '../../utils/cbat/cutSim'
import { CUT_TUNING } from '../../utils/cbat/cutDifficulty'

// The Mission display's sim, the same under both themes. A load drop is three
// orders through Message — latitude, longitude, then a Clock time — all wanted
// by the drop time; the dispenser arms once the three values are on the
// interface; the drop lapses as a fault a short window after its time. Video
// values are ordered one at a time on their own cadence.

const run = (sim, ms, step = 100) => { for (let t = 0; t < ms; t += step) advanceSim(sim, step) }
const pendingOrders = (sim) => MISSION_FIELDS.filter(f => sim.mission.fields[f.key].order)
const logged = (sim, text) => sim.log.filter(e => e.text === text)
const setLines = (sim) => sim.messages.filter(m => m.text.startsWith('MISSION: set '))

describe('CUT sim — load drop', () => {
  it('orders a drop as latitude, longitude, then a Clock time, on the tuned cadence', () => {
    const t = CUT_TUNING.hard
    const sim = makeSim('hard')
    expect(sim.mission.drop).toBeNull()
    run(sim, t.firstDropMs + 100)
    const drop = sim.mission.drop
    expect(drop).not.toBeNull()
    expect(drop.issued).toBe(1)
    expect(pendingOrders(sim).map(f => f.key)).toEqual(['loadLat'])
    // Due on a whole Clock second, inside the lead.
    expect(drop.dueAt % 1000).toBe(0)
    expect(drop.dueAt).toBeGreaterThanOrEqual(t.firstDropMs + t.dropLeadMs[0])
    expect(drop.dueAt).toBeLessThanOrEqual(t.firstDropMs + 100 + t.dropLeadMs[1] + 1000)

    run(sim, 2 * t.dropOrderGapMs[1] + 200)
    expect(drop.issued).toBe(3)
    expect(setLines(sim).filter(m => m.text.includes('load drop')).map(m => m.text.match(/set (.+) to/)[1])).toEqual(
      LOAD_ORDER.map(k => MISSION_FIELD_BY_KEY[k].order))
    // Every load value is wanted by the drop time itself.
    for (const k of LOAD_ORDER) expect(sim.mission.fields[k].dueAt).toBe(drop.dueAt)
    // The time ordered is the drop's own, as the Clock will show it.
    const time = sim.mission.fields.loadTime
    expect(fmtFieldValue(MISSION_FIELD_BY_KEY.loadTime, time.order)).toBe(clockAt(sim, drop.dueAt))
    expect(drop.timeMessageId).toBe(time.messageId)
  })

  it('arms the dispenser only once all three load values are on the interface', () => {
    const sim = makeSim('easier')
    expect(dispenserLights(sim)).toBe(0)
    expect(dispenserArmed(sim)).toBe(false)
    sim.mission.fields.loadLat.value = '512840'
    expect(dispenserLights(sim)).toBe(2)
    sim.mission.fields.loadLon.value = '001500'
    expect(dispenserLights(sim)).toBe(4)
    expect(dispenserArmed(sim)).toBe(false)
    sim.mission.fields.loadTime.value = '141312'
    expect(dispenserLights(sim)).toBe(DISPENSER_LIGHTS)
    expect(dispenserArmed(sim)).toBe(true)
    // Video values play no part in arming.
    for (const f of VIDEO_FIELDS) sim.mission.fields[f.key].value = '1'
    expect(dispenserLights(sim)).toBe(DISPENSER_LIGHTS)
  })

  it('faults a drop never released, clears the interface and books the next', () => {
    const t = CUT_TUNING.hard
    const sim = makeSim('hard')
    startDrop(sim, 5_000)
    while (sim.mission.drop.issued < LOAD_ORDER.length) orderLoadField(sim)
    const { dueAt } = sim.mission.drop
    const when = clockAt(sim, dueAt)
    for (const f of LOAD_FIELDS) sim.mission.fields[f.key].value = sim.mission.fields[f.key].order
    expect(dispenserArmed(sim)).toBe(true)

    run(sim, dueAt - sim.elapsedMs + RELEASE_WINDOW + 200)
    const fault = logged(sim, `load drop at ${when} missed`)
    expect(fault).toHaveLength(1)
    expect(fault[0].delta).toBe(SCORE.releaseMissed)
    expect(sim.messages.some(m => m.text === `MISSION: load drop at ${when} missed`)).toBe(true)
    expect(sim.mission.drop).toBeNull()
    expect(dispenserLights(sim)).toBe(0)
    expect(pendingOrders(sim).filter(f => f.panel === 'load')).toHaveLength(0)
    expect(sim.mission.nextDropAt).toBeGreaterThanOrEqual(sim.elapsedMs + t.dropGapMs[0] - 100)
    expect(sim.mission.nextDropAt).toBeLessThanOrEqual(sim.elapsedMs + t.dropGapMs[1])
  })

  it('faults each load value not entered by the drop time', () => {
    const sim = makeSim('hard')
    startDrop(sim, 5_000)
    while (sim.mission.drop.issued < LOAD_ORDER.length) orderLoadField(sim)
    run(sim, 5_200)
    for (const f of LOAD_FIELDS) {
      expect(logged(sim, `${f.order} not set`)).toHaveLength(1)
      expect(sim.mission.fields[f.key].order).toBeNull()
    }
    expect(sim.tasksMissed).toBeGreaterThanOrEqual(3)
  })

  it('clearDrop withdraws standing load orders and empties the interface', () => {
    const sim = makeSim('easier')
    startDrop(sim, 20_000)
    orderLoadField(sim)
    sim.mission.fields.loadLat.entry = '12'
    sim.mission.fields.loadLon.value = '001500'
    clearDrop(sim, 3_000)
    expect(sim.mission.drop).toBeNull()
    for (const f of LOAD_FIELDS) {
      expect(sim.mission.fields[f.key]).toMatchObject({ entry: '', value: '', order: null })
    }
    expect(sim.mission.nextDropAt).toBe(sim.elapsedMs + 3_000)
  })

  it('keeps ordering drops across a full run', () => {
    const sim = makeSim('hard')
    run(sim, 180_000)
    const times = setLines(sim).filter(m => m.text.includes('set load drop time'))
    expect(times.length).toBeGreaterThanOrEqual(3)
    expect(times.every(m => /to \d\d:\d\d:\d\d$/.test(m.text))).toBe(true)
  })
})

describe('CUT sim — video orders', () => {
  it('orders one video value at a time through Message, at the tuned cadence', () => {
    const sim = makeSim('hard')
    run(sim, CUT_TUNING.hard.fieldFirstMs + 100)
    const video = pendingOrders(sim).filter(f => f.panel === 'video')
    expect(video).toHaveLength(1)
    const [field] = video
    const st = sim.mission.fields[field.key]
    expect(st.order).toHaveLength(field.digits)
    const line = sim.messages.find(m => m.id === st.messageId)
    expect(line.text).toBe(`MISSION: set ${field.order} to ${fmtFieldValue(field, st.order)}`)
  })

  it('lets an unconfirmed video order lapse after its window, as a fault', () => {
    const sim = makeSim('hard')
    sim.mission.nextDropAt = Infinity
    const field = orderMissionField(sim)
    run(sim, FIELD_WINDOW + 200)
    expect(sim.mission.fields[field.key].order).toBeNull()
    expect(sim.tasksMissed).toBeGreaterThanOrEqual(1)
    const fault = logged(sim, `${field.order} not set`)
    expect(fault).toHaveLength(1)
    expect(fault[0].delta).toBe(SCORE.fieldMissed)
    expect(sim.messages.some(m => m.text === `MISSION: ${field.order} order missed`)).toBe(true)
  })

  it('never orders a video field that is already waiting on a value, and never a load field', () => {
    const sim = makeSim('hard')
    const seen = new Set()
    for (let i = 0; i < VIDEO_FIELDS.length; i++) {
      const field = orderMissionField(sim)
      expect(field).not.toBeNull()
      expect(field.panel).toBe('video')
      expect(seen.has(field.key)).toBe(false)
      seen.add(field.key)
    }
    expect(orderMissionField(sim)).toBeNull()
    expect(setLines(sim)).toHaveLength(VIDEO_FIELDS.length)
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
})
