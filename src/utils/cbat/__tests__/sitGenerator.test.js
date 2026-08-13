import { describe, it, expect } from 'vitest'
import {
  generateSitRound, generateSitRounds, rotateCell, rotateHeading,
  sitRoundPlan, GRID, OBJECT_CLASSES,
} from '../sitGenerator'
import {
  SIT_TUNING, SIT_ROUNDS, SIT_CLIPS, SIT_QUESTIONS_PER_CLIP,
  sitPhaseMs, sitRunEstimateMs,
} from '../sitDifficulty'
import { CBAT_GAMES } from '../../../data/cbatGames'

// Seeded rng so a failure is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const QPC = SIT_QUESTIONS_PER_CLIP
const HARD = { classes: SIT_TUNING.hard.classPool, rotations: SIT_TUNING.hard.rotations, questionsPerClip: QPC }
const EASIER = { classes: SIT_TUNING.easier.classPool, rotations: SIT_TUNING.easier.rotations, questionsPerClip: QPC }

// The scene the layers add up to — which nothing but the clip ever shows.
const sceneOf = (round) => {
  const seen = new Map()
  for (const layer of round.layers) for (const o of layer.objects) seen.set(o.id, o)
  return [...seen.values()]
}

describe('rotateCell', () => {
  it('returns to the start after four quarter turns', () => {
    for (let c = 0; c < GRID; c++) {
      for (let r = 0; r < GRID; r++) {
        expect(rotateCell(c, r, 360)).toEqual({ col: c, row: r })
      }
    }
  })

  it('is a bijection — no two cells collide at any rotation', () => {
    for (const deg of [90, 180, 270]) {
      const seen = new Set()
      for (let c = 0; c < GRID; c++) {
        for (let r = 0; r < GRID; r++) {
          const { col, row } = rotateCell(c, r, deg)
          expect(col).toBeGreaterThanOrEqual(0)
          expect(col).toBeLessThan(GRID)
          expect(row).toBeGreaterThanOrEqual(0)
          expect(row).toBeLessThan(GRID)
          seen.add(`${col},${row}`)
        }
      }
      expect(seen.size).toBe(GRID * GRID)
    }
  })

  it('turns a heading with the map', () => {
    expect(rotateHeading('N', 90)).toBe('E')
    expect(rotateHeading('N', 180)).toBe('S')
    expect(rotateHeading('W', 90)).toBe('N')
    expect(rotateHeading('S', 360)).toBe('S')
  })
})

describe('the study layers', () => {
  it('gives every class its own layer and puts nothing else on it', () => {
    // "Each showing one isolated layer of the same landscape ... no tab shows
    // the full picture." THE load-bearing property: a layer holding two classes
    // would hand the player part of the integration for free, and a study phase
    // holding all of them at once — which is what this generator used to do —
    // makes the whole thing a memory test instead.
    for (let seed = 0; seed < 200; seed++) {
      const round = generateSitRound(HARD, mulberry32(seed))
      expect([seed, round.layers.length]).toEqual([seed, HARD.classes.length])
      for (const layer of round.layers) {
        const classes = new Set(layer.objects.map(o => o.cls))
        classes.delete('hill')
        expect([seed, layer.cls, [...classes]]).toEqual([seed, layer.cls, [layer.cls]])
      }
    }
  })

  it('puts the hills on every layer, since they are the only way to line two up', () => {
    for (let seed = 0; seed < 100; seed++) {
      const round = generateSitRound(HARD, mulberry32(seed))
      const hillIds = round.layers[0].objects.filter(o => o.cls === 'hill').map(o => o.id).sort()
      expect(hillIds.length).toBeGreaterThan(0)
      for (const layer of round.layers) {
        const ids = layer.objects.filter(o => o.cls === 'hill').map(o => o.id).sort()
        expect([seed, layer.cls, ids]).toEqual([seed, layer.cls, hillIds])
      }
      // And they are in the same place on each, or they would be useless.
      for (const layer of round.layers) {
        for (const hill of layer.objects.filter(o => o.cls === 'hill')) {
          const first = round.layers[0].objects.find(o => o.id === hill.id)
          expect([hill.id, hill.col, hill.row]).toEqual([hill.id, first.col, first.row])
        }
      }
    }
  })

  it('shows in the clip everything the layers between them held', () => {
    for (let seed = 0; seed < 100; seed++) {
      const round = generateSitRound(HARD, mulberry32(seed))
      const sceneIds = sceneOf(round).map(o => o.id).sort()
      expect([seed, round.clip.map(o => o.id).sort()]).toEqual([seed, sceneIds])
    }
  })
})

