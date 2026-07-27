import { describe, it, expect } from 'vitest'
import {
  TRACE1_ROUNDS,
  TRACE1_TURNS_PER_ROUND,
  TRACE1_TOTAL_TURNS,
  TRACE1_SPEED_TABLE,
  TRACE1_PLANE_COUNT,
  TRACE1_COLORS,
  TRACE1_WALL_MARGIN,
  TRACE1_TURN_DEFS,
  TRACE1_TURN_KEYS,
  trace1KeyToTurn,
  trace1InitialPlaneStates,
  buildTrace1Round,
  buildTrace1Selection,
  applyLocalRot,
  getForward,
} from '../trace1Generator'

const GRID = 10, LAYERS = 10

// Deterministic RNG so a failure is reproducible rather than a flake.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Replay a schedule the same way the live game does — apply each turn to the
// quaternion, then walk 2 cells along the new heading — and report every grid
// position the aircraft is projected through.
function walkSchedule(startQuat, startPos, schedule) {
  let quat = [...startQuat]
  const pos = { ...startPos }
  const visited = [{ ...pos }]
  for (const turnKey of schedule) {
    const def = TRACE1_TURN_DEFS[turnKey]
    quat = applyLocalRot(quat, def.axis, def.angle)
    const f = getForward(quat)
    const dx = Math.round(f.x), dy = Math.round(f.y), dz = Math.round(f.z)
    for (let s = 0; s < 2; s++) {
      pos.c += dx; pos.layer += dy; pos.r += dz
      visited.push({ ...pos })
    }
  }
  return { visited, endQuat: quat, endPos: pos }
}

describe('trace1Generator — round shape', () => {
  it('runs 5 rounds of 8 turns, totalling 40 scored turns', () => {
    expect(TRACE1_ROUNDS).toBe(5)
    expect(TRACE1_TURNS_PER_ROUND).toBe(8)
    expect(TRACE1_TOTAL_TURNS).toBe(40)
  })

  it('has one speed and one plane count per round', () => {
    expect(TRACE1_SPEED_TABLE).toHaveLength(TRACE1_ROUNDS)
    expect(TRACE1_PLANE_COUNT).toHaveLength(TRACE1_ROUNDS)
  })

  it('never speeds up past round 2', () => {
    // Rounds 1→2 may still ramp; from round 2 onward the tick must hold flat,
    // so the added aircraft are the only thing making later rounds harder.
    const fromRound2 = TRACE1_SPEED_TABLE.slice(1)
    for (const ms of fromRound2) expect(ms).toBe(TRACE1_SPEED_TABLE[1])
    expect(TRACE1_SPEED_TABLE[1]).toBeLessThan(TRACE1_SPEED_TABLE[0])
  })

  it('adds aircraft on rounds 3, 4 and 5', () => {
    expect(TRACE1_PLANE_COUNT).toEqual([1, 1, 2, 3, 4])
  })

  it('maps arrow keys onto the four turns', () => {
    expect(trace1KeyToTurn('ArrowLeft')).toBe('yawL')
    expect(trace1KeyToTurn('ArrowRight')).toBe('yawR')
    expect(trace1KeyToTurn('ArrowUp')).toBe('pitchD')
    expect(trace1KeyToTurn('ArrowDown')).toBe('pitchU')
    expect(trace1KeyToTurn('Space')).toBeNull()
  })
})

describe('trace1Generator — start slots', () => {
  it('keeps the lone aircraft at the legacy centre spawn, untinted', () => {
    const [solo] = trace1InitialPlaneStates(1)
    expect(solo.pos).toEqual({ r: 5, c: 5, layer: 5 })
    expect(solo.startWorld).toEqual([0.5, 5, 0.5])
    expect(solo.color).toBeNull()
  })

  it('tints multi-aircraft rounds red, blue, green, yellow in that order', () => {
    const keys = trace1InitialPlaneStates(4).map(p => p.color.key)
    expect(keys).toEqual(['red', 'blue', 'green', 'yellow'])
    // Round 3 gets exactly red + blue.
    expect(trace1InitialPlaneStates(2).map(p => p.color.key)).toEqual(['red', 'blue'])
    expect(TRACE1_COLORS).toHaveLength(4)
  })

  it('spawns every aircraft on its own cell, inside the wall margin', () => {
    for (const count of [2, 3, 4]) {
      const states = trace1InitialPlaneStates(count)
      const seen = new Set(states.map(s => `${s.pos.r},${s.pos.c},${s.pos.layer}`))
      expect(seen.size).toBe(count)
      for (const s of states) {
        expect(s.pos.r).toBeGreaterThanOrEqual(TRACE1_WALL_MARGIN)
        expect(s.pos.r).toBeLessThanOrEqual(GRID - 1 - TRACE1_WALL_MARGIN)
        expect(s.pos.c).toBeGreaterThanOrEqual(TRACE1_WALL_MARGIN)
        expect(s.pos.c).toBeLessThanOrEqual(GRID - 1 - TRACE1_WALL_MARGIN)
        expect(s.pos.layer).toBeGreaterThanOrEqual(TRACE1_WALL_MARGIN)
        expect(s.pos.layer).toBeLessThanOrEqual(LAYERS - 1 - TRACE1_WALL_MARGIN)
      }
    }
  })
})

