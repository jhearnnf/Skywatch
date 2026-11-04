import { describe, it, expect } from 'vitest'
import {
  generateJourneyQuestion,
  generateLandmarkQuestion,
  generateCombinedQuestion,
  buildRealDadQuestions,
} from '../dadRealGenerator'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── An independent solver: works every question out from its WORDING alone ──
// Real-plane vectors (diagonals are unit-length), so it shares none of the
// generator's frame/lattice maths. If the generator and this disagree, the
// question as printed is wrong.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const WORD = { north: 0, 'north-east': 1, east: 2, 'south-east': 3, south: 4, 'south-west': 5, west: 6, 'north-west': 7 }
const unitVec = (i) => {
  const ang = (i * Math.PI) / 4 // clockwise from north
  return [Math.sin(ang), Math.cos(ang)] // [east, north]
}
const DIR_RE = '(north-east|north-west|south-east|south-west|north|south|east|west)'
const PLACE_RE = '([A-Z][\\w ]*?)'

function solve(q) {
  const pos = {}
  // Landmark statements: "X is D unit dir of Y."
  const stmtRe = new RegExp(`${PLACE_RE} is (\\d+) (?:miles|km|metres) ${DIR_RE} of ([\\w ]+?)\\.`, 'gi')
  const stmts = [...q.prose.matchAll(stmtRe)].map(m => ({ x: norm(m[1]), d: +m[2], dir: WORD[m[3].toLowerCase()], y: norm(m[4]) }))
  if (stmts.length) {
    pos[stmts[0].y] = [0, 0]
    // Repeat until every place is placed (statements may come in any order).
    for (let pass = 0; pass < stmts.length + 1; pass++) {
      for (const s of stmts) {
        const v = unitVec(s.dir)
        if (pos[s.y] && !pos[s.x]) pos[s.x] = [pos[s.y][0] + v[0] * s.d, pos[s.y][1] + v[1] * s.d]
        else if (pos[s.x] && !pos[s.y]) pos[s.y] = [pos[s.x][0] - v[0] * s.d, pos[s.x][1] - v[1] * s.d]
      }
    }
  }
  // Journey: "<Who> leaves <FROM> and <verb> <dir> for D unit, ..."
  const jm = q.prose.match(new RegExp(`(?:^|\\. )([A-Z][\\w ]*?) leaves ([\\w ]+?) and \\w+ ${DIR_RE} for (\\d+) (?:miles|km|metres)(.*)$`, 'i'))
  let traveller = null
  if (jm) {
    const from = norm(jm[2])
    if (!pos[from]) pos[from] = [0, 0]
    let facing = WORD[jm[3].toLowerCase()]
    let p = [pos[from][0] + unitVec(facing)[0] * +jm[4], pos[from][1] + unitVec(facing)[1] * +jm[4]]
    for (const part of jm[5].split(',').map(s => s.trim()).filter(Boolean)) {
      let m
      if ((m = part.match(/turns (left|right) and travels (\d+)/))) {
        facing = (facing + (m[1] === 'right' ? 2 : 6)) % 8
        p = [p[0] + unitVec(facing)[0] * +m[2], p[1] + unitVec(facing)[1] * +m[2]]
      } else if ((m = part.match(new RegExp(`(\\d+) (?:miles|km|metres) ${DIR_RE}`, 'i')))) {
        facing = WORD[m[2].toLowerCase()]
        p = [p[0] + unitVec(facing)[0] * +m[1], p[1] + unitVec(facing)[1] * +m[1]]
      } else throw new Error(`unparsed leg: ${part}`)
    }
    traveller = p
  }
  return { pos, traveller }
}
const norm = (s) => s.trim().toLowerCase().replace(/^the /, '').replace(/ island$/, '').replace(/^mount /, '')

function compassOf([e, n]) {
  const ang = (Math.atan2(e, n) * 180) / Math.PI
  const idx = ((ang / 45) % 8 + 8) % 8
  expect(Math.abs(idx - Math.round(idx))).toBeLessThan(1e-6) // must be a clean 8-point direction
  return COMPASS[Math.round(idx) % 8]
}
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])

