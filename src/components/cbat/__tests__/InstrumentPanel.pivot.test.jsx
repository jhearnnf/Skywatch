import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import InstrumentPanel from '../InstrumentPanel'

// Reported from Safari on macOS (21 Sept): needles swung off the face during
// the calibration animation and settled with their tails away from the middle
// of the dial, the attitude horizon sat in the wrong place, and the compass
// cardinals were pushed out of view. Chrome was fine.
//
// Cause: the dials rotated with `transform-origin: 50px 50px` + `transform-box:
// view-box`. Chrome resolves that against the viewBox, so 50,50 is the face
// centre; Safari measures the element's own bounding box instead, putting the
// pivot most of a face away from where it belonged.
//
// The fix is to rotate about `fill-box` + `50% 50%`, which every browser agrees
// on, and give each rotating group an invisible square centred on (50,50) so
// its bounding box centre IS the face centre. These tests hold that pairing
// together: a rotation without its pivot square is the bug coming back.

const panel = () => render(
  <InstrumentPanel
    altitude={5000} airspeed={200} heading="N" vs="Ascend" turn="Standard"
    durationMs={100}
  />,
).container

const rotating = (container) =>
  [...container.querySelectorAll('[style]')]
    .filter(el => /\brotate\(/.test(el.getAttribute('style') || ''))

describe('InstrumentPanel — dials rotate about the centre of the face', () => {
  it('rotates every dial about fill-box 50% 50%, never view-box', () => {
    const container = panel()
    const els = rotating(container)
    // Altimeter x2, attitude roll, airspeed, VSI, heading rose, turn silhouette.
    expect(els).toHaveLength(7)

    for (const el of els) {
      const style = el.getAttribute('style')
      expect(style).toMatch(/transform-box:\s*fill-box/)
      expect(style).toMatch(/transform-origin:\s*50%\s+50%/)
    }
    expect(container.innerHTML).not.toMatch(/view-box/)
  })

  it('gives every rotating group a pivot square centred on the face', () => {
    for (const el of rotating(panel())) {
      const rect = el.querySelector(':scope > rect[width="200"]')
      expect(rect, `missing pivot rect in ${el.getAttribute('style')}`).not.toBeNull()

      // The square must be symmetric about (50,50) — that is the whole point
      // of it, and an off-centre one silently reintroduces the Safari bug.
      const num = (a) => Number(rect.getAttribute(a))
      expect(num('x') + num('width') / 2).toBe(50)
      expect(num('y') + num('height') / 2).toBe(50)

      // Invisible: it exists only to fix the bounding box.
      expect(rect.getAttribute('fill')).toBe('none')
    }
  })

  it('leaves translate-only elements without a pivot, which they do not need', () => {
    const container = panel()
    const translated = [...container.querySelectorAll('[style]')]
      .filter(el => /\btranslate[XY]\(/.test(el.getAttribute('style') || ''))
    // The attitude pitch group and the turn coordinator's inclinometer ball.
    expect(translated).toHaveLength(2)
    for (const el of translated) {
      expect(el.getAttribute('style')).not.toMatch(/transform-origin/)
    }
  })
})

describe('InstrumentPanel — the six faces do not share ids', () => {
  it('scopes the gradient and clip ids per instrument', () => {
    const ids = [...panel().querySelectorAll('[id]')].map(el => el.getAttribute('id'))
    expect(ids.length).toBeGreaterThan(1)
    expect(new Set(ids).size).toBe(ids.length)
    // References must point at the scoped id, not the bare one.
    expect(ids.some(id => id.startsWith('faceBg-'))).toBe(true)
    expect(ids.some(id => id.startsWith('attClip-'))).toBe(true)
  })
})

describe('InstrumentPanel — the attitude ball stays covered', () => {
  it('keeps sky and ground covering the ball at full pitch and roll', () => {
    const container = panel()
    const clip = container.querySelector('clipPath circle')
    const cy = Number(clip.getAttribute('cy'))
    const r = Number(clip.getAttribute('r'))
    const MAX_PITCH = 12  // AttitudeIndicator's Ascend/Descend deflection

    const sky = container.querySelector('rect[fill="#1d5fa8"]')
    const ground = container.querySelector('rect[fill="#6b4a2a"]')
    const top = (el) => Number(el.getAttribute('y'))
    const bottom = (el) => top(el) + Number(el.getAttribute('height'))

    // Pitch slides the pair by MAX_PITCH, so each must overhang the clip circle
    // by at least that much or page background shows through inside the ball.
    expect(top(sky)).toBeLessThanOrEqual(cy - r - MAX_PITCH)
    expect(bottom(ground)).toBeGreaterThanOrEqual(cy + r + MAX_PITCH)
    // They must still meet exactly on the horizon, with no gap or overlap.
    expect(bottom(sky)).toBe(top(ground))

    // Roll turns them, so they have to overhang sideways too.
    for (const el of [sky, ground]) {
      const x = Number(el.getAttribute('x'))
      expect(x).toBeLessThanOrEqual(50 - r)
      expect(x + Number(el.getAttribute('width'))).toBeGreaterThanOrEqual(50 + r)
    }
  })
})
