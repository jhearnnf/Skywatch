import { describe, expect, it } from 'vitest'
import {
  HEADING_FEATHER, chevronOpacity, headingFill, headingGlow, headingMask,
  panelReveal, revealProgress, snapTarget,
} from '../loungeReveal'

const bounds = { start: 0, end: 400 }

describe('lounge reveal: progress and snapping', () => {
  it('maps the scroll between the two ends onto 0..1', () => {
    expect(revealProgress(0, bounds)).toBe(0)
    expect(revealProgress(200, bounds)).toBe(0.5)
    expect(revealProgress(400, bounds)).toBe(1)
    expect(revealProgress(-30, bounds)).toBe(0)
    expect(revealProgress(900, bounds)).toBe(1)
  })

  // No room to scroll means the lounge is already on screen; reading that as
  // the menu would leave the panel invisible for good.
  it('reads a screen with nothing to scroll as fully revealed', () => {
    expect(revealProgress(0, null)).toBe(1)
  })

  it('finishes the trip in the direction the page was last moving', () => {
    expect(snapTarget(150, bounds, 1)).toBe(400)
    expect(snapTarget(150, bounds, -1)).toBe(0)
  })

  it('leaves a page resting on either end alone', () => {
    expect(snapTarget(0, bounds, 1)).toBeNull()
    expect(snapTarget(1.5, bounds, 1)).toBeNull()
    expect(snapTarget(400, bounds, -1)).toBeNull()
    expect(snapTarget(398.5, bounds, -1)).toBeNull()
    expect(snapTarget(100, null, 1)).toBeNull()
  })
})

describe('lounge reveal: the pieces at either end', () => {
  // The chevron is the "you can scroll down" cue, so it must be there in full
  // on the menu.
  it('shows the chevron in full on the menu and none in the lounge', () => {
    expect(chevronOpacity(0)).toBe(1)
    expect(chevronOpacity(1)).toBe(0)
  })

  // Nothing of the lit word may show on the menu: the fill starts a full
  // feather outside the word, so even the soft edge is off it.
  it('lights none of the word on the menu', () => {
    expect(headingFill(0).edgePct).toBe(-HEADING_FEATHER)
    expect(headingMask(0)).toContain('transparent 0.00%')
    expect(headingGlow(0)).toBe(0)
  })

  // Still a mask at rest, one that hides nothing: taking it off and putting
  // it back on costs a compositor layer on the first frame of a glide.
  it('lights the whole word in the lounge', () => {
    expect(headingMask(1)).toBe('linear-gradient(#000, #000)')
    expect(headingGlow(1)).toBe(1)
  })

  it('fills from both ends towards the middle', () => {
    const mid = headingMask(0.35)
    expect(mid.startsWith('linear-gradient(90deg, #000 ')).toBe(true)
    expect(mid).toContain('transparent')
    expect(mid.endsWith('%)')).toBe(true)
    expect(headingFill(0.3).edgePct).toBeLessThan(headingFill(0.6).edgePct)
  })

  // As the two soft edges overlap, out-of-order gradient stops would snap; the
  // middle stop has to carry the overlapping alpha instead.
  it('keeps the gradient stops in order as the two fills meet', () => {
    for (let p = 0; p <= 1; p += 0.01) {
      const mask = headingMask(p)
      if (!mask.includes('%')) continue
      const stops = [...mask.matchAll(/(-?[\d.]+)%/g)].map(m => Number(m[1]))
      for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThanOrEqual(stops[i - 1] - 1e-9)
    }
  })

  it('has the panel hidden on the menu and settled in the lounge', () => {
    expect(panelReveal(0).opacity).toBe(0)
    // Anchored at the top and never above 1, so the panel never reaches past
    // its own foot (which once made the page taller than the chat).
    for (let p = 0; p <= 1; p += 0.05) expect(panelReveal(p).scale).toBeLessThanOrEqual(1)
    expect(panelReveal(1)).toMatchObject({ done: true, opacity: 1, scale: 1, scanOpacity: 0 })
  })
})
