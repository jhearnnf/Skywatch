import { describe, it, expect } from 'vitest'
import { generateSltSystem, TAB_SPECS_FOR_TEST, TEMPLATES_FOR_TEST } from '../sltGenerator'
import { SLT_TUNING, SLT_QUESTIONS } from '../sltDifficulty'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const opts = (tuning) => ({
  tabCount: tuning.tabCount,
  questionCount: SLT_QUESTIONS,
})

describe('tab catalogue', () => {
  it('holds the fifteen tabs the corpus describes', () => {
    // "A numbered index of 15 tabs down the right." It held eight, and a run
    // drew four or six of them, until the guide was read back against this.
    expect(TAB_SPECS_FOR_TEST).toHaveLength(15)
    expect(SLT_TUNING.hard.tabCount).toBe(15)
  })

  it('gives every field a label unique across the whole catalogue', () => {
    // Generic joins name a field by its label and never say which tab it is on,
    // because finding the tab is the task. Two tabs sharing a label would make
    // such a question ambiguous rather than hard.
    const labels = TAB_SPECS_FOR_TEST.flatMap(s => s.fields.map(f => f.label))
    const seen = new Map()
    for (const l of labels) seen.set(l, (seen.get(l) || 0) + 1)
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([])
  })

  it('leaves every tab joinable — each shares a unit with another tab', () => {
    // This, not a template count, is what earns a tab its place now. A tab whose
    // every unit were unique to it could never appear in a generic join, and
    // could be drawn into a run it cannot contribute a question to.
    const unitsByTab = new Map(TAB_SPECS_FOR_TEST.map(s => [s.id, new Set(s.fields.map(f => f.unit))]))
    for (const spec of TAB_SPECS_FOR_TEST) {
      const mine = unitsByTab.get(spec.id)
      const shares = TAB_SPECS_FOR_TEST.some(
        other => other.id !== spec.id && [...unitsByTab.get(other.id)].some(u => mine.has(u)),
      )
      expect([spec.id, shares]).toEqual([spec.id, true])
    }
  })

  it('only references tabs that exist', () => {
    const ids = new Set(TAB_SPECS_FOR_TEST.map(s => s.id))
    for (const t of TEMPLATES_FOR_TEST) {
      for (const need of t.needs) expect([t.id, need, ids.has(need)]).toEqual([t.id, need, true])
    }
  })
})

