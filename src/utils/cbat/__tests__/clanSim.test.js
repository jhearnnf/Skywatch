import { describe, it, expect } from 'vitest'
import { createClanSim, CLAN_BANDS, blankClanStats } from '../clanSim'
import {
  generateLetterCode, buildLetterOptions, generateClanMath, buildMathSchedule,
  seededRng, CLAN_LETTER_POOL,
} from '../clanGenerator'
import {
  CLAN_TUNING, CLAN_DIFFICULTIES, CLAN_POINTS, CLAN_DURATION_MS, CLAN_COLOURS,
  clanTuning, computeClanGrade,
} from '../clanDifficulty'

// ── Generator ────────────────────────────────────────────────────────────────

describe('generateLetterCode', () => {
  it('draws distinct letters from the pool at the asked length', () => {
    const rng = seededRng(1)
    for (let i = 0; i < 200; i++) {
      const len = 4 + (i % 3)
      const code = generateLetterCode(len, rng)
      expect(code).toHaveLength(len)
      expect(new Set(code.split('')).size).toBe(len)
      for (const l of code) expect(CLAN_LETTER_POOL).toContain(l)
    }
  })

  it('never uses the letters that read as other glyphs', () => {
    for (const l of 'IOQ') expect(CLAN_LETTER_POOL).not.toContain(l)
  })
})

describe('buildLetterOptions', () => {
  it('offers four options that differ from the code in exactly one shared position', () => {
    const rng = seededRng(7)
    for (let i = 0; i < 300; i++) {
      const code = generateLetterCode(5, rng)
      const { options, correctIndex, position } = buildLetterOptions(code, rng)
      expect(options).toHaveLength(4)
      expect(options[correctIndex]).toBe(code)
      expect(new Set(options).size).toBe(4)
      for (const o of options) {
        if (o === code) continue
        const diffs = [...o].map((l, k) => l !== code[k]).filter(Boolean)
        expect(diffs).toHaveLength(1)
        expect(o[position]).not.toBe(code[position])
        // Not a rearrangement: the swapped-in letter is not elsewhere in the code.
        expect(code).not.toContain(o[position])
      }
    }
  })

  it('shuffles the correct option around rather than leaving it first', () => {
    const rng = seededRng(3)
    const seen = new Set()
    for (let i = 0; i < 100; i++) {
      seen.add(buildLetterOptions(generateLetterCode(4, rng), rng).correctIndex)
    }
    expect(seen.size).toBe(4)
  })
})

describe('generateClanMath', () => {
  it('always has a non-negative whole answer whose digit count is stated', () => {
    const rng = seededRng(11)
    for (const band of ['easy', 'medium', 'hard']) {
      for (let i = 0; i < 300; i++) {
        const q = generateClanMath(band, rng)
        expect(Number.isInteger(q.answer)).toBe(true)
        expect(q.answer).toBeGreaterThanOrEqual(0)
        expect(q.expectedDigits).toBe(String(q.answer).length)
        expect(q.question).toMatch(/^\d+ [+\-×÷] \d+$/)
      }
    }
  })

  it('keeps the easy band to single digits', () => {
    const rng = seededRng(5)
    for (let i = 0; i < 300; i++) {
      const q = generateClanMath('easy', rng)
      expect(q.answer).toBeLessThanOrEqual(20)
    }
  })
})

describe('buildMathSchedule', () => {
  it('delivers the asked count, sorted, inside the window', () => {
    const rng = seededRng(2)
    const s = buildMathSchedule(10, 3000, 83000, rng)
    expect(s).toHaveLength(10)
    expect(s[0]).toBeGreaterThanOrEqual(3000)
    expect(s[s.length - 1]).toBeLessThan(83000)
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1])
  })
})

// ── Tuning ───────────────────────────────────────────────────────────────────

