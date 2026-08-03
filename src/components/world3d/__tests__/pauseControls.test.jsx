import { render, cleanup, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pause } from '../state/pauseStore'
import { usePauseControls } from '../state/usePauseControls'

// Escape reaches us by two different routes depending on the pointer, and both can fire for
// the same press — these pin that a press always ends with the menu in the right state.

function Harness() {
  usePauseControls()
  return null
}

// Drive document.pointerLockElement + fire the change event the hook listens for.
function setLock(el) {
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => el })
  act(() => { document.dispatchEvent(new Event('pointerlockchange')) })
}

function pressEscape() {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })) })
}

beforeEach(() => {
  pause.set(false)
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null })
})
afterEach(() => { cleanup(); pause.set(false) })

describe('hangar pause controls', () => {
  it('pauses when the pointer lock is released (Escape while locked)', () => {
    render(<Harness />)
    const el = document.createElement('div')
    setLock(el)
    expect(pause.get()).toBe(false)

    setLock(null)
    expect(pause.get()).toBe(true)
  })

  // The race that would otherwise open and instantly close the menu: engines differ on
  // whether the Escape keydown is delivered as well as the lock release.
  it('ignores the keydown that accompanies the same lock release', () => {
    render(<Harness />)
    const el = document.createElement('div')
    setLock(el)
    setLock(null)
    expect(pause.get()).toBe(true)

    pressEscape()
    expect(pause.get()).toBe(true)
  })

  it('toggles on Escape when the pointer was never locked', () => {
    render(<Harness />)
    pressEscape()
    expect(pause.get()).toBe(true)

    pressEscape()
    expect(pause.get()).toBe(false)
  })

  it('ignores Escape while the pointer is still locked — the release drives it', () => {
    render(<Harness />)
    const el = document.createElement('div')
    setLock(el)
    pressEscape()
    expect(pause.get()).toBe(false)
  })

  it('leaves the hangar unpaused for the next visit', () => {
    const { unmount } = render(<Harness />)
    pressEscape()
    expect(pause.get()).toBe(true)

    unmount()
    expect(pause.get()).toBe(false)
  })
})
