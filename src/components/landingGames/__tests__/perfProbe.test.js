import { describe, it, expect } from 'vitest'
import { createFpsSampler, scanCanvases, summariseCanvases, formatReport } from '../perfProbe'

// The probe decides whether the game wall gets rebuilt, so its arithmetic had
// better be right.

describe('createFpsSampler', () => {
  it('reports a steady 60Hz stream as 60fps with no drops', () => {
    const s = createFpsSampler()
    for (let i = 0; i <= 120; i++) s.frame(i * 16.67)
    const stats = s.stats()
    expect(stats.frames).toBe(120)
    expect(stats.fps).toBeCloseTo(60, 0)
    expect(stats.droppedPct).toBe(0)
  })

  it('separates the median from the hitches', () => {
    const s = createFpsSampler()
    // 90 good frames, 10 that took a quarter of a second.
    let t = 0
    for (let i = 0; i < 90; i++) { t += 16.67; s.frame(t) }
    for (let i = 0; i < 10; i++) { t += 250; s.frame(t) }
    const stats = s.stats()
    expect(stats.medianMs).toBeCloseTo(16.67, 1)   // still feels 60 most of the time
    expect(stats.worstMs).toBeCloseTo(250, 0)      // but it stutters badly
    expect(stats.droppedPct).toBeCloseTo(10, 0)
  })

  it('has nothing to say before the first two frames', () => {
    const s = createFpsSampler()
    expect(s.stats()).toBeNull()
    s.frame(0)
    expect(s.stats()).toBeNull()
  })
})

describe('scanCanvases', () => {
  function mount(specs) {
    const root = document.createElement('div')
    for (const { w, h, cssW, cssH } of specs) {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getBoundingClientRect = () => ({ width: cssW, height: cssH, top: 0, left: 0, right: cssW, bottom: cssH })
      root.appendChild(c)
    }
    document.body.appendChild(root)
    return root
  }

  it('measures a canvas rendering more pixels than it displays', () => {
    // A 672x504 canvas at devicePixelRatio 2, shown 240px wide in a demo tile.
    const root = mount([{ w: 1344, h: 1008, cssW: 240, cssH: 180 }])
    const [c] = scanCanvases(root)
    expect(c.bufferPx).toBe(1344 * 1008)
    expect(c.overdraw).toBeCloseTo((1344 * 1008) / (240 * 180), 1)
    root.remove()
  })

  it('totals the whole wall', () => {
    const root = mount([
      { w: 600, h: 400, cssW: 300, cssH: 200 },
      { w: 600, h: 400, cssW: 300, cssH: 200 },
    ])
    const sum = summariseCanvases(scanCanvases(root))
    expect(sum.contexts).toBe(2)
    expect(sum.bufferMPx).toBeCloseTo(0.48, 2)
    expect(sum.overdraw).toBeCloseTo(4, 5)
    root.remove()
  })

  it('says nothing is on the page when nothing is', () => {
    const sum = summariseCanvases([])
    expect(sum).toEqual({ contexts: 0, bufferMPx: 0, screenMPx: 0, overdraw: 0 })
  })
})

describe('formatReport', () => {
  it('lays the stages out as one pasteable block', () => {
    const row = {
      live: 9, fps: 22, medianMs: 45, p95Ms: 90, worstMs: 310, droppedPct: 41,
      contexts: 4, bufferMPx: 5.4, screenMPx: 0.28, overdraw: 19.3, longTasksPerS: 2.4,
    }
    const out = formatReport([row, { ...row, live: 0, fps: 60, contexts: 0 }], { dpr: 2, vw: 1440, vh: 900 })
    expect(out).toContain('device pixel ratio 2')
    expect(out.split('\n')).toHaveLength(4)   // env + header + two stages
    expect(out).toContain('19.3')
  })
})