describe('generateSitRound', () => {
  it('never places two objects on the same cell in the assembled scene', () => {
    for (let seed = 0; seed < 200; seed++) {
      const round = generateSitRound(HARD, mulberry32(seed))
      const cells = sceneOf(round).map(o => `${o.col},${o.row}`)
      expect(new Set(cells).size).toBe(cells.length)
    }
  })

  it('never leaves two objects stacked in the clip after corruption', () => {
    // A corrupted object moved onto an occupied cell would read as a second
    // error in a class nobody asked about, and would make an honest "yes" look
    // wrong.
    for (let seed = 0; seed < 200; seed++) {
      const round = generateSitRound(HARD, mulberry32(seed))
      const cells = round.clip.map(o => `${o.col},${o.row}`)
      expect(new Set(cells).size).toBe(cells.length)
    }
  })

  it('never moves a hill — they are the fixed reference terrain', () => {
    for (let seed = 0; seed < 200; seed++) {
      const round = generateSitRound(HARD, mulberry32(seed))
      for (const hill of round.layers[0].objects.filter(o => o.cls === 'hill')) {
        const expected = rotateCell(hill.col, hill.row, round.rotation)
        const inClip = round.clip.find(o => o.id === hill.id)
        expect([seed, inClip.col, inClip.row]).toEqual([seed, expected.col, expected.row])
      }
    }
  })

  it('asks several questions off one clip, each about a different class', () => {
    // "About 50 seconds of true/false questions on it, with no replay" — plural,
    // off a single viewing. One question per clip lets a player watch for one
    // thing and ignore the rest of the frame, which is the habit this punishes.
    for (let seed = 0; seed < 200; seed++) {
      const round = generateSitRound(HARD, mulberry32(seed))
      expect([seed, round.questions.length]).toEqual([seed, QPC])
      const asked = round.questions.map(q => q.askedClass)
      expect([seed, new Set(asked).size]).toEqual([seed, asked.length])
    }
  })

  it('makes each asked class wrong exactly when its answer is "no"', () => {
    for (let seed = 0; seed < 300; seed++) {
      const round = generateSitRound(HARD, mulberry32(seed))
      const scene = sceneOf(round)
      for (const q of round.questions) {
        const misplaced = round.clip.some(o => {
          if (o.cls !== q.askedClass) return false
          const source = scene.find(s => s.id === o.id)
          const expected = rotateCell(source.col, source.row, round.rotation)
          return o.col !== expected.col || o.row !== expected.row
        })
        expect([seed, q.askedClass, misplaced]).toEqual([seed, q.askedClass, !q.answer])
      }
    }
  })

  it('always corrupts a class NOBODY is asked about', () => {
    // This is the whole test. If a clip could be entirely correct in everything
    // unasked, then scanning the whole frame would be a valid strategy, and the
    // corpus's "only the detail being asked about has to be right" would stop
    // being the winning play here.
    for (const opts of [HARD, EASIER]) {
      for (let seed = 0; seed < 300; seed++) {
        const round = generateSitRound(opts, mulberry32(seed))
        const asked = round.questions.map(q => q.askedClass)
        const unasked = round.corruptedClasses.filter(c => !asked.includes(c))
        expect([seed, unasked.length]).toEqual([seed, 1])
      }
    }
  })

  it('keeps `truth` as the uncorrupted clip, for the review screen', () => {
    for (let seed = 0; seed < 100; seed++) {
      const round = generateSitRound(HARD, mulberry32(seed))
      const scene = sceneOf(round)
      for (const o of round.truth) {
        const source = scene.find(s => s.id === o.id)
        const expected = rotateCell(source.col, source.row, round.rotation)
        expect([o.id, o.col, o.row]).toEqual([o.id, expected.col, expected.row])
      }
    }
  })

  it('only ever rotates by an amount the difficulty allows', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(SIT_TUNING.easier.rotations).toContain(generateSitRound(EASIER, mulberry32(seed)).rotation)
      expect(SIT_TUNING.hard.rotations).toContain(generateSitRound(HARD, mulberry32(seed)).rotation)
    }
  })

  it('is deterministic for a given seed', () => {
    const a = generateSitRound(HARD, mulberry32(7))
    const b = generateSitRound(HARD, mulberry32(7))
    expect(a).toEqual(b)
  })
})