describe('CLAN tuning', () => {
  it('pins the allowed key set so a difficulty cannot change something outside its scope', () => {
    const allowed = ['key', 'label', 'gameKey', 'bars', 'blurb', 'colours', 'letters', 'maths', 'grades'].sort()
    for (const t of CLAN_DIFFICULTIES) {
      expect(Object.keys(t).sort()).toEqual(allowed)
      expect(Object.keys(t.colours).sort()).toEqual(['crossMs', 'spawnJitterMs', 'spawnMs'])
      expect(Object.keys(t.letters).sort()).toEqual(['answerMs', 'firstMs', 'gapMs', 'holdMs', 'lengths', 'showMs'])
      expect(Object.keys(t.maths).sort()).toEqual(['count', 'firstMs', 'timeoutMs', 'weights'])
    }
  })

  it('is a FLAG-shaped split: Easier on -easier, Hard on the plain key, Easier first', () => {
    expect(CLAN_DIFFICULTIES.map(t => t.key)).toEqual(['easier', 'hard'])
    expect(CLAN_TUNING.easier.gameKey).toBe('clan-easier')
    expect(CLAN_TUNING.hard.gameKey).toBe('clan')
    expect(clanTuning('nonsense').key).toBe('easier')
  })

  it('makes Hard heavier on every axis and never serves a hard sum on Easier', () => {
    const e = CLAN_TUNING.easier, h = CLAN_TUNING.hard
    expect(h.colours.crossMs).toBeLessThan(e.colours.crossMs)
    expect(h.colours.spawnMs).toBeLessThan(e.colours.spawnMs)
    expect(Math.max(...h.letters.lengths)).toBeGreaterThan(Math.max(...e.letters.lengths))
    expect(h.letters.answerMs).toBeLessThan(e.letters.answerMs)
    expect(h.maths.count).toBeGreaterThan(e.maths.count)
    expect(h.maths.timeoutMs).toBeLessThan(e.maths.timeoutMs)
    expect(e.maths.weights.hard).toBe(0)
    expect(h.maths.weights.hard).toBeGreaterThan(0)
  })

  it('awards only multiples of 5', () => {
    for (const v of Object.values(CLAN_POINTS)) expect(Math.abs(v) % 5).toBe(0)
  })

  it('grades against each difficulty\'s own bands', () => {
    expect(computeClanGrade(450, CLAN_TUNING.hard)).toBe('Outstanding')
    expect(computeClanGrade(449, CLAN_TUNING.hard)).toBe('Good')
    expect(computeClanGrade(350, CLAN_TUNING.easier)).toBe('Outstanding')
    expect(computeClanGrade(-20, CLAN_TUNING.easier)).toBe('Failed')
  })
})

// ── Sim ──────────────────────────────────────────────────────────────────────

const sim = (difficulty = 'hard', seed = 1) => createClanSim({ tuning: clanTuning(difficulty), rng: seededRng(seed) })

// Advance in small steps so every phase boundary is crossed the way the rAF
// loop would cross it.
function runTo(s, ms, step = 50) {
  let t = s.snapshot().t
  while (t < ms) { t = Math.min(ms, t + step); s.tick(t) }
}

