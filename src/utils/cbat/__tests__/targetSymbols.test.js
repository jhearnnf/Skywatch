import { describe, it, expect } from 'vitest'
import {
  labelFor, shapeMatches, planDemoHuntTargets,
  DEMO_TARGET, DEMO_LABEL_TOKENS, DEMO_NEAR_MISSES, DEMO_HUNT_REQUIRED,
} from '../targetSymbols'

describe('labelFor', () => {
  it('reads adjectives, then the pluralised kind, then the facing', () => {
    expect(labelFor(DEMO_TARGET)).toBe('damaged high-priority hostile tanks facing north')
  })

  it('omits the marks a target does not carry', () => {
    expect(labelFor({ kind: 'truck', color: 'friendly', damaged: false, highPriority: false, direction: null }))
      .toBe('friendly trucks')
  })

  it('names each compass direction in full', () => {
    const facing = (direction) => labelFor({ kind: 'building', color: 'neutral', direction })
    expect(facing('N')).toBe('neutral buildings facing north')
    expect(facing('E')).toBe('neutral buildings facing east')
    expect(facing('S')).toBe('neutral buildings facing south')
    expect(facing('W')).toBe('neutral buildings facing west')
  })
})

describe('tutorial demo target', () => {
  it('spells its label exactly as the game would generate it', () => {
    // Guards the tutorial's reveal order against labelFor(). The demo lights
    // these tokens out of order (shape → colour → damaged → hi-pri → facing), so
    // it must never show the label itself in a word order the live game wouldn't
    // produce. Reorder labelFor()'s adjectives and this fails.
    expect(DEMO_LABEL_TOKENS.join(' ')).toBe(labelFor(DEMO_TARGET))
  })

  it('carries every mark, so the demo has all five to reveal', () => {
    expect(DEMO_TARGET.damaged).toBe(true)
    expect(DEMO_TARGET.highPriority).toBe(true)
    expect(DEMO_TARGET.direction).toBeTruthy()
    expect(DEMO_LABEL_TOKENS).toHaveLength(5)
  })
})

describe('shapeMatches', () => {
  it('accepts a shape carrying every mark the target asks for', () => {
    expect(shapeMatches({ ...DEMO_TARGET }, DEMO_TARGET)).toBe(true)
  })

  it('rejects diamonds and decoys outright', () => {
    expect(shapeMatches({ ...DEMO_TARGET, kind: 'unknown' }, DEMO_TARGET)).toBe(false)
    expect(shapeMatches({ ...DEMO_TARGET, fake: true }, DEMO_TARGET)).toBe(false)
  })

  it('treats marks as requirements, not an exact spec', () => {
    // A target that doesn't ask for a mark is satisfied either way, so a scene
    // shape may carry extra marks the label never mentioned.
    const plain = { kind: 'tank', color: 'hostile', damaged: false, highPriority: false, direction: null }
    expect(shapeMatches({ ...DEMO_TARGET }, plain)).toBe(true)
    expect(shapeMatches(plain, DEMO_TARGET)).toBe(false)
  })
})

describe('tutorial hunt scene', () => {
  const targets = planDemoHuntTargets()

  it('contains exactly the number of matches the copy promises', () => {
    // The caption says "there are five" and the section only ends on the fifth,
    // so an extra match would leave the player hunting one that isn't counted.
    expect(targets.filter(t => shapeMatches(t, DEMO_TARGET))).toHaveLength(DEMO_HUNT_REQUIRED)
  })

  it('salts the scene with near misses that none of them match', () => {
    expect(DEMO_NEAR_MISSES.length).toBeGreaterThan(0)
    for (const miss of DEMO_NEAR_MISSES) {
      expect(shapeMatches(miss, DEMO_TARGET)).toBe(false)
    }
  })

  it('makes every near miss differ in exactly one mark', () => {
    // A near miss differing in two marks teaches nothing — the player can reject
    // it without having to read the whole label.
    for (const miss of DEMO_NEAR_MISSES) {
      const differing = Object.keys(DEMO_TARGET).filter(k => miss[k] !== DEMO_TARGET[k])
      expect(differing).toHaveLength(1)
    }
  })

  it('covers every mark across the near misses, so each word gets tested', () => {
    const covered = new Set(
      DEMO_NEAR_MISSES.map(m => Object.keys(DEMO_TARGET).find(k => m[k] !== DEMO_TARGET[k])),
    )
    expect(covered).toEqual(new Set(['kind', 'color', 'damaged', 'highPriority', 'direction']))
  })
})