describe('sitRoundPlan', () => {
  it('unlocks a layer per clip and never exceeds the pool', () => {
    const pool = SIT_TUNING.hard.classPool
    const counts = Array.from({ length: SIT_CLIPS }, (_, i) =>
      sitRoundPlan(i, { classPool: pool, rotations: [90], questionsPerClip: QPC }).classes.length)
    expect(Math.max(...counts)).toBeLessThanOrEqual(pool.length)
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
  })

  it('always leaves one more class than there are questions, so a distractor is possible', () => {
    // The floor that protects the distractor rule: with every class asked about
    // there would be nothing left to corrupt.
    for (const tuning of [SIT_TUNING.easier, SIT_TUNING.hard]) {
      for (let i = 0; i < SIT_CLIPS; i++) {
        const plan = sitRoundPlan(i, {
          classPool: tuning.classPool,
          rotations: tuning.rotations,
          questionsPerClip: QPC,
        })
        expect([tuning.key, i, plan.classes.length >= QPC + 1]).toEqual([tuning.key, i, true])
      }
    }
  })

  it('only draws from the known object classes', () => {
    for (const tuning of [SIT_TUNING.easier, SIT_TUNING.hard]) {
      for (const cls of tuning.classPool) expect(OBJECT_CLASSES).toContain(cls)
    }
  })

  it('names the things the corpus names', () => {
    // "Farm position, truck, troops, trees, aircraft flight paths ...
    // helicopter paths." These were masts, lakes and woods until the guide was
    // read back against them.
    expect(OBJECT_CLASSES).toEqual(['farm', 'truck', 'troops', 'trees', 'aircraft', 'helicopter'])
  })
})

describe('generateSitRounds', () => {
  it('produces exactly the requested number of clips, carrying every question', () => {
    const rounds = generateSitRounds({
      roundCount: SIT_CLIPS,
      classPool: SIT_TUNING.hard.classPool,
      rotations: SIT_TUNING.hard.rotations,
      questionsPerClip: QPC,
    }, mulberry32(3))
    expect(rounds).toHaveLength(SIT_CLIPS)
    expect(rounds.reduce((n, r) => n + r.questions.length, 0)).toBe(SIT_ROUNDS)
  })

  it('gives both difficulties the same length, so the boards share a ceiling', () => {
    // The Easier board's maxScore in src/data/cbatGames.js is 8 for both keys.
    // If a difficulty ever shortened the run, that entry would start lying.
    expect(SIT_ROUNDS).toBe(SIT_CLIPS * SIT_QUESTIONS_PER_CLIP)
    expect(SIT_TUNING.easier.grades.outstanding).toBeLessThanOrEqual(SIT_ROUNDS)
    expect(SIT_TUNING.hard.grades.outstanding).toBeLessThanOrEqual(SIT_ROUNDS)
  })
})

