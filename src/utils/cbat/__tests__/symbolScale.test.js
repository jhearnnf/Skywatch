import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSymbolScale, _clearSymbolScaleCache } from '../symbolScale'

// Install a fake 2d context so we can drive measureText's ink metrics.
// `ink` maps a character to { h, w } in px at the 100px measurement size.
function stubCanvas(ink) {
  const measureText = vi.fn((ch) => {
    const { h = 70, w = 50 } = ink[ch] || {}
    return {
      actualBoundingBoxAscent: h,
      actualBoundingBoxDescent: 0,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: w,
    }
  })
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag) =>
    tag === 'canvas'
      ? { getContext: () => ({ font: '', measureText }) }
      : realCreate(tag)
  )
  return measureText
}

describe('getSymbolScale — measured path', () => {
  beforeEach(() => _clearSymbolScaleCache())
  afterEach(() => vi.restoreAllMocks())

  it('scales a short glyph up and a tall glyph down toward one ink height', () => {
    stubCanvas({ 'о': { h: 50, w: 50 }, '一': { h: 86, w: 90 } })

    const small = getSymbolScale('о')  // Cyrillic lowercase — x-height only
    const large = getSymbolScale('一') // full-width CJK

    expect(small).toBeGreaterThan(1)
    expect(large).toBeLessThan(1)
    // Both land on the same rendered ink height: scale * inkHeight is equal.
    expect(small * 0.5).toBeCloseTo(large * 0.86, 2)
  })

  it('caps a very wide glyph so it still fits its square tile', () => {
    // Short but extremely wide: height alone would ask for 1.32x, which would
    // render 1.32 x 0.95em = 1.25em of ink across a 1em-wide tile.
    stubCanvas({ 'W': { h: 50, w: 95 } })
    expect(getSymbolScale('W')).toBeCloseTo(0.82 / 0.95, 2)
  })

  it('clamps extreme measurements into the allowed range', () => {
    stubCanvas({ '.': { h: 5, w: 5 }, '█': { h: 200, w: 100 } })
    expect(getSymbolScale('.')).toBe(1.8)
    expect(getSymbolScale('█')).toBe(0.6)
  })

  it('measures each character only once', () => {
    const measureText = stubCanvas({ 'あ': { h: 80, w: 85 } })
    getSymbolScale('あ')
    getSymbolScale('あ')
    getSymbolScale('あ')
    expect(measureText).toHaveBeenCalledTimes(1)
  })
})

describe('getSymbolScale — fallback path', () => {
  beforeEach(() => _clearSymbolScaleCache())
  afterEach(() => vi.restoreAllMocks())

  it('uses per-script defaults when ink metrics are unavailable', () => {
    // measureText present but reporting no ink — the shape jsdom gives us.
    vi.spyOn(document, 'createElement').mockImplementation(() => ({
      getContext: () => ({ font: '', measureText: () => ({}) }),
    }))

    expect(getSymbolScale('о')).toBe(1.25)  // Cyrillic lowercase
    expect(getSymbolScale('А')).toBe(0.92)  // Cyrillic uppercase
    expect(getSymbolScale('一')).toBe(0.78) // CJK
    expect(getSymbolScale('ا')).toBe(1.35)  // Arabic
    expect(getSymbolScale('A')).toBe(1)     // unlisted script
  })

  it('survives a canvas that cannot be created at all', () => {
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('no canvas')
    })
    expect(getSymbolScale('한')).toBe(0.78)
  })

  it('returns 1 for an empty character', () => {
    expect(getSymbolScale('')).toBe(1)
  })
})