describe('generateSltSystem', () => {
  it('fills a full run on both difficulties, for any tab draw', () => {
    for (const tuning of [SLT_TUNING.easier, SLT_TUNING.hard]) {
      for (let seed = 0; seed < 200; seed++) {
        const sys = generateSltSystem(opts(tuning), mulberry32(seed))
        expect([tuning.key, seed, sys.questions.length]).toEqual([tuning.key, seed, SLT_QUESTIONS])
      }
    }
  })

  it('serves the requested number of tabs', () => {
    for (const tuning of [SLT_TUNING.easier, SLT_TUNING.hard]) {
      const sys = generateSltSystem(opts(tuning), mulberry32(11))
      expect(sys.tabs).toHaveLength(tuning.tabCount)
    }
  })

  it('never asks a question about a tab it did not show', () => {
    for (const tuning of [SLT_TUNING.easier, SLT_TUNING.hard]) {
      for (let seed = 0; seed < 120; seed++) {
        const sys = generateSltSystem(opts(tuning), mulberry32(seed))
        const shown = new Set(sys.tabs.map(t => t.id))
        for (const q of sys.questions) {
          for (const id of q.tabIds) expect([seed, id, shown.has(id)]).toEqual([seed, id, true])
        }
      }
    }
  })

  it('never lets a single tab answer a question, on either difficulty', () => {
    // The corpus states this flatly, and Easier was single-hop until the guide
    // was read back against it. THE load-bearing property of this generator: a
    // question you can answer off one tab is a different test.
    for (const tuning of [SLT_TUNING.easier, SLT_TUNING.hard]) {
      for (let seed = 0; seed < 200; seed++) {
        const sys = generateSltSystem(opts(tuning), mulberry32(seed))
        for (const q of sys.questions) {
          expect([tuning.key, seed, q.id, q.hops]).toEqual([tuning.key, seed, q.id, 2])
          expect([q.id, new Set(q.tabIds).size]).toEqual([q.id, 2])
        }
      }
    }
  })

  it('produces whole-number answers with four distinct options, one of them right', () => {
    for (const tuning of [SLT_TUNING.easier, SLT_TUNING.hard]) {
      for (let seed = 0; seed < 150; seed++) {
        const sys = generateSltSystem(opts(tuning), mulberry32(seed))
        for (const q of sys.questions) {
          expect([q.id, Number.isInteger(q.answer)]).toEqual([q.id, true])
          expect(q.options).toHaveLength(4)
          expect(new Set(q.options).size).toBe(4)
          expect(q.options).toContain(q.answer)
        }
      }
    }
  })

  it('never serves an answer of zero or below', () => {
    // A zero or negative answer reads as a broken question rather than a hard
    // one, and is a sign that a template's operands crossed over. The generic
    // joins order their operands largest first for exactly this reason.
    for (const tuning of [SLT_TUNING.easier, SLT_TUNING.hard]) {
      for (let seed = 0; seed < 300; seed++) {
        const sys = generateSltSystem(opts(tuning), mulberry32(seed))
        for (const q of sys.questions) {
          expect([q.id, seed, q.answer > 0]).toEqual([q.id, seed, true])
        }
      }
    }
  })

  it('never repeats a question within a run', () => {
    for (const tuning of [SLT_TUNING.easier, SLT_TUNING.hard]) {
      for (let seed = 0; seed < 120; seed++) {
        const sys = generateSltSystem(opts(tuning), mulberry32(seed))
        const prompts = sys.questions.map(q => q.prompt)
        expect([tuning.key, seed, new Set(prompts).size]).toEqual([tuning.key, seed, prompts.length])
      }
    }
  })

  it('avoids putting two consecutive questions on the same tab where it can', () => {
    // Preference, not a guarantee — but it should hold overwhelmingly.
    let adjacent = 0, total = 0
    for (let seed = 0; seed < 100; seed++) {
      const sys = generateSltSystem(opts(SLT_TUNING.hard), mulberry32(seed))
      for (let i = 1; i < sys.questions.length; i++) {
        total++
        if (sys.questions[i].tabIds.some(id => sys.questions[i - 1].tabIds.includes(id))) adjacent++
      }
    }
    expect(adjacent / total).toBeLessThan(0.25)
  })

  it('is deterministic for a given seed', () => {
    const a = generateSltSystem(opts(SLT_TUNING.hard), mulberry32(42))
    const b = generateSltSystem(opts(SLT_TUNING.hard), mulberry32(42))
    expect(a).toEqual(b)
  })
})

describe('sltDifficulty', () => {
  it('pins the keys a difficulty is allowed to change', () => {
    const allowed = new Set([
      'key', 'label', 'gameKey', 'bars', 'blurb',
      'tabCount', 'readMs', 'perQuestionMs', 'grades',
    ])
    for (const tuning of Object.values(SLT_TUNING)) {
      for (const k of Object.keys(tuning)) expect([k, allowed.has(k)]).toEqual([k, true])
    }
  })

  it('raises the grade bands on Easier, because both score out of the same total', () => {
    expect(SLT_TUNING.easier.grades.outstanding).toBeGreaterThan(SLT_TUNING.hard.grades.outstanding)
  })

  it('gives Easier fewer tabs and more time', () => {
    expect(SLT_TUNING.easier.tabCount).toBeLessThan(SLT_TUNING.hard.tabCount)
    expect(SLT_TUNING.easier.readMs).toBeGreaterThan(SLT_TUNING.hard.readMs)
    expect(SLT_TUNING.easier.perQuestionMs).toBeGreaterThan(SLT_TUNING.hard.perQuestionMs)
  })
})
