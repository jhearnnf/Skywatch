import { describe, it, expect } from 'vitest'
import {
  APPEARANCE_BY_KEY,
  HAIR_STYLES,
  DEFAULT_ACCENT,
  factionAccent,
  hashString,
  generatedAppearance,
  resolveAppearance,
} from '../actorAppearance'

// Colours have no defaults to fall back on, so every descriptor has to carry
// them. The face measurements do fall back to FACE_DEFAULTS, which is what
// lets an entry state only what makes that face itself.
const REQUIRED_FIELDS = ['skin', 'hair', 'brow', 'eye', 'lip', 'suit', 'shirt', 'tie', 'hairStyle']

describe('APPEARANCE_BY_KEY', () => {
  it('gives every shipped figure a complete, drawable descriptor', () => {
    for (const [key, look] of Object.entries(APPEARANCE_BY_KEY)) {
      for (const field of REQUIRED_FIELDS) {
        expect(look[field], `${key}.${field}`).toBeDefined()
      }
      expect(HAIR_STYLES, `${key}.hairStyle`).toContain(look.hairStyle)
    }
  })

  it('covers every actor prompt key the seeded chapter uses', () => {
    const seeded = ['putin', 'lavrov', 'biden', 'stoltenberg', 'zelensky', 'macron', 'scholz', 'xi']
    for (const key of seeded) {
      expect(APPEARANCE_BY_KEY[key], key).toBeDefined()
    }
  })
})

describe('factionAccent', () => {
  it('gives the named factions their own accent', () => {
    expect(factionAccent('RUS')).not.toBe(factionAccent('UKR'))
  })

  it('falls back to the brand colour for an unknown faction', () => {
    expect(factionAccent('ATLANTIS')).toBe(DEFAULT_ACCENT)
    expect(factionAccent(undefined)).toBe(DEFAULT_ACCENT)
  })
})

describe('hashString', () => {
  it('is stable for the same input', () => {
    expect(hashString('Volodymyr Zelensky')).toBe(hashString('Volodymyr Zelensky'))
  })

  it('separates different inputs', () => {
    expect(hashString('a')).not.toBe(hashString('b'))
  })
})

describe('generatedAppearance', () => {
  it('produces a complete descriptor for a name it has never seen', () => {
    const look = generatedAppearance('Some New Minister')
    for (const field of REQUIRED_FIELDS) {
      expect(look[field], field).toBeDefined()
    }
    expect(HAIR_STYLES).toContain(look.hairStyle)
  })

  it('keeps every generated measurement inside a plausible range', () => {
    // A hash is allowed to make faces different, not to make them grotesque.
    for (const name of ['Ada Vasquez', 'Kwame Boateng', 'Yuki Tanaka', 'Ingrid Holm']) {
      const look = generatedAppearance(name)
      expect(look.faceWidth).toBeGreaterThanOrEqual(0.94)
      expect(look.faceWidth).toBeLessThanOrEqual(1.1)
      expect(look.faceLength).toBeGreaterThanOrEqual(0.93)
      expect(look.faceLength).toBeLessThanOrEqual(1.08)
      expect(look.hooding).toBeGreaterThanOrEqual(0)
      expect(look.hooding).toBeLessThanOrEqual(1)
      expect(look.build).toBeGreaterThanOrEqual(0.95)
      expect(look.build).toBeLessThanOrEqual(1.06)
    }
  })

  it('is deterministic, so a face does not change between renders', () => {
    expect(generatedAppearance('Ada Vasquez')).toEqual(generatedAppearance('Ada Vasquez'))
  })
})

describe('resolveAppearance', () => {
  it('uses the registry entry for a known systemPromptKey', () => {
    const look = resolveAppearance({ systemPromptKey: 'scholz', name: 'Olaf Scholz' })
    // `glasses` names the frame style, so a face can wear rimless or full ones.
    expect(look.glasses).toBe('rimless')
    expect(look.hairStyle).toBe('bald')
  })

  it('generates a stable face for an actor with no registry entry', () => {
    const actor = { id: 'a_new', name: 'New Actor', systemPromptKey: 'new_actor' }
    expect(resolveAppearance(actor)).toEqual(resolveAppearance(actor))
  })

  it('fills in the face defaults so a partial entry is still drawable', () => {
    const look = resolveAppearance({ systemPromptKey: 'putin' })
    // putin's entry does not set earSize; it must still come back.
    expect(look.earSize).toBeDefined()
    expect(look.jawSquare).toBe(0.7)   // from the entry, not the default
  })

  it('gives the shipped figures measurably different faces', () => {
    const widths = Object.values(APPEARANCE_BY_KEY).map((a) => a.faceWidth)
    expect(new Set(widths).size).toBeGreaterThan(4)
    const hairlines = Object.values(APPEARANCE_BY_KEY).map((a) => a.recession)
    expect(new Set(hairlines).size).toBeGreaterThan(4)
  })

  it('lets a chapter override individual fields per actor', () => {
    const look = resolveAppearance({
      systemPromptKey: 'scholz',
      appearance: { tie: '#00ff00' },
    })
    expect(look.tie).toBe('#00ff00')
    // Everything not overridden still comes from the registry.
    expect(look.glasses).toBe('rimless')
  })

  it('does not throw when handed nothing', () => {
    expect(() => resolveAppearance(undefined)).not.toThrow()
    expect(resolveAppearance(undefined).skin).toBeDefined()
  })
})
