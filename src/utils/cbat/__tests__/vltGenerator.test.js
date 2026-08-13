import { describe, it, expect } from 'vitest'
import { buildVltRun, tabsForRun } from '../vltGenerator'
import { VLT_PACKS } from '../vltPacks'
import { VLT_TUNING, VLT_QUESTIONS } from '../vltDifficulty'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('VLT packs', () => {
  it('gives every pack eight tabs', () => {
    for (const pack of VLT_PACKS) {
      expect([pack.id, pack.tabs.length]).toEqual([pack.id, 8])
    }
  })

  it('declares an easier subset that actually exists in the pack', () => {
    for (const pack of VLT_PACKS) {
      const ids = new Set(pack.tabs.map(t => t.id))
      for (const id of pack.easierTabs) expect([pack.id, id, ids.has(id)]).toEqual([pack.id, id, true])
      expect([pack.id, pack.easierTabs.length]).toEqual([pack.id, VLT_TUNING.easier.tabCount])
    }
  })

  it('only references tabs that exist, and always joins exactly two', () => {
    // A one-tab question is a reading-comprehension question, not a VLT
    // question — the whole test is joining two sections.
    for (const pack of VLT_PACKS) {
      const ids = new Set(pack.tabs.map(t => t.id))
      for (const q of pack.questions) {
        expect([q.id, q.needs.length]).toEqual([q.id, 2])
        expect([q.id, q.needs[0] !== q.needs[1]]).toEqual([q.id, true])
        for (const n of q.needs) expect([q.id, n, ids.has(n)]).toEqual([q.id, n, true])
      }
    }
  })

  it('leaves enough Easier-answerable questions to fill a run', () => {
    // Easier shows five tabs; a question whose second half was never shown is
    // unanswerable and reads as the game being broken.
    for (const pack of VLT_PACKS) {
      const allowed = new Set(pack.easierTabs)
      const usable = pack.questions.filter(q => q.needs.every(id => allowed.has(id)))
      expect([pack.id, usable.length >= VLT_QUESTIONS]).toEqual([pack.id, true])
    }
  })

  it('names a trap that is one of the question\'s own distractors', () => {
    for (const pack of VLT_PACKS) {
      for (const q of pack.questions) {
        expect([q.id, q.distractors.includes(q.trap)]).toEqual([q.id, true])
      }
    }
  })

  it('never repeats the answer among the distractors', () => {
    for (const pack of VLT_PACKS) {
      for (const q of pack.questions) {
        expect([q.id, q.distractors.includes(q.answer)]).toEqual([q.id, false])
        expect([q.id, new Set(q.distractors).size]).toEqual([q.id, q.distractors.length])
      }
    }
  })

  it('gives every question exactly three distractors, for four options', () => {
    for (const pack of VLT_PACKS) {
      for (const q of pack.questions) expect([q.id, q.distractors.length]).toEqual([q.id, 3])
    }
  })

  it('uses unique question ids across every pack', () => {
    const ids = VLT_PACKS.flatMap(p => p.questions.map(q => q.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('tabsForRun', () => {
  it('returns the whole pack at the Hard tab count', () => {
    for (const pack of VLT_PACKS) {
      expect(tabsForRun(pack, VLT_TUNING.hard.tabCount)).toHaveLength(pack.tabs.length)
    }
  })

  it('returns exactly the declared easier subset at the Easier tab count', () => {
    for (const pack of VLT_PACKS) {
      const tabs = tabsForRun(pack, VLT_TUNING.easier.tabCount)
      expect(tabs.map(t => t.id).sort()).toEqual([...pack.easierTabs].sort())
    }
  })
})

describe('buildVltRun', () => {
  it('fills a full run on both difficulties, for every pack', () => {
    for (const tuning of [VLT_TUNING.easier, VLT_TUNING.hard]) {
      for (const pack of VLT_PACKS) {
        const run = buildVltRun(
          { tabCount: tuning.tabCount, questionCount: VLT_QUESTIONS, packId: pack.id },
          mulberry32(5),
        )
        expect([pack.id, tuning.key, run.questions.length]).toEqual([pack.id, tuning.key, VLT_QUESTIONS])
      }
    }
  })

  it('never asks about a tab it did not show', () => {
    for (const tuning of [VLT_TUNING.easier, VLT_TUNING.hard]) {
      for (let seed = 0; seed < 120; seed++) {
        const run = buildVltRun({ tabCount: tuning.tabCount, questionCount: VLT_QUESTIONS }, mulberry32(seed))
        const shown = new Set(run.tabs.map(t => t.id))
        for (const q of run.questions) {
          for (const id of q.needs) expect([seed, q.id, id, shown.has(id)]).toEqual([seed, q.id, id, true])
        }
      }
    }
  })

  it('offers four options containing the answer', () => {
    for (let seed = 0; seed < 60; seed++) {
      const run = buildVltRun({ tabCount: 8, questionCount: VLT_QUESTIONS }, mulberry32(seed))
      for (const q of run.questions) {
        expect(q.options).toHaveLength(4)
        expect(q.options).toContain(q.answer)
      }
    }
  })

  it('never repeats a question within a run', () => {
    for (let seed = 0; seed < 60; seed++) {
      const run = buildVltRun({ tabCount: 8, questionCount: VLT_QUESTIONS }, mulberry32(seed))
      const ids = run.questions.map(q => q.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('draws from more than one pack across runs', () => {
    const seen = new Set()
    for (let seed = 0; seed < 40; seed++) {
      seen.add(buildVltRun({ tabCount: 8, questionCount: VLT_QUESTIONS }, mulberry32(seed)).packId)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('is deterministic for a given seed', () => {
    const a = buildVltRun({ tabCount: 8, questionCount: VLT_QUESTIONS }, mulberry32(9))
    const b = buildVltRun({ tabCount: 8, questionCount: VLT_QUESTIONS }, mulberry32(9))
    expect(a).toEqual(b)
  })
})

describe('vltDifficulty', () => {
  it('pins the keys a difficulty is allowed to change', () => {
    const allowed = new Set([
      'key', 'label', 'gameKey', 'bars', 'blurb', 'tabCount', 'readMs', 'perQuestionMs', 'grades',
    ])
    for (const tuning of Object.values(VLT_TUNING)) {
      for (const k of Object.keys(tuning)) expect([k, allowed.has(k)]).toEqual([k, true])
    }
  })

  it('keeps both three-minute clocks on both difficulties', () => {
    // The two timings on this test anyone has confirmed first-hand: three
    // minutes to read up front, then roughly three minutes a question. Neither
    // is ours to tune, so Easier lowers the load instead — fewer tabs to search.
    expect(VLT_TUNING.easier.readMs).toBe(VLT_TUNING.hard.readMs)
    expect(VLT_TUNING.easier.perQuestionMs).toBe(VLT_TUNING.hard.perQuestionMs)
    expect(VLT_TUNING.hard.perQuestionMs).toBe(180000)
  })

  it('raises the grade bands on Easier, because both score out of the same total', () => {
    expect(VLT_TUNING.easier.grades.outstanding).toBeGreaterThan(VLT_TUNING.hard.grades.outstanding)
  })
})
