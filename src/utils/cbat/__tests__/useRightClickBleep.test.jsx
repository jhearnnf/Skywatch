import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useRightClickBleep } from '../useRightClickBleep'

// Right-click is ACT's second route to BLEEP: on a mouse you steer by dragging
// the tunnel, so the cursor is nowhere near the button when a bleep fires.

const RIGHT = 2
const LEFT = 0

const press = (button, type = 'pointerdown') => {
  const e = new window.MouseEvent(type, { button, bubbles: true, cancelable: true })
  window.dispatchEvent(e)
  return e
}

afterEach(() => vi.clearAllMocks())

describe('useRightClickBleep', () => {
  it('fires the bleep on a right-button press anywhere', () => {
    const onBleep = vi.fn()
    renderHook(() => useRightClickBleep({ onBleep }))
    press(RIGHT)
    expect(onBleep).toHaveBeenCalledTimes(1)
  })

  it('leaves the left button alone — it is the steer drag', () => {
    const onBleep = vi.fn()
    renderHook(() => useRightClickBleep({ onBleep }))
    press(LEFT)
    press(1)   // middle
    expect(onBleep).not.toHaveBeenCalled()
  })

  it('scores every right-click, with no debounce', () => {
    const onBleep = vi.fn()
    renderHook(() => useRightClickBleep({ onBleep }))
    press(RIGHT)
    press(RIGHT)
    press(RIGHT)
    // Spam-clicking has to keep costing false-alarm points, exactly as it
    // does on the button itself.
    expect(onBleep).toHaveBeenCalledTimes(3)
  })

  it('suppresses the context menu while a round is up', () => {
    renderHook(() => useRightClickBleep({ onBleep: vi.fn() }))
    const e = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('does not score while disabled, but still swallows the menu', () => {
    const onBleep = vi.fn()
    renderHook(() => useRightClickBleep({ onBleep, disabled: true }))
    press(RIGHT)
    expect(onBleep).not.toHaveBeenCalled()
    const e = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('reports the release so the button can flash', () => {
    const onRelease = vi.fn()
    renderHook(() => useRightClickBleep({ onBleep: vi.fn(), onRelease }))
    press(RIGHT, 'pointerup')
    expect(onRelease).toHaveBeenCalledTimes(1)
    press(LEFT, 'pointerup')
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('lets the context menu back once the round unmounts', () => {
    const onBleep = vi.fn()
    const { unmount } = renderHook(() => useRightClickBleep({ onBleep }))
    unmount()
    press(RIGHT)
    expect(onBleep).not.toHaveBeenCalled()
    const e = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
  })
})
