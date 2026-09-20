import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import CountryFlag, { flagEmojiToCode, hasFlag, FLAG_CODES } from '../CountryFlag'

// Windows has no flag emoji glyphs, so the guide rail's country flags are
// drawn as SVG. The seed script stores them as emoji (🇨🇦), so the mapping
// from emoji to drawing is the part that must not drift.
describe('CountryFlag', () => {
  it('reads a country code out of a flag emoji', () => {
    expect(flagEmojiToCode('🇨🇦')).toBe('CA')
    expect(flagEmojiToCode('🇬🇧')).toBe('GB')
    expect(flagEmojiToCode('🇦🇺')).toBe('AU')
  })

  it('returns null for anything that is not a two-letter flag', () => {
    expect(flagEmojiToCode('📖')).toBeNull()
    expect(flagEmojiToCode('🇨🇦🇬🇧')).toBeNull()
    expect(flagEmojiToCode('')).toBeNull()
    expect(flagEmojiToCode(null)).toBeNull()
  })

  it('has a drawing for every guide country and admits it when it does not', () => {
    expect(FLAG_CODES).toEqual(expect.arrayContaining(['GB', 'CA', 'AU']))
    expect(hasFlag('🇬🇧')).toBe(true)
    // A real flag we have not drawn: the caller keeps the emoji.
    expect(hasFlag('🇫🇷')).toBe(false)
    expect(hasFlag('📖')).toBe(false)
  })

  it('renders an SVG labelled with the code, and nothing for an unknown flag', () => {
    const { container } = render(<CountryFlag emoji="🇨🇦" width={24} />)
    const svg = container.querySelector('svg[data-flag="CA"]')
    expect(svg).toBeTruthy()
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.getAttribute('height')).toBe('12')

    const { container: none } = render(<CountryFlag emoji="🇫🇷" />)
    expect(none.querySelector('svg')).toBeNull()
  })

  it('gives two flags on one page distinct clip-path ids', () => {
    const { container } = render(<><CountryFlag code="AU" /><CountryFlag code="AU" /></>)
    const ids = [...container.querySelectorAll('clipPath')].map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
