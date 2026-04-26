import { render, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import LearnNavFlasher from '../LearnNavFlasher'

const consumeLearnNavFlash = vi.hoisted(() => vi.fn())
const useAuthMock          = vi.hoisted(() => vi.fn())
const useChromeMock        = vi.hoisted(() => vi.fn())
const useCategoryMock      = vi.hoisted(() => vi.fn())

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: () => useCategoryMock(),
}))

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => useChromeMock(),
}))

function setMocks({ pendingLearnNavFlash = false, notifQueue = [], immersive = false } = {}) {
  useAuthMock.mockReturnValue({ notifQueue })
  useChromeMock.mockReturnValue({ immersive })
  useCategoryMock.mockReturnValue({ pendingLearnNavFlash, consumeLearnNavFlash })
}

// Insert two learn-nav elements in the DOM (Sidebar + BottomNav). Override
// getBoundingClientRect per element so the flasher can pick the visible one.
function mountNav({ sidebarVisible = false, bottomNavVisible = false, bottomNavOnScreen = true } = {}) {
  const sidebar = document.createElement('a')
  sidebar.setAttribute('data-nav', 'learn')
  sidebar.id = 'sidebar-learn'
  sidebar.getBoundingClientRect = () => sidebarVisible
    ? { width: 200, height: 40, top: 100, bottom: 140, left: 0, right: 200, x: 0, y: 100, toJSON: () => ({}) }
    : { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) }
  document.body.appendChild(sidebar)

  const bottom = document.createElement('a')
  bottom.setAttribute('data-nav', 'learn')
  bottom.id = 'bottom-learn'
  bottom.getBoundingClientRect = () => {
    if (!bottomNavVisible) {
      return { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) }
    }
    if (!bottomNavOnScreen) {
      // Translated below viewport (immersive mode)
      return { width: 80, height: 64, top: 1200, bottom: 1264, left: 0, right: 80, x: 0, y: 1200, toJSON: () => ({}) }
    }
    return { width: 80, height: 64, top: 700, bottom: 764, left: 0, right: 80, x: 0, y: 700, toJSON: () => ({}) }
  }
  document.body.appendChild(bottom)

  // Make innerHeight smaller than the off-screen top so elementIsOnScreen returns false there
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  return { sidebar, bottom }
}

beforeEach(() => {
  consumeLearnNavFlash.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: false })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('LearnNavFlasher', () => {
  it('does nothing when no flash is pending', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true })
    setMocks({ pendingLearnNavFlash: false })
    render(<LearnNavFlasher />)
    act(() => { vi.advanceTimersByTime(2000) })

    expect(sidebar.classList.contains('learn-nav-flash')).toBe(false)
    expect(bottom.classList.contains('learn-nav-flash')).toBe(false)
    expect(consumeLearnNavFlash).not.toHaveBeenCalled()
  })

  it('does not flash while notifQueue is non-empty', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true })
    setMocks({ pendingLearnNavFlash: true, notifQueue: [{ id: 'a', type: 'airstar' }] })
    render(<LearnNavFlasher />)
    act(() => { vi.advanceTimersByTime(2000) })

    expect(sidebar.classList.contains('learn-nav-flash')).toBe(false)
    expect(bottom.classList.contains('learn-nav-flash')).toBe(false)
    expect(consumeLearnNavFlash).not.toHaveBeenCalled()
  })

  it('flashes BottomNav when it is the visible nav (mobile layout)', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true })
    setMocks({ pendingLearnNavFlash: true })
    render(<LearnNavFlasher />)

    // Before buffer
    act(() => { vi.advanceTimersByTime(100) })
    expect(bottom.classList.contains('learn-nav-flash')).toBe(false)

    // After buffer (>= 320ms)
    act(() => { vi.advanceTimersByTime(300) })
    expect(bottom.classList.contains('learn-nav-flash')).toBe(true)
    expect(sidebar.classList.contains('learn-nav-flash')).toBe(false)
    expect(consumeLearnNavFlash).toHaveBeenCalledTimes(1)

    // After flash duration
    act(() => { vi.advanceTimersByTime(1300) })
    expect(bottom.classList.contains('learn-nav-flash')).toBe(false)
  })

  it('flashes Sidebar when it is the visible nav (desktop layout)', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: true, bottomNavVisible: false })
    setMocks({ pendingLearnNavFlash: true })
    render(<LearnNavFlasher />)
    act(() => { vi.advanceTimersByTime(400) })

    expect(sidebar.classList.contains('learn-nav-flash')).toBe(true)
    expect(bottom.classList.contains('learn-nav-flash')).toBe(false)
    expect(consumeLearnNavFlash).toHaveBeenCalledTimes(1)
  })

  it('does NOT consume flag when only available element is off-screen (mobile + immersive)', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true, bottomNavOnScreen: false })
    setMocks({ pendingLearnNavFlash: true, immersive: true })
    render(<LearnNavFlasher />)
    act(() => { vi.advanceTimersByTime(500) })

    expect(sidebar.classList.contains('learn-nav-flash')).toBe(false)
    expect(bottom.classList.contains('learn-nav-flash')).toBe(false)
    // Flag preserved so next render (immersive flips false) retries
    expect(consumeLearnNavFlash).not.toHaveBeenCalled()
  })

  it('flashes once chrome returns from immersive', () => {
    const { bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true, bottomNavOnScreen: false })
    setMocks({ pendingLearnNavFlash: true, immersive: true })
    const { rerender } = render(<LearnNavFlasher />)

    // First pass with element off-screen — no flash
    act(() => { vi.advanceTimersByTime(500) })
    expect(bottom.classList.contains('learn-nav-flash')).toBe(false)

    // Chrome returns: element on-screen, immersive flips false → effect re-runs
    bottom.getBoundingClientRect = () => ({ width: 80, height: 64, top: 700, bottom: 764, left: 0, right: 80, x: 0, y: 700, toJSON: () => ({}) })
    setMocks({ pendingLearnNavFlash: true, immersive: false })
    rerender(<LearnNavFlasher />)

    act(() => { vi.advanceTimersByTime(400) })
    expect(bottom.classList.contains('learn-nav-flash')).toBe(true)
    expect(consumeLearnNavFlash).toHaveBeenCalledTimes(1)
  })
})