describe('how long a run takes', () => {
  it('counts studying and the clips, not just the answering', () => {
    // The bug this pins: the page submitted only the answering time and the hub
    // tile's estimate was built on the same figure. On this game the answering
    // is the SHORT phase — studying the layers is most of a run — so a run was
    // reporting about a third of its real length.
    for (const tuning of Object.values(SIT_TUNING)) {
      const p = sitPhaseMs(tuning)
      expect([tuning.key, p.study > 0, p.clips > 0, p.answers > 0])
        .toEqual([tuning.key, true, true, true])
      expect([tuning.key, sitRunEstimateMs(tuning)])
        .toEqual([tuning.key, p.study + p.clips + p.answers])
      // Studying really is the biggest slice, which is why leaving it out
      // mattered.
      expect([tuning.key, p.study > p.answers]).toEqual([tuning.key, true])
    }
  })

  it('grows the study window as the clips unlock more layers', () => {
    // Summed off sitRoundPlan rather than assumed flat. A flat sum would be
    // wrong by the whole ramp, and wrong in the direction that understates.
    const flat = SIT_TUNING.hard.studyMsPerLayer * SIT_CLIPS * (SIT_QUESTIONS_PER_CLIP + 1)
    expect(sitPhaseMs(SIT_TUNING.hard).study).toBeGreaterThan(flat)
  })

  it('matches the arithmetic, to the second', () => {
    // Stated outright so a tuning change has to be a deliberate one.
    expect(sitPhaseMs(SIT_TUNING.easier)).toEqual({ study: 210000, clips: 16000, answers: 160000 })
    expect(sitPhaseMs(SIT_TUNING.hard)).toEqual({ study: 180000, clips: 10000, answers: 120000 })
  })

  it('is what the hub tile advertises', () => {
    // The tile is how a player picks a game that fits the time they have, so it
    // has to cover a real run of the whole test. It read [3, 5] while a
    // full-clock run on the FASTER difficulty already took 5.2 minutes.
    const tile = CBAT_GAMES.find(g => g.key === 'sit')
    const [lo, hi] = tile.estMinutes

    // The top of the range has to cover a full-clock run on at least one
    // difficulty, or the tile is promising something it cannot deliver.
    expect(hi * 60000).toBeGreaterThanOrEqual(sitRunEstimateMs(SIT_TUNING.hard))

    // And the bottom has to cover studying and watching on the quicker
    // difficulty — the part you cannot answer your way out of.
    const quick = sitPhaseMs(SIT_TUNING.hard)
    expect(lo * 60000).toBeGreaterThanOrEqual(quick.study + quick.clips)
  })
})

describe('sitDifficulty', () => {
  it('pins the keys a difficulty is allowed to change', () => {
    // Stops a difficulty quietly starting to change something outside its
    // stated scope — the same guard FLAG's and CUT's tuning tables carry.
    const allowed = new Set([
      'key', 'label', 'gameKey', 'bars', 'blurb',
      'classPool', 'rotations', 'studyMsPerLayer', 'clipMs', 'answerMs', 'grades',
    ])
    for (const tuning of Object.values(SIT_TUNING)) {
      for (const k of Object.keys(tuning)) expect([k, allowed.has(k)]).toEqual([k, true])
    }
  })

  it('raises the grade bands on Easier, because both score out of the same total', () => {
    expect(SIT_TUNING.easier.grades.outstanding).toBeGreaterThan(SIT_TUNING.hard.grades.outstanding)
    expect(SIT_TUNING.easier.grades.good).toBeGreaterThan(SIT_TUNING.hard.grades.good)
  })

  it('gives Easier longer on each layer and longer to look at the clip', () => {
    expect(SIT_TUNING.easier.studyMsPerLayer).toBeGreaterThan(SIT_TUNING.hard.studyMsPerLayer)
    expect(SIT_TUNING.easier.clipMs).toBeGreaterThan(SIT_TUNING.hard.clipMs)
  })

  it('keeps the layer study phase on BOTH difficulties', () => {
    // Easier lowers the load inside a clip. It must not quietly collapse the
    // layers into one map, which would make it a different test rather than an
    // easier one.
    for (const tuning of Object.values(SIT_TUNING)) {
      const round = generateSitRound({
        classes: tuning.classPool,
        rotations: tuning.rotations,
        questionsPerClip: QPC,
      }, mulberry32(2))
      expect([tuning.key, round.layers.length]).toEqual([tuning.key, tuning.classPool.length])
    }
  })
})
