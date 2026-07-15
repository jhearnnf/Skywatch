import { describe, it, expect } from 'vitest'
import { generateTrace2Game, TRACE2_ROUNDS, TRACE2_COLORS } from '../trace2Generator'

// Small deterministic PRNG so failures are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COLORS = TRACE2_COLORS.map(c => c.key)

// Re-derive the truth for a question from the round's own stats, then confirm
// the flagged-correct option matches. This checks the generator labelled the
// answer correctly, independently of how it was generated.
function correctColorsFor(round) {
  const s = round.stats
  const by = k => s.find(x => x.colorKey === k)
  const maxBy = f => s.reduce((m, x) => x[f] > m[f] ? x : m).colorKey
  const minBy = f => s.reduce((m, x) => x[f] < m[f] ? x : m).colorKey
  const q = round.question
  switch (q.id) {
    case 'most-turns':     return [maxBy('turns')]
    case 'fewest-turns':   return [minBy('turns')]
    case 'climbed-highest':return [maxBy('climbGain')]
    case 'did-not-climb':  return [s.filter(x => !x.climbed).map(x => x.colorKey)].flat()
    case 'upside-down-longest': return [maxBy('invertedMs')]
    case 'only-right-turns':    return [s.filter(x => x.turns >= 2 && x.leftTurns === 0).map(x => x.colorKey)].flat()
    default: return null // relational / order — validated structurally below
  }
}

describe('trace2Generator', () => {
  it('produces 8 rounds with a 4-easy / 4-hard tier split', () => {
    const { rounds } = generateTrace2Game(mulberry32(1))
    expect(rounds).toHaveLength(TRACE2_ROUNDS)
    rounds.forEach((r, i) => expect(r.tier).toBe(i < 4 ? 'easy' : 'hard'))
  })

  it('never repeats a question type within a tier', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { rounds } = generateTrace2Game(mulberry32(seed))
      const easy = rounds.slice(0, 4).map(r => r.question.id)
      const hard = rounds.slice(4).map(r => r.question.id)
      expect(new Set(easy).size).toBe(easy.length)
      expect(new Set(hard).size).toBe(hard.length)
    }
  })

  it('every round has 4 aircraft, well-formed options and exactly one correct', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { rounds } = generateTrace2Game(mulberry32(seed))
      for (const r of rounds) {
        expect(r.aircraft).toHaveLength(4)
        expect(r.aircraft.map(a => a.colorKey).sort()).toEqual([...COLORS].sort())
        expect(r.question.options.length).toBeGreaterThanOrEqual(2)
        const correct = r.question.options.filter(o => o.correct)
        expect(correct).toHaveLength(1)
        expect(r.question.options[r.question.correctIndex].correct).toBe(true)
        // Each option references real colours.
        for (const o of r.question.options) {
          for (const c of o.colors) expect(COLORS).toContain(c)
        }
        expect(r.durationMs).toBeGreaterThan(0)
      }
    }
  })

  it('the flagged answer matches the truth re-derived from round stats', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { rounds } = generateTrace2Game(mulberry32(seed))
      for (const r of rounds) {
        if (!r.stats.length) continue
        const truth = correctColorsFor(r)
        if (!truth) continue
        const flagged = r.question.options[r.question.correctIndex].colors
        // Single-answer superlatives: flagged colour must be in the truth set.
        expect(truth).toContain(flagged[0])
      }
    }
  })

  it('pair questions flag a genuine pair (two distinct colours)', () => {
    const pairIds = new Set(['facing-each-other', 'same-direction', 'exited-same-side'])
    for (let seed = 1; seed <= 40; seed++) {
      const { rounds } = generateTrace2Game(mulberry32(seed))
      for (const r of rounds) {
        if (!pairIds.has(r.question.id)) continue
        const ans = r.question.options[r.question.correctIndex].colors
        expect(ans).toHaveLength(2)
        expect(ans[0]).not.toBe(ans[1])
      }
    }
  })

  it('aircraft specs are well-formed Trace 1-style flight (quat + start + ordered turns)', () => {
    const validKeys = new Set(['yawL', 'yawR', 'pitchU', 'pitchD'])
    const { rounds } = generateTrace2Game(mulberry32(7))
    for (const r of rounds) {
      for (const a of r.aircraft) {
        expect(a.initialQuat).toHaveLength(4)
        expect(a.startPos).toHaveLength(3)
        expect(a.speed).toBeGreaterThan(0)
        expect(Array.isArray(a.turns)).toBe(true)
        for (let i = 1; i < a.turns.length; i++) {
          expect(a.turns[i].tMs).toBeGreaterThanOrEqual(a.turns[i - 1].tMs)
        }
        for (const t of a.turns) expect(validKeys).toContain(t.turnKey)
      }
    }
  })
})
