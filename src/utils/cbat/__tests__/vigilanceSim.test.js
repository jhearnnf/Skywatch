import { describe, it, expect } from 'vitest'
import {
  createVigilanceSim, VIGILANCE_GRID, VIGILANCE_DURATION_MS, VIGILANCE_BASE_LOAD,
  STAR_POINTS, PRIORITY_BASE_POINTS, PRIORITY_BONUS_POINTS, MISKEY_PENALTY,
} from '../vigilanceSim'
import { VIGILANCE_TUNING, EASIER_POINTS_MULTIPLIER } from '../vigilanceDifficulty'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Step in 100 ms slices, the way the rAF loop does.
function run(sim, ms) {
  for (let t = 0; t < ms; t += 100) sim.step(100)
}

describe('createVigilanceSim', () => {
  // Both of these come straight from the guide corpus — "A 9×9 grid ... row
  // number first, then column, so a star at 2,7 is entered as those two digits"
  // — and both were wrong here until the guide was read back against the game.
  // The order is the only transferable habit this test trains, so it is pinned
  // rather than left to the page to get right.
  it('is the 9×9 grid the corpus describes', () => {
    expect(VIGILANCE_GRID).toBe(9)
  })

  it('takes the row first and the column second', () => {
    const sim = createVigilanceSim({ rng: mulberry32(11) })
    run(sim, 8000)
    // A star whose row and column differ, so an argument swap cannot pass.
    const star = sim.snapshot().stars.find(s => !s.priority && s.row !== s.col)
    expect(star).toBeDefined()

    // Transposed first: same two digits, wrong way round, must be a miss.
    expect(sim.submitCoord(star.col, star.row).type).toBe('miss')
    expect(sim.submitCoord(star.row, star.col).type).toBe('star')
  })

  it('spawns stars inside the grid and never stacks two on a cell', () => {
    for (let seed = 0; seed < 40; seed++) {
      const sim = createVigilanceSim({ rng: mulberry32(seed) })
      run(sim, 60000)
      const snap = sim.snapshot()
      const cells = snap.stars.map(s => `${s.row},${s.col}`)
      expect(new Set(cells).size).toBe(cells.length)
      for (const s of snap.stars) {
        expect(s.col).toBeGreaterThanOrEqual(0)
        expect(s.col).toBeLessThan(VIGILANCE_GRID)
        expect(s.row).toBeGreaterThanOrEqual(0)
        expect(s.row).toBeLessThan(VIGILANCE_GRID)
      }
    }
  })

  it('finishes exactly at the duration and stops accepting input', () => {
    const sim = createVigilanceSim({ rng: mulberry32(1) })
    run(sim, VIGILANCE_DURATION_MS - 200)
    expect(sim.state.finished).toBe(false)
    run(sim, 400)
    expect(sim.state.finished).toBe(true)
    expect(sim.snapshot().remainingMs).toBe(0)

    const before = sim.state.score
    expect(sim.submitCoord(0, 0)).toEqual({ type: 'ignored' })
    expect(sim.state.score).toBe(before)
  })

  it('awards a star and removes it from the board', () => {
    const sim = createVigilanceSim({ rng: mulberry32(2) })
    run(sim, 5000)
    const star = sim.snapshot().stars.find(s => !s.priority)
    expect(star).toBeDefined()
    const event = sim.submitCoord(star.row, star.col)
    expect(event.type).toBe('star')
    expect(event.delta).toBe(STAR_POINTS)
    expect(sim.state.starsCleared).toBe(1)
    expect(sim.snapshot().stars.find(s => s.row === star.row && s.col === star.col)).toBeUndefined()
  })

  it('penalises a coordinate with no star on it', () => {
    // Without this a player could cycle every coordinate on a loop and clear the
    // board without looking at it, which would stop the test measuring anything.
    const sim = createVigilanceSim({ rng: mulberry32(3) })
    run(sim, 3000)
    const occupied = new Set(sim.snapshot().stars.map(s => `${s.row},${s.col}`))
    let empty = null
    for (let r = 0; r < VIGILANCE_GRID && !empty; r++) {
      for (let c = 0; c < VIGILANCE_GRID; c++) {
        if (!occupied.has(`${r},${c}`)) { empty = { r, c }; break }
      }
    }
    const before = sim.state.score
    const event = sim.submitCoord(empty.r, empty.c)
    expect(event.type).toBe('miss')
    expect(sim.state.score).toBe(before - MISKEY_PENALTY)
    expect(sim.state.misKeyed).toBe(1)
  })

  it('makes brute-forcing every coordinate a losing strategy', () => {
    // The real guard on the penalty: sweep the whole grid repeatedly and the
    // misses must cost more than the stars pay.
    const sweep = createVigilanceSim({ rng: mulberry32(4) })
    for (let pass = 0; pass < 30; pass++) {
      run(sweep, 6000)
      for (let r = 0; r < VIGILANCE_GRID; r++) {
        for (let c = 0; c < VIGILANCE_GRID; c++) sweep.submitCoord(r, c)
      }
    }
    expect(sweep.finalScore()).toBe(0)
  })

  it('pays a priority task more when it is dealt with straight away', () => {
    const sim = createVigilanceSim({ rng: mulberry32(5) })
    run(sim, 25000)
    const priority = sim.snapshot().stars.find(s => s.priority)
    expect(priority).toBeDefined()
    const prompt = sim.submitCoord(priority.row, priority.col)
    expect(prompt.type).toBe('priority')
    expect(prompt.delta).toBeGreaterThan(PRIORITY_BASE_POINTS)
    expect(prompt.delta).toBeLessThanOrEqual(PRIORITY_BASE_POINTS + PRIORITY_BONUS_POINTS)

    const slow = createVigilanceSim({ rng: mulberry32(5) })
    run(slow, 25000)
    const p2 = slow.snapshot().stars.find(s => s.priority)
    run(slow, 20000)
    const late = slow.submitCoord(p2.row, p2.col)
    expect(late.delta).toBe(PRIORITY_BASE_POINTS)   // bonus fully decayed, never negative
    expect(late.delta).toBeLessThan(prompt.delta)
  })

  it('always eventually produces a priority task', () => {
    for (let seed = 0; seed < 30; seed++) {
      const sim = createVigilanceSim({ rng: mulberry32(seed) })
      run(sim, 30000)
      expect([seed, sim.snapshot().stars.some(s => s.priority)]).toEqual([seed, true])
    }
  })

  it('never lets the board grow without bound', () => {
    const sim = createVigilanceSim({ rng: mulberry32(6) })
    run(sim, VIGILANCE_DURATION_MS)
    expect(sim.snapshot().stars.length).toBeLessThanOrEqual(VIGILANCE_GRID * VIGILANCE_GRID)
  })

  it('clamps the submitted score at zero but keeps the raw figure', () => {
    const sim = createVigilanceSim({ rng: mulberry32(7) })
    run(sim, 1000)
    // Off the board entirely, so every one of these is a guaranteed miss.
    for (let i = 0; i < 50; i++) sim.submitCoord(VIGILANCE_GRID, VIGILANCE_GRID)
    expect(sim.state.score).toBeLessThan(0)
    expect(sim.finalScore()).toBe(0)
  })

  it('is deterministic for a given seed', () => {
    const a = createVigilanceSim({ rng: mulberry32(8) })
    const b = createVigilanceSim({ rng: mulberry32(8) })
    run(a, 40000)
    run(b, 40000)
    expect(a.snapshot()).toEqual(b.snapshot())
  })
})

