import { describe, it, expect } from 'vitest'
import { PACKAGES_PER_LEVEL, MAX_LEVEL, practiseInterval } from '../tracePractise'

describe('Trace Practise run length', () => {
  // The run was cut from 5×5 to 3×3 because players were abandoning part-way.
  // Pinned so a later tweak has to be a deliberate one.
  it('is three levels of three packages', () => {
    expect(PACKAGES_PER_LEVEL).toBe(3)
    expect(MAX_LEVEL).toBe(3)
  })

  it('asks for nine packages in total', () => {
    expect(PACKAGES_PER_LEVEL * MAX_LEVEL).toBe(9)
  })
})

describe('practiseInterval', () => {
  it('starts at the same 500ms level 1 always ran at', () => {
    expect(practiseInterval(1)).toBe(500)
  })

  it('still finishes at 340ms — the pace the old level 5 reached', () => {
    expect(practiseInterval(MAX_LEVEL)).toBe(340)
  })

  it('speeds up on every level', () => {
    for (let lvl = 2; lvl <= MAX_LEVEL; lvl++) {
      expect(practiseInterval(lvl)).toBeLessThan(practiseInterval(lvl - 1))
    }
  })

  it('never drops below the 150ms floor', () => {
    expect(practiseInterval(20)).toBe(150)
  })
})
