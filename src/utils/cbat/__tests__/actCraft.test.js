import { describe, it, expect, beforeEach } from 'vitest'
import {
  ACT_CRAFT_BALL,
  actCraftOptions,
  craftModelUrl,
  readStoredActCraft,
  storeActCraft,
} from '../actCraft'

// Roster shape is whatever getAircraftRoster('aircraft-cutouts') returns.
const entry = (title, cutoutUrl = `https://cdn/${title}.png`) => ({ briefId: title, title, cutoutUrl })

const TYPHOON = entry('Eurofighter Typhoon FGR4')
const HAWK    = entry('Hawk T2')
const CHINOOK = entry('Chinook HC6 6A')

beforeEach(() => { localStorage.clear() })

describe('actCraftOptions', () => {
  it('always offers the ball first, even with no roster', () => {
    expect(actCraftOptions([])[0]).toMatchObject({ id: ACT_CRAFT_BALL, modelUrl: null })
    expect(actCraftOptions(null)).toHaveLength(1)
  })

  it('offers aircraft that have a model, with the URL the model loads from', () => {
    const ids = actCraftOptions([TYPHOON, HAWK]).map(o => o.id)
    expect(ids).toEqual([ACT_CRAFT_BALL, 'eurofighter typhoon fgr4', 'hawk t2'])
    const typhoon = actCraftOptions([TYPHOON])[1]
    expect(typhoon.modelUrl).toBe('/models/eurofighter typhoon fgr4.glb')
    expect(typhoon.cutoutUrl).toBe(TYPHOON.cutoutUrl)
  })

  // The rotor blades are broken in the GLB, and the ACT camera sits close
  // enough to the player's craft that it would be the first thing seen.
  it('never offers the Chinook', () => {
    const ids = actCraftOptions([TYPHOON, CHINOOK]).map(o => o.id)
    expect(ids).not.toContain('chinook hc6 6a')
  })

  it('drops roster entries with no model rather than offering a broken tile', () => {
    const ids = actCraftOptions([entry('Sopwith Camel'), TYPHOON]).map(o => o.id)
    expect(ids).toEqual([ACT_CRAFT_BALL, 'eurofighter typhoon fgr4'])
  })
})

describe('craftModelUrl', () => {
  const options = actCraftOptions([TYPHOON])

  it('is null for the ball', () => {
    expect(craftModelUrl(options, ACT_CRAFT_BALL)).toBeNull()
  })

  it('is the aircraft model when one is selected', () => {
    expect(craftModelUrl(options, 'eurofighter typhoon fgr4')).toBe('/models/eurofighter typhoon fgr4.glb')
  })

  // Going offline cuts the roster down to the precached models, so a stored
  // choice can name an aircraft that is not on offer this session.
  it('falls back to the ball when the stored choice is not on offer', () => {
    expect(craftModelUrl(options, 'p-8a poseidon mra1')).toBeNull()
  })
})

describe('stored choice', () => {
  it('defaults to the ball', () => {
    expect(readStoredActCraft()).toBe(ACT_CRAFT_BALL)
  })

  it('round-trips a selection', () => {
    storeActCraft('hawk t2')
    expect(readStoredActCraft()).toBe('hawk t2')
  })
})