describe('createClanSim — colours', () => {
  it('launches diamonds that cross the arena left to right', () => {
    const s = sim()
    runTo(s, 1500)
    const d = s.snapshot().diamonds
    expect(d.length).toBeGreaterThan(0)
    expect(CLAN_COLOURS).toContain(d[0].colour)
    const before = d[0].x
    runTo(s, 2000)
    const after = s.snapshot().diamonds.find(x => x.id === d[0].id)
    expect(after.x).toBeGreaterThan(before)
  })

  it('scores a press inside the diamond\'s own band and charges a press with nothing there', () => {
    const s = sim()
    runTo(s, 1500)
    const d = s.snapshot().diamonds[0]
    // Nothing is in any band yet.
    expect(s.pressColour(d.colour)).toBe('wrong')
    expect(s.stats.colourWrong).toBe(1)
    expect(s.stats.totalScore).toBe(CLAN_POINTS.colourWrong)
    // Walk it into the middle of its band.
    const [lo, hi] = CLAN_BANDS[d.colour]
    const cross = CLAN_TUNING.hard.colours.crossMs
    const at = (s.snapshot().t - d.x * cross) + ((lo + hi) / 2) * cross
    runTo(s, at, 20)
    expect(s.pressColour(d.colour)).toBe('hit')
    expect(s.stats.colourHits).toBe(1)
    expect(s.stats.totalScore).toBe(CLAN_POINTS.colourWrong + CLAN_POINTS.colourHit)
    // It cannot be hit twice.
    const again = s.pressColour(d.colour)
    expect(again).toBe('wrong')
  })

  it('charges a diamond once when it leaves its band untouched, then drops it', () => {
    const s = sim()
    runTo(s, 1500)
    const d = s.snapshot().diamonds[0]
    const cross = CLAN_TUNING.hard.colours.crossMs
    const spawnedAt = s.snapshot().t - d.x * cross
    runTo(s, spawnedAt + cross * 1.2, 20)
    const stats = s.stats
    // Other diamonds launched meanwhile may also have been missed; this one
    // certainly was, and exactly once.
    expect(stats.colourMissed).toBeGreaterThanOrEqual(1)
    expect(s.snapshot().diamonds.find(x => x.id === d.id)).toBeUndefined()
    expect(stats.colourScore).toBe(stats.colourMissed * CLAN_POINTS.colourMissed + stats.colourHits * CLAN_POINTS.colourHit + stats.colourWrong * CLAN_POINTS.colourWrong)
  })

  it('ignores a key that is not a colour', () => {
    const s = sim()
    runTo(s, 1500)
    expect(s.pressColour('blue')).toBeNull()
    expect(s.stats.totalScore).toBe(0)
  })
})

describe('createClanSim — letters', () => {
  it('shows a code, blanks it, then offers four options and scores the pick', () => {
    const s = sim('hard', 4)
    const cfg = CLAN_TUNING.hard.letters
    runTo(s, cfg.firstMs + 100)
    let snap = s.snapshot()
    expect(snap.letters.phase).toBe('showing')
    const code = snap.letters.code
    expect(code.length).toBeGreaterThanOrEqual(5)
    expect(snap.letters.options).toEqual([])
    // Can't answer while the code is up.
    expect(s.pickLetterOption(0)).toBeNull()

    runTo(s, cfg.firstMs + cfg.showMs + 100)
    snap = s.snapshot()
    expect(snap.letters.phase).toBe('hold')
    expect(snap.letters.code).toBeNull()

    runTo(s, cfg.firstMs + cfg.showMs + cfg.holdMs + 100)
    snap = s.snapshot()
    expect(snap.letters.phase).toBe('asking')
    expect(snap.letters.options).toHaveLength(4)
    expect(snap.letters.options).toContain(code)

    const correct = snap.letters.options.indexOf(code)
    expect(s.pickLetterOption(correct)).toBe('correct')
    expect(s.stats.letterCorrect).toBe(1)
    expect(s.stats.letterScore).toBe(CLAN_POINTS.letterCorrect)
    expect(s.snapshot().letters.phase).toBe('gap')
    expect(s.snapshot().letters.feedback).toEqual({ correct: true, pickedIndex: correct })
  })

  it('charges a wrong pick and a timeout, and comes back with a new code', () => {
    const s = sim('hard', 9)
    const cfg = CLAN_TUNING.hard.letters
    const askAt = cfg.firstMs + cfg.showMs + cfg.holdMs + 100
    runTo(s, askAt)
    const snap = s.snapshot()
    const wrong = (snap.letters.options.indexOf(s._letters.code) + 1) % 4
    expect(s.pickLetterOption(wrong)).toBe('wrong')
    expect(s.stats.letterWrong).toBe(1)

    // Next cycle: let the options time out.
    const next = askAt + cfg.gapMs + cfg.showMs + cfg.holdMs + cfg.answerMs + 200
    runTo(s, next)
    expect(s.stats.letterTimeout).toBe(1)
    expect(s.stats.letterScore).toBe(CLAN_POINTS.letterWrong + CLAN_POINTS.letterTimeout)
  })

  it('keeps Easier codes to four letters', () => {
    const s = sim('easier', 2)
    runTo(s, CLAN_TUNING.easier.letters.firstMs + 100)
    expect(s.snapshot().letters.code).toHaveLength(4)
  })
})