// Checks the printed answer against the solver.
function verify(q) {
  expect(q.options).toHaveLength(4)
  expect(new Set(q.options).size).toBe(4)
  expect(q.options).toContain(q.answer)
  expect(q.prose).not.toMatch(/°/) // no bearings / degree turns in the real set
  expect(q.prose).not.toMatch(/—/) // no em dashes on screen

  const { pos, traveller } = solve(q)
  const qm = q.question
  let m
  if ((m = qm.match(/^In which direction is (.+) from (.+)\?$/))) {
    const x = traveller && /^the (ship|aircraft|convoy|vessel|boat|walker|courier)$/.test(m[1]) ? traveller : pos[norm(m[1])]
    const y = pos[norm(m[2])] ?? [0, 0] // journey origin is the origin
    expect(compassOf([x[0] - y[0], x[1] - y[1]])).toBe(q.answer)
  } else if ((m = qm.match(/^How far is (.+) from (.+)\?$/))) {
    const x = traveller && /^the (ship|aircraft|convoy|vessel|boat|walker|courier)$/.test(m[1]) ? traveller : pos[norm(m[1])]
    const y = pos[norm(m[2])] ?? [0, 0]
    const d = dist(x, y)
    expect(Math.abs(d - Math.round(d))).toBeLessThan(1e-6) // straight line, no square roots
    expect(q.answer).toBe(`${Math.round(d)} ${q.answer.split(' ').slice(1).join(' ')}`)
    // the four options are consecutive steps
    const nums = q.options.map(o => parseInt(o, 10))
    const step = nums[1] - nums[0]
    expect(step).toBeGreaterThan(0)
    nums.forEach((n, i) => expect(n).toBe(nums[0] + i * step))
  } else if ((m = qm.match(/^Which two \w+ are (closest together|furthest apart)\?$/))) {
    const names = Object.keys(pos)
    const pairs = []
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) pairs.push([names[i], names[j], dist(pos[names[i]], pos[names[j]])])
    pairs.sort((a, b) => (m[1].startsWith('closest') ? a[2] - b[2] : b[2] - a[2]))
    const [best, next] = pairs
    // clear winner (squared margin 1.5×)
    if (m[1].startsWith('closest')) expect(best[2] ** 2 * 1.5).toBeLessThanOrEqual(next[2] ** 2 + 1e-6)
    else expect(best[2] ** 2).toBeGreaterThanOrEqual(next[2] ** 2 * 1.5 - 1e-6)
    const ans = q.answer.toLowerCase().split(' and ')
    expect(ans.sort()).toEqual([best[0], best[1]].sort())
  } else if ((m = qm.match(/^Which \w+ is the \w+ now closest to\?$/))) {
    const ranked = Object.entries(pos).map(([n, p]) => [n, dist(p, traveller)]).sort((a, b) => a[1] - b[1])
    expect(ranked[0][1] ** 2 * 1.5).toBeLessThanOrEqual(ranked[1][1] ** 2 + 1e-6)
    expect(q.answer.toLowerCase()).toBe(ranked[0][0])
  } else {
    throw new Error(`unknown question: ${qm}`)
  }
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1)

describe('generateJourneyQuestion', () => {
  it('every journey solves to its printed answer, both wordings, both asks', () => {
    for (const seed of SEEDS) {
      for (const ask of ['direction', 'distance']) {
        for (const wording of ['headings', 'turns']) {
          verify(generateJourneyQuestion(3 + (seed % 4), mulberry32(seed), { ask, wording }))
        }
      }
    }
  })

  it('every leg is at a right angle to the one before', () => {
    for (const seed of SEEDS) {
      const q = generateJourneyQuestion(6, mulberry32(seed))
      for (let i = 1; i < q.legs.length; i++) {
        const turn = (q.legs[i].dir - q.legs[i - 1].dir + 8) % 8
        expect([2, 6]).toContain(turn)
      }
    }
  })

  it('uses tilted rectangles (NW/SE legs) as well as N/E/S/W ones', () => {
    const frames = new Set(SEEDS.map(s => generateJourneyQuestion(4, mulberry32(s)).frame))
    expect(frames).toEqual(new Set([0, 1]))
  })

  it('puts the right distance at every option position across seeds', () => {
    const positions = new Set(SEEDS.map(s => {
      const q = generateJourneyQuestion(4, mulberry32(s), { ask: 'distance' })
      return q.options.indexOf(q.answer)
    }))
    expect(positions).toEqual(new Set([0, 1, 2, 3]))
  })
})

describe('generateLandmarkQuestion', () => {
  for (const ask of ['direction', 'distance', 'closest', 'furthest']) {
    it(`${ask}: solves to its printed answer for 4 and 5 landmarks`, () => {
      for (const seed of SEEDS) {
        verify(generateLandmarkQuestion(4, ask, mulberry32(seed)))
        verify(generateLandmarkQuestion(5, ask, mulberry32(seed + 1000)))
      }
    })
  }

  it('never asks about a pair the text states directly', () => {
    for (const seed of SEEDS) {
      for (const ask of ['direction', 'distance']) {
        const q = generateLandmarkQuestion(5, ask, mulberry32(seed))
        const [x, y] = q.pair
        expect(Math.abs(x - y)).toBeGreaterThan(1) // chain neighbours are the stated links
      }
    }
  })

  it('uses look-alike names from one group', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const q = generateLandmarkQuestion(5, 'direction', mulberry32(seed))
      expect(new Set(q.names.map(n => n[0])).size).toBe(1)
    }
  })
})

describe('generateCombinedQuestion', () => {
  for (const ask of ['nearest', 'direction', 'distance']) {
    it(`${ask}: a journey from a landmark solves to its printed answer`, () => {
      for (const seed of SEEDS) {
        verify(generateCombinedQuestion(4, 3, ask, mulberry32(seed)))
        verify(generateCombinedQuestion(5, 2, ask, mulberry32(seed + 1000)))
      }
    })
  }
})

describe('buildRealDadQuestions', () => {
  it('builds 15 valid questions with every kind in the mix', () => {
    const kinds = new Set()
    for (const seed of SEEDS.slice(0, 100)) {
      const qs = buildRealDadQuestions(mulberry32(seed))
      expect(qs).toHaveLength(15)
      qs.forEach(q => { verify(q); kinds.add(`${q.kind}:${q.ask}`) })
      // opens on journeys, ends on the combined stage
      qs.slice(0, 3).forEach(q => expect(q.kind).toBe('journey'))
      expect(qs.slice(11).filter(q => q.kind === 'combined')).toHaveLength(3)
    }
    for (const k of ['journey:direction', 'journey:distance', 'landmarks:direction', 'landmarks:distance',
      'landmarks:closest', 'landmarks:furthest', 'combined:nearest', 'combined:direction', 'combined:distance']) {
      expect(kinds).toContain(k)
    }
  })

  it('is deterministic for a seed', () => {
    expect(buildRealDadQuestions(mulberry32(7))).toEqual(buildRealDadQuestions(mulberry32(7)))
  })
})
