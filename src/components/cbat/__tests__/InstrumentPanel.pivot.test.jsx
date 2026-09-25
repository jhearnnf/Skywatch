import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import InstrumentPanel, { Airspeed } from '../InstrumentPanel'

// Reported twice from Safari on macOS (21 and 25 Sept): needles swung off the
// face during the calibration animation and settled with their tails away from
// the middle of the dial, the attitude horizon sat in the wrong place, and the
// compass cardinals were pushed out of view. Chrome was fine.
//
// Cause: the dials rotated with a CSS transform, which pivots about
// `transform-origin` resolved against a `transform-box`. Safari's reference box
// disagreed with Chrome's under `view-box`, and the `fill-box` + pivot-square
// workaround did not hold either.
//
// The fix is to rotate with the SVG transform ATTRIBUTE, `rotate(a 50 50)`,
// which names the pivot in user-space numbers and has no reference box at all.
// These tests keep CSS transforms out of the dials: one coming back is the bug
// coming back.

const panel = (durationMs = 100) => render(
  <InstrumentPanel
    altitude={5000} airspeed={200} heading="N" vs="Ascend" turn="Standard"
    durationMs={durationMs}
  />,
).container

const rotating = (container) =>
  [...container.querySelectorAll('[transform]')]
    .filter(el => /^rotate\(/.test(el.getAttribute('transform')))

describe('InstrumentPanel — dials rotate about the centre of the face', () => {
  afterEach(() => vi.useRealTimers())

  it('uses no CSS transforms anywhere in the dials', () => {
    const container = panel()
    const styled = [...container.querySelectorAll('svg [style]')]
      .filter(el => /transform/.test(el.getAttribute('style')))
    expect(styled).toHaveLength(0)
    expect(container.innerHTML).not.toMatch(/transform-(box|origin)/)
  })

  it('rotates every dial about (50,50) with the transform attribute', () => {
    const els = rotating(panel())
    // Altimeter x2, attitude roll, airspeed, VSI, heading rose, turn silhouette.
    expect(els).toHaveLength(7)
    for (const el of els) {
      expect(el.getAttribute('transform')).toMatch(/^rotate\(-?[\d.e+-]+ 50 50\)$/)
    }
  })

  it('moves the pitch band and inclinometer ball with translate attributes', () => {
    const translated = [...panel().querySelectorAll('[transform]')]
      .filter(el => /^translate\(/.test(el.getAttribute('transform')))
    expect(translated).toHaveLength(2)
  })

  it('shows a live reading exactly, with no tween', () => {
    const { container } = render(<Airspeed knots={120} durationMs={0} />)
    expect(rotating(container)[0].getAttribute('transform')).toBe('rotate(120 50 50)')
  })

  it('settles the needle on its reading once the animation has run', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const { container } = render(<Airspeed knots={120} durationMs={500} />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(rotating(container)[0].getAttribute('transform')).toBe('rotate(120 50 50)')
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
