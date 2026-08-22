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

// A chorded press: a button changing state while another is already held. The
// spec fires these as pointermove, not pointerdown/pointerup — `button` names
// the button that changed, `buttons` is the bitmask of what is down now.
const LEFT_HELD = 1
const RIGHT_BIT = 2
const chord = (buttons) => {
  window.dispatchEvent(new window.MouseEvent('pointermove', {
    button: RIGHT, buttons, bubbles: true, cancelable: true,
  }))
}
const move = () => {
  window.dispatchEvent(new window.MouseEvent('pointermove', {
    button: -1, buttons: LEFT_HELD, bubbles: true, cancelable: true,
  }))
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

  // The case this exists for: steering IS the left button held down, so every
  // right-click made while flying is a chord and never fires a pointerdown.
  it('fires while the left button is held for a steer drag', () => {
    const onBleep = vi.fn()
    renderHook(() => useRightClickBleep({ onBleep }))
    chord(LEFT_HELD | RIGHT_BIT)
    expect(onBleep).toHaveBeenCalledTimes(1)
  })

  it('treats the chorded release as a release, not a second bleep', () => {
    const onBleep = vi.fn()
    const onRelease = vi.fn()
    renderHook(() => useRightClickBleep({ onBleep, onRelease }))
    chord(LEFT_HELD | RIGHT_BIT)
    chord(LEFT_HELD)
    expect(onBleep).toHaveBeenCalledTimes(1)
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('ignores the ordinary moves of a steer drag', () => {
    const onBleep = vi.fn()
    const onRelease = vi.fn()
    renderHook(() => useRightClickBleep({ onBleep, onRelease }))
    move(); move(); move()
    expect(onBleep).not.toHaveBeenCalled()
    expect(onRelease).not.toHaveBeenCalled()
  })

  it('does not score a chorded press while disabled', () => {
    const onBleep = vi.fn()
    renderHook(() => useRightClickBleep({ onBleep, disabled: true }))
    chord(LEFT_HELD | RIGHT_BIT)
    expect(onBleep).not.toHaveBeenCalled()
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
