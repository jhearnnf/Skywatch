import { describe, it, expect } from 'vitest'
import { getDemoStageFrame } from '../demoMode'

// A demo card renders its game into a stage that is scaled (and shifted, when
// the card zooms in on part of it). Anything a game measures on screen has to
// come back through here before it can be painted inside that stage.

function stage({ left, top, width, offsetWidth }) {
  return {
    offsetWidth,
    getBoundingClientRect: () => ({ left, top, width, height: 0, right: left + width, bottom: top }),
  }
}

describe('getDemoStageFrame', () => {
  it('reports the stage origin and how far down it is scaled', () => {
    // 900px of stage painted 300px wide, starting 120px into the page.
    const frame = getDemoStageFrame(stage({ left: 120, top: 40, width: 300, offsetWidth: 900 }))
    expect(frame).toEqual({ left: 120, top: 40, scale: 1 / 3 })
  })

  it('maps a screen point back into stage pixels', () => {
    const frame = getDemoStageFrame(stage({ left: 120, top: 40, width: 300, offsetWidth: 900 }))
    // A point 30px right of the card's left edge is 90 stage-pixels in.
    expect((150 - frame.left) / frame.scale).toBe(90)
    expect((70 - frame.top) / frame.scale).toBe(90)
  })

  it('returns null outside a demo, so callers stay in screen space', () => {
    expect(getDemoStageFrame(null)).toBeNull()
    expect(getDemoStageFrame(undefined)).toBeNull()
  })

  it('returns null before the stage has been laid out', () => {
    expect(getDemoStageFrame(stage({ left: 0, top: 0, width: 0, offsetWidth: 0 }))).toBeNull()
  })
})