describe('trace1Generator — flight schedules', () => {
  it('emits one 8-turn schedule per aircraft, using only real turn keys', () => {
    for (const count of TRACE1_PLANE_COUNT) {
      const built = buildTrace1Round(trace1InitialPlaneStates(count), mulberry32(count * 17))
      expect(built.schedules).toHaveLength(count)
      for (const s of built.schedules) {
        expect(s).toHaveLength(TRACE1_TURNS_PER_ROUND)
        for (const k of s) expect(TRACE1_TURN_KEYS).toContain(k)
      }
    }
  })

  it('keeps every aircraft inside the arena across all 5 rounds', () => {
    // The whole point of the wall margin: the visible jet must never freeze
    // against the scene's soft clamp. Walk each round for real, seeded.
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed)
      let states = []
      let prevCount = 0
      for (let round = 0; round < TRACE1_ROUNDS; round++) {
        const count = TRACE1_PLANE_COUNT[round]
        if (count !== prevCount) { states = trace1InitialPlaneStates(count); prevCount = count }
        const built = buildTrace1Round(states, rng)
        built.schedules.forEach((schedule, i) => {
          const { visited } = walkSchedule(states[i].quat, states[i].pos, schedule)
          for (const p of visited) {
            expect(p.r).toBeGreaterThanOrEqual(0)
            expect(p.r).toBeLessThan(GRID)
            expect(p.c).toBeGreaterThanOrEqual(0)
            expect(p.c).toBeLessThan(GRID)
            expect(p.layer).toBeGreaterThanOrEqual(0)
            expect(p.layer).toBeLessThan(LAYERS)
          }
        })
        states = built.states
      }
    }
  })

  it('reports end states that match replaying the schedule', () => {
    // The live loop only replays the schedule; it never re-simulates position.
    // If these drift apart, later rounds would plan from a phantom position.
    const rng = mulberry32(99)
    const start = trace1InitialPlaneStates(3)
    const built = buildTrace1Round(start, rng)
    built.schedules.forEach((schedule, i) => {
      const { endQuat, endPos } = walkSchedule(start[i].quat, start[i].pos, schedule)
      expect(built.states[i].pos).toEqual(endPos)
      built.states[i].quat.forEach((v, k) => expect(v).toBeCloseTo(endQuat[k], 6))
    })
  })

  it('never repeats the same turn three times in a row', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const built = buildTrace1Round(trace1InitialPlaneStates(4), mulberry32(seed))
      for (const schedule of built.schedules) {
        for (let i = 2; i < schedule.length; i++) {
          expect(schedule[i] === schedule[i - 1] && schedule[i - 1] === schedule[i - 2]).toBe(false)
        }
      }
    }
  })

  it('does not mutate the states it was given', () => {
    const start = trace1InitialPlaneStates(2)
    const snapshot = JSON.stringify(start.map(s => ({ quat: s.quat, pos: s.pos, tail: s.tail })))
    buildTrace1Round(start, mulberry32(5))
    expect(JSON.stringify(start.map(s => ({ quat: s.quat, pos: s.pos, tail: s.tail })))).toBe(snapshot)
  })
})

describe('trace1Generator — tracked aircraft', () => {
  it('always tracks the only aircraft in single-jet rounds', () => {
    const sel = buildTrace1Selection(1, TRACE1_TURNS_PER_ROUND, mulberry32(1))
    expect(sel).toEqual(new Array(TRACE1_TURNS_PER_ROUND).fill(0))
  })

  it('only ever names an aircraft that is on screen', () => {
    for (const count of [2, 3, 4]) {
      for (let seed = 1; seed <= 40; seed++) {
        const sel = buildTrace1Selection(count, TRACE1_TURNS_PER_ROUND, mulberry32(seed))
        expect(sel).toHaveLength(TRACE1_TURNS_PER_ROUND)
        for (const i of sel) {
          expect(Number.isInteger(i)).toBe(true)
          expect(i).toBeGreaterThanOrEqual(0)
          expect(i).toBeLessThan(count)
        }
      }
    }
  })

  it('never switches on two consecutive turns', () => {
    // This is what buys the player a clean, undisturbed turn after every switch.
    for (const count of [2, 3, 4]) {
      for (let seed = 1; seed <= 60; seed++) {
        const sel = buildTrace1Selection(count, TRACE1_TURNS_PER_ROUND, mulberry32(seed))
        for (let i = 2; i < sel.length; i++) {
          const switchedNow  = sel[i] !== sel[i - 1]
          const switchedPrev = sel[i - 1] !== sel[i - 2]
          expect(switchedNow && switchedPrev).toBe(false)
        }
      }
    }
  })

  it('switches at least twice per round, so no round is a single-jet watch', () => {
    for (const count of [2, 3, 4]) {
      for (let seed = 1; seed <= 60; seed++) {
        const sel = buildTrace1Selection(count, TRACE1_TURNS_PER_ROUND, mulberry32(seed))
        let switches = 0
        for (let i = 1; i < sel.length; i++) if (sel[i] !== sel[i - 1]) switches++
        expect(switches).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('always moves to a different aircraft on a switch', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const sel = buildTrace1Selection(4, TRACE1_TURNS_PER_ROUND, mulberry32(seed))
      for (let i = 1; i < sel.length; i++) {
        if (sel[i] !== sel[i - 1]) expect(sel[i]).not.toBe(sel[i - 1])
      }
    }
  })

  it('is exposed on every built round, one entry per scored turn', () => {
    for (const count of TRACE1_PLANE_COUNT) {
      const built = buildTrace1Round(trace1InitialPlaneStates(count), mulberry32(count * 7))
      expect(built.selection).toHaveLength(TRACE1_TURNS_PER_ROUND)
      for (const i of built.selection) expect(i).toBeLessThan(count)
    }
  })
})
