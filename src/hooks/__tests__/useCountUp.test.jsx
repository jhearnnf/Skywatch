import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import useCountUp from '../useCountUp'

// A hand-driven requestAnimationFrame: frames only happen when a test asks for one, at the
// timestamp it asks for. The real thing fires ~16ms apart on the browser's clock, which is
// useless for asserting where a tween sits partway through.
function rafClock() {
  let pending = null
  vi.stubGlobal('requestAnimationFrame', (cb) => { pending = cb; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => { pending = null })
  return {
    // Deliver one frame at absolute timestamp `t`. The hook takes its first frame's timestamp
    // as time zero, so tests pass 0 first and then the elapsed ms they care about.
    frame: (t) => act(() => { const cb = pending; pending = null; cb?.(t) }),
    get idle() { return pending === null },
  }
}

describe('useCountUp', () => {
  let clock
  beforeEach(() => { clock = rafClock() })
  afterEach(() => vi.unstubAllGlobals())

  it('starts at `from` and lands exactly on `to`', () => {
    const { result } = renderHook(() => useCountUp(420, { from: 180, duration: 600 }))
    expect(result.current).toBe(180)

    clock.frame(0)
    expect(result.current).toBe(180)   // no time has passed yet

    clock.frame(600)
    // Must be the real number, not 419 from an eased approximation — this value is read as the
    // user's weekly total once it settles.
    expect(result.current).toBe(420)
  })

  it('holds `from` for the whole delay, then moves', () => {
    const { result } = renderHook(() => useCountUp(420, { from: 180, duration: 600, delay: 450 }))

    clock.frame(0)
    clock.frame(300)
    expect(result.current).toBe(180)   // still inside the hold

    clock.frame(449)
    expect(result.current).toBe(180)   // right up to the last moment of it

    clock.frame(750)                   // 300ms into the 600ms tween
    expect(result.current).toBeGreaterThan(180)
    expect(result.current).toBeLessThan(420)
  })

  it('eases out — more of the distance is covered in the first half than the second', () => {
    const { result } = renderHook(() => useCountUp(1000, { from: 0, duration: 600 }))
    clock.frame(0)
    clock.frame(300)
    expect(result.current).toBeGreaterThan(500)
  })

  it('counts down as happily as up', () => {
    const { result } = renderHook(() => useCountUp(100, { from: 250, duration: 600 }))
    clock.frame(0)
    clock.frame(600)
    expect(result.current).toBe(100)
  })

  it('handles a negative target (games whose score can go below zero)', () => {
    const { result } = renderHook(() => useCountUp(-50, { duration: 600 }))
    clock.frame(0)
    clock.frame(600)
    expect(result.current).toBe(-50)
  })

  it('stops scheduling frames once it arrives', () => {
    renderHook(() => useCountUp(420, { from: 180, duration: 600 }))
    clock.frame(0)
    clock.frame(600)
    expect(clock.idle).toBe(true)
  })

  it('sits still when there is nothing to animate', () => {
    const { result } = renderHook(() => useCountUp(300, { from: 300, duration: 600 }))
    clock.frame(0)
    clock.frame(300)
    expect(result.current).toBe(300)
  })

  it('cancels its frame on unmount rather than setting state on a dead component', () => {
    const { unmount } = renderHook(() => useCountUp(420, { from: 180, duration: 600 }))
    clock.frame(0)
    unmount()
    expect(clock.idle).toBe(true)
  })
})