describe('createClanSim — numbers', () => {
  it('asks a sum on schedule, submits on the last expected digit, and scores it', () => {
    const s = sim('hard', 6)
    runTo(s, s._maths.schedule[0] + 100)
    const snap = s.snapshot()
    expect(snap.maths.phase).toBe('asking')
    expect(snap.maths.question).toBeTruthy()
    const answer = String(s._maths.question.answer)
    for (const d of answer) s.pressDigit(d)
    expect(s.stats.mathCorrect).toBe(1)
    expect(s.stats.mathScore).toBe(CLAN_POINTS.mathCorrect)
    expect(s.snapshot().maths.phase).toBe('gap')
    expect(s.snapshot().maths.feedback).toEqual({ correct: true })
  })

  it('takes Enter for a shorter answer, backspace to correct, and charges a wrong one', () => {
    const s = sim('hard', 6)
    runTo(s, s._maths.schedule[0] + 100)
    const answer = s._maths.question.answer
    // Type something wrong but shorter than the expected digit count so it
    // does not auto-submit, fix it with backspace, then get it wrong on Enter.
    const digits = String(answer).length
    if (digits > 1) {
      s.pressDigit('9')
      expect(s.snapshot().maths.entered).toBe('9')
      s.backspace()
      expect(s.snapshot().maths.entered).toBe('')
    }
    // Enter with nothing typed does nothing.
    expect(s.submitMath()).toBeNull()
    const wrong = String((answer + 1) % 10)
    if (digits === 1) {
      // A single-digit sum submits on the first key.
      expect(s.pressDigit(wrong)).toBe('wrong')
    } else {
      s.pressDigit(wrong)
      expect(s.submitMath()).toBe('wrong')
    }
    expect(s.stats.mathWrong).toBe(1)
    expect(s.stats.mathScore).toBe(CLAN_POINTS.mathWrong)
  })

  it('times a sum out and charges it', () => {
    const s = sim('hard', 6)
    const askAt = s._maths.schedule[0]
    runTo(s, askAt + CLAN_TUNING.hard.maths.timeoutMs + 200)
    expect(s.stats.mathTimeout).toBe(1)
    expect(s.snapshot().maths.question).toBeNull()
  })

  it('serves the count the tuning promises over a full run, on both difficulties', () => {
    for (const key of ['easier', 'hard']) {
      const s = sim(key, 3)
      runTo(s, CLAN_DURATION_MS + 100, 100)
      const st = s.stats
      const served = st.mathCorrect + st.mathWrong + st.mathTimeout
      // Every sum was let time out, so every one served is a timeout, and the
      // whole schedule fits inside the clock.
      expect(served).toBe(CLAN_TUNING[key].maths.count)
    }
  })
})

describe('createClanSim — clock', () => {
  it('runs for exactly the duration and then stops taking input', () => {
    const s = sim()
    runTo(s, CLAN_DURATION_MS + 5000, 100)
    const snap = s.snapshot()
    expect(snap.finished).toBe(true)
    expect(snap.t).toBe(CLAN_DURATION_MS)
    expect(snap.remainingMs).toBe(0)
    const before = s.stats.totalScore
    expect(s.pressColour('red')).toBeNull()
    expect(s.pickLetterOption(0)).toBeNull()
    expect(s.pressDigit('1')).toBeNull()
    expect(s.stats.totalScore).toBe(before)
  })

  it('reproduces a run from a seed', () => {
    const a = sim('hard', 42), b = sim('hard', 42)
    runTo(a, 30000, 100); runTo(b, 30000, 100)
    expect(a.snapshot()).toEqual(b.snapshot())
  })

  it('keeps every total a multiple of 5 and the parts summing to the whole', () => {
    const s = sim('hard', 8)
    runTo(s, 20000, 50)
    // A few presses of everything.
    s.pressColour('red'); s.pressColour('green')
    runTo(s, 40000, 50)
    const st = s.stats
    expect(Math.abs(st.totalScore) % 5).toBe(0)
    expect(st.colourScore + st.letterScore + st.mathScore).toBe(st.totalScore)
    expect(Object.keys(st).sort()).toEqual(Object.keys(blankClanStats()).sort())
  })
})