// The split. Neither board is the original game; each keeps a different half
// of it. Hard keeps the clock and the points and turns the cadence up; Easier
// keeps the cadence exactly, runs a minute, and pays triple. On both, a star
// stays put until it is keyed.
describe('difficulty load', () => {
  it('is the original board when no load is passed', () => {
    // The sim's defaults are the game as it first shipped, so the tests above
    // this block still describe that board and nothing here has moved them.
    const plain = createVigilanceSim({ rng: mulberry32(9) })
    expect(plain.state.durationMs).toBe(VIGILANCE_DURATION_MS)
    run(plain, 5000)
    const star = plain.snapshot().stars.find(s => !s.priority)
    expect(plain.submitCoord(star.row, star.col).delta).toBe(STAR_POINTS)
  })

  it('Hard keeps the original clock and points, with stars appearing more often', () => {
    const { hard } = VIGILANCE_TUNING
    expect(hard.load.durationMs).toBe(VIGILANCE_DURATION_MS)
    expect(hard.load.starPoints).toBe(STAR_POINTS)
    expect(hard.load.priorityBasePoints).toBe(PRIORITY_BASE_POINTS)
    expect(hard.load.priorityBonusPoints).toBe(PRIORITY_BONUS_POINTS)
    expect(hard.load.priorityWindowMs).toBe(VIGILANCE_BASE_LOAD.priorityWindowMs)
    expect(hard.load.spawnStartMs).toBeLessThan(VIGILANCE_BASE_LOAD.spawnStartMs)
    expect(hard.load.spawnEndMs).toBeLessThan(VIGILANCE_BASE_LOAD.spawnEndMs)
    expect(hard.load.priorityIntervalMs).toBeLessThan(VIGILANCE_BASE_LOAD.priorityIntervalMs)

    const sim = createVigilanceSim({ rng: mulberry32(11), load: hard.load })
    run(sim, VIGILANCE_DURATION_MS - 100)
    expect(sim.state.finished).toBe(false)
    run(sim, 200)
    expect(sim.state.finished).toBe(true)
  })

  it('Easier keeps the original pace exactly, runs one minute, and pays triple', () => {
    const { easier } = VIGILANCE_TUNING
    expect(easier.load.durationMs).toBe(60000)
    expect(easier.load.starPoints).toBe(STAR_POINTS * EASIER_POINTS_MULTIPLIER)
    expect(easier.load.priorityBasePoints).toBe(PRIORITY_BASE_POINTS * EASIER_POINTS_MULTIPLIER)
    expect(easier.load.priorityBonusPoints).toBe(PRIORITY_BONUS_POINTS * EASIER_POINTS_MULTIPLIER)
    // Cadence untouched — the pace is the one thing Easier keeps.
    for (const k of ['spawnStartMs', 'spawnEndMs', 'spawnRampMs', 'maxStars', 'priorityFirstMs', 'priorityIntervalMs', 'priorityWindowMs']) {
      expect([k, easier.load[k]]).toEqual([k, VIGILANCE_BASE_LOAD[k]])
    }

    // "The original pace" has to be literally true: Easier's minute puts the
    // same stars on the same cells as the first minute of the original board.
    // A ramp that eased over the run length instead of the original 180s
    // would quietly make Easier faster than the game it claims to be.
    const original = createVigilanceSim({ rng: mulberry32(19) })
    const short = createVigilanceSim({ rng: mulberry32(19), load: easier.load })
    run(original, 60000)
    run(short, 60000)
    expect(short.snapshot().stars).toEqual(original.snapshot().stars)
    expect(short.state.finished).toBe(true)
    expect(original.state.finished).toBe(false)

    // And each of those stars pays three times what it did.
    const star = short.snapshot().stars.find(s => !s.priority)
    const sim = createVigilanceSim({ rng: mulberry32(19), load: easier.load })
    run(sim, 30000)
    expect(sim.submitCoord(star.row, star.col).delta).toBe(STAR_POINTS * EASIER_POINTS_MULTIPLIER)
    const p = sim.snapshot().stars.find(s => s.priority)
    expect(p).toBeDefined()
    const pd = sim.submitCoord(p.row, p.col).delta
    expect(pd).toBeGreaterThan(PRIORITY_BASE_POINTS * EASIER_POINTS_MULTIPLIER)
    expect(pd).toBeLessThanOrEqual((PRIORITY_BASE_POINTS + PRIORITY_BONUS_POINTS) * EASIER_POINTS_MULTIPLIER)
  })

  it('charges the same mis-key penalty on both boards', () => {
    // Only the CORRECT answers were tripled.
    for (const tuning of [VIGILANCE_TUNING.easier, VIGILANCE_TUNING.hard]) {
      const sim = createVigilanceSim({ rng: mulberry32(20), load: tuning.load })
      run(sim, 1000)
      expect(sim.submitCoord(VIGILANCE_GRID, VIGILANCE_GRID).delta).toBe(-MISKEY_PENALTY)
    }
  })

  it('spawns more stars on Hard than on Easier over the same stretch', () => {
    const count = (load) => {
      const sim = createVigilanceSim({ rng: mulberry32(12), load: { ...load, maxStars: 81 } })
      run(sim, 60000)
      return sim.snapshot().stars.length
    }
    expect(count(VIGILANCE_TUNING.hard.load)).toBeGreaterThan(count(VIGILANCE_TUNING.easier.load) * 1.4)
  })

  it('leaves every star exactly where it is until it is keyed, on both boards', () => {
    // Nothing times out, nothing moves, nothing is taken off the board for
    // you. Run the clock down without touching a key and the board must hold
    // every star it has room for, at the cell it appeared in.
    for (const tuning of [VIGILANCE_TUNING.easier, VIGILANCE_TUNING.hard]) {
      const sim = createVigilanceSim({ rng: mulberry32(13), load: tuning.load })
      run(sim, 10000)
      const early = sim.snapshot().stars.map(s => `${s.row},${s.col}`)
      expect(early.length).toBeGreaterThan(0)
      run(sim, tuning.load.durationMs - 10000)
      const late = new Set(sim.snapshot().stars.map(s => `${s.row},${s.col}`))
      for (const cell of early) expect([tuning.key, cell, late.has(cell)]).toEqual([tuning.key, cell, true])
      expect(sim.snapshot().stars.length).toBe(tuning.load.maxStars)
      // And leaving them there cost nothing.
      expect(sim.state.score).toBe(0)
    }
  })

  it('pays a priority task the same way on Hard', () => {
    const sim = createVigilanceSim({ rng: mulberry32(14), load: VIGILANCE_TUNING.hard.load })
    run(sim, VIGILANCE_TUNING.hard.load.priorityFirstMs + 100)
    const p = sim.snapshot().stars.find(s => s.priority)
    expect(p).toBeDefined()
    const event = sim.submitCoord(p.row, p.col)
    expect(event.type).toBe('priority')
    expect(event.delta).toBeGreaterThan(PRIORITY_BASE_POINTS)
    expect(event.delta).toBeLessThanOrEqual(PRIORITY_BASE_POINTS + PRIORITY_BONUS_POINTS)
  })

  it('is deterministic on Hard for a given seed', () => {
    const a = createVigilanceSim({ rng: mulberry32(18), load: VIGILANCE_TUNING.hard.load })
    const b = createVigilanceSim({ rng: mulberry32(18), load: VIGILANCE_TUNING.hard.load })
    run(a, 40000)
    run(b, 40000)
    expect(a.snapshot()).toEqual(b.snapshot())
  })
})
