import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLoungeScrollSnap } from '../useLoungeScrollSnap'

// A page 2000px tall in an 800px window: the lounge (the page's foot) is at
// scrollY 1200, and the menu's resting point is where the panel, whose top
// sits 1000px down the page, first enters the bottom of the screen: 200.
const PANEL_TOP = 1000
const END = 1200
const START = 200

let scrollY = 0
let scrollTo

function setScroll(y) {
  scrollY = y
  window.dispatchEvent(new Event('scroll'))
}

function mount() {
  const panel = document.createElement('div')
  panel.getBoundingClientRect = () => ({ top: PANEL_TOP - scrollY, bottom: PANEL_TOP - scrollY + 600, height: 600 })
  document.body.appendChild(panel)
  const panelRef = { current: panel }
  const hook = renderHook(() => useLoungeScrollSnap({ enabled: true, panelRef, landmarkRef: { current: null } }))
  return { panel, ...hook }
}

// Where the last glide (or jump) put the page.
const lastTop = () => scrollTo.mock.calls.at(-1)?.[0]?.top

beforeEach(() => {
  vi.useFakeTimers()
  scrollY = 0
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 })
  scrollTo = vi.fn(({ top }) => { scrollY = top })
  window.scrollTo = scrollTo
  // Every glide frame lands a second later, so a glide finishes in one frame.
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => setTimeout(() => { now += 1000; cb(now) }, 0))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => clearTimeout(id))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('useLoungeScrollSnap: staying in the lounge', () => {
  it('puts the page back in the lounge when the keyboard closing nudges it up', () => {
    mount()
    setScroll(END)
    // The keyboard goes away after a tap on Send: no finger is moving the
    // page, but the scroll position drops a little as the screen grows.
    window.dispatchEvent(new Event('touchstart'))
    window.dispatchEvent(new Event('touchend'))
    setScroll(END - 50)
    vi.advanceTimersByTime(500)
    expect(lastTop()).toBe(END)
  })

  it('re-pins the page to the lounge when the window resizes under it', () => {
    mount()
    setScroll(END)
    scrollY = END - 80 // the keyboard opening, before any scroll event
    window.dispatchEvent(new Event('resize'))
    expect(lastTop()).toBe(END)
  })

  it('still lets a finger take the page out of the lounge to the menu', () => {
    mount()
    setScroll(END)
    window.dispatchEvent(new Event('touchstart'))
    setScroll(END - 100)
    window.dispatchEvent(new Event('touchend'))
    vi.advanceTimersByTime(500)
    expect(lastTop()).toBe(START)
    // And once on the menu, a resize does not drag it back down.
    scrollTo.mockClear()
    window.dispatchEvent(new Event('resize'))
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
