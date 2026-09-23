import { describe, it, expect, beforeEach } from 'vitest'
import {
  drillCraftOptions, drillCraftUrl, readStoredDrillCraft, storeDrillCraft, DEFAULT_DRILL_CRAFT,
} from '../drillCraft'

// The Instruments drill's aircraft list: ACT's roster rules, but no ball, and
// the Typhoon always there so the picker is never empty and the drill always
// has something to fly.

beforeEach(() => localStorage.clear())

describe('drill aircraft', () => {
  it('always offers the Typhoon, even with no roster', () => {
    expect(drillCraftOptions([])).toEqual([DEFAULT_DRILL_CRAFT])
    expect(drillCraftOptions(null)[0].id).toBe(DEFAULT_DRILL_CRAFT.id)
  })

  it('never offers a ball', () => {
    const ids = drillCraftOptions([{ briefId: 'b1', title: 'Hawk T2', cutoutUrl: '/c.png' }]).map(o => o.id)
    expect(ids).not.toContain('ball')
  })

  it('takes the roster copy of the Typhoon rather than listing it twice', () => {
    const opts = drillCraftOptions([{ briefId: 'x', title: 'Eurofighter Typhoon FGR4', cutoutUrl: '/t.png' }])
    expect(opts.filter(o => o.id === DEFAULT_DRILL_CRAFT.id)).toHaveLength(1)
  })

  it('falls back to the Typhoon when the stored choice has left the list', () => {
    expect(drillCraftUrl([DEFAULT_DRILL_CRAFT], 'retired aircraft')).toBe(DEFAULT_DRILL_CRAFT.modelUrl)
  })

  it('remembers the choice, defaulting to the Typhoon', () => {
    expect(readStoredDrillCraft()).toBe(DEFAULT_DRILL_CRAFT.id)
    storeDrillCraft('hawk t2')
    expect(readStoredDrillCraft()).toBe('hawk t2')
  })
})
