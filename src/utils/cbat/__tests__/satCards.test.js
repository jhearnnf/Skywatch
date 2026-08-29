import { describe, it, expect } from 'vitest'
import { buildSatCards, satObserveMs } from '../satCards'
import { generateSatSituation } from '../satGenerator'
import { SAT_DIFFICULTIES, SAT_TUNING } from '../satDifficulty'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const build = (tuning, seed) => {
  const sit = generateSatSituation({
    questionCount: tuning.questionsPerSituation,
    unitRange: tuning.unitRange,
    aircraftRange: tuning.aircraftRange,
    aircraftFields: tuning.aircraftFields,
    supportChance: tuning.supportChance,
  }, mulberry32(seed))
  return { sit, cards: buildSatCards(sit, tuning.aircraftFields) }
}

describe('SAT observe cards', () => {
  it('turns every fact in the situation into exactly one card', () => {
    for (const t of SAT_DIFFICULTIES) {
      for (let seed = 1; seed <= 100; seed++) {
        const { sit, cards } = build(t, seed)
        const expected = sit.units.length + sit.aircraft.length * t.aircraftFields.length + sit.comms.length
        expect(cards).toHaveLength(expected)

        expect(cards.filter(c => c.kind === 'unit')).toHaveLength(sit.units.length)
        expect(cards.filter(c => c.kind === 'radio')).toHaveLength(sit.comms.length)
        expect(cards.filter(c => c.kind === 'field')).toHaveLength(sit.aircraft.length * t.aircraftFields.length)
      }
    }
  })

  it('shows every unit, every comm and every visible field once and only once', () => {
    for (const t of SAT_DIFFICULTIES) {
      for (let seed = 1; seed <= 100; seed++) {
        const { sit, cards } = build(t, seed)

        expect(new Set(cards.filter(c => c.kind === 'unit').map(c => c.unit.id)))
          .toEqual(new Set(sit.units.map(u => u.id)))

        const fieldKeys = cards.filter(c => c.kind === 'field').map(c => `${c.callsign}:${c.field}`)
        expect(new Set(fieldKeys).size).toBe(fieldKeys.length)
        for (const ac of sit.aircraft) {
          for (const f of t.aircraftFields) expect(fieldKeys).toContain(`${ac.callsign}:${f}`)
        }
      }
    }
  })

  it('never puts a field on a card the difficulty does not show', () => {
    // The recall questions are gated on the same list. A card for a hidden field
    // would be showing something the player is then never asked about; the
    // reverse — a question with no card — is the one that reads as broken.
    for (const t of SAT_DIFFICULTIES) {
      for (let seed = 1; seed <= 100; seed++) {
        for (const c of build(t, seed).cards) {
          if (c.kind === 'field') expect(t.aircraftFields).toContain(c.field)
        }
      }
    }
  })

  it('never runs two fields of the same aircraft back to back', () => {
    // Adjacent fields of one callsign can be chunked into a single memory, which
    // is the crutch that showing them separately exists to remove.
    for (const t of SAT_DIFFICULTIES) {
      for (let seed = 1; seed <= 100; seed++) {
        const cards = build(t, seed).cards
        for (let i = 1; i < cards.length; i++) {
          const a = cards[i - 1], b = cards[i]
          if (a.kind === 'field' && b.kind === 'field') expect(a.callsign).not.toBe(b.callsign)
        }
      }
    }
  })

  it('spreads the radio calls through the queue rather than clumping them', () => {
    // Hard's queue is long enough that consecutive radio calls would hand the
    // player a free block with nothing to look at.
    for (let seed = 1; seed <= 100; seed++) {
      const cards = build(SAT_TUNING.hard, seed).cards
      for (let i = 1; i < cards.length; i++) {
        if (cards[i].kind === 'radio') expect(cards[i - 1].kind).not.toBe('radio')
      }
    }
  })

  it('is deterministic for a given situation', () => {
    const { sit } = build(SAT_TUNING.hard, 7)
    expect(buildSatCards(sit, SAT_TUNING.hard.aircraftFields))
      .toEqual(buildSatCards(sit, SAT_TUNING.hard.aircraftFields))
  })

  it('survives an empty situation', () => {
    expect(buildSatCards({}, ['altitude'])).toEqual([])
    expect(buildSatCards(undefined, undefined)).toEqual([])
  })
})

describe('SAT observe window', () => {
  it('is the queue length times the difficulty dwell', () => {
    expect(satObserveMs(new Array(9), 4000)).toBe(36000)
    expect(satObserveMs(new Array(17), 2500)).toBe(42500)
  })

  it('never returns zero, so a degenerate situation cannot hang the phase', () => {
    expect(satObserveMs([], 2500)).toBe(2500)
  })

  it('gives Hard more to hold than Easier, and less time per fact', () => {
    let easierCards = 0, hardCards = 0
    for (let seed = 1; seed <= 100; seed++) {
      easierCards += build(SAT_TUNING.easier, seed).cards.length
      hardCards += build(SAT_TUNING.hard, seed).cards.length
    }
    expect(hardCards).toBeGreaterThan(easierCards)
    expect(SAT_TUNING.hard.cardMs).toBeLessThan(SAT_TUNING.easier.cardMs)
  })
})
