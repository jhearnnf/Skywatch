import { render, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import PlayNavFlasher from '../PlayNavFlasher'

const consumePlayNavFlash = vi.hoisted(() => vi.fn())
const useAuthMock         = vi.hoisted(() => vi.fn())
const useChromeMock       = vi.hoisted(() => vi.fn())
const useGameUnlockMock   = vi.hoisted(() => vi.fn())

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('../../context/NewGameUnlockContext', () => ({
  useNewGameUnlock: () => useGameUnlockMock(),
}))

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => useChromeMock(),
}))

function setMocks({ pendingPlayNavFlash = false, notifQueue = [], immersive = false, flashcardCollectActive = false } = {}) {
  useAuthMock.mockReturnValue({ notifQueue })
  useChromeMock.mockReturnValue({ immersive, flashcardCollectActive })
  useGameUnlockMock.mockReturnValue({ pendingPlayNavFlash, consumePlayNavFlash })
}

// Insert two play-nav elements (Sidebar + BottomNav). Override
// getBoundingClientRect per element so the flasher picks the visible one.
function mountNav({ sidebarVisible = false, bottomNavVisible = false, bottomNavOnScreen = true } = {}) {
  const sidebar = document.createElement('a')
  sidebar.setAttribute('data-nav', 'play')
  sidebar.id = 'sidebar-play'
  sidebar.getBoundingClientRect = () => sidebarVisible
    ? { width: 200, height: 40, top: 100, bottom: 140, left: 0, right: 200, x: 0, y: 100, toJSON: () => ({}) }
    : { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) }
  document.body.appendChild(sidebar)

  const bottom = document.createElement('a')
  bottom.setAttribute('data-nav', 'play')
  bottom.id = 'bottom-play'
  bottom.getBoundingClientRect = () => {
    if (!bottomNavVisible) {
      return { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) }
    }
    if (!bottomNavOnScreen) {
      return { width: 80, height: 64, top: 1200, bottom: 1264, left: 0, right: 80, x: 0, y: 1200, toJSON: () => ({}) }
    }
    return { width: 80, height: 64, top: 700, bottom: 764, left: 0, right: 80, x: 0, y: 700, toJSON: () => ({}) }
  }
  document.body.appendChild(bottom)

  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  return { sidebar, bottom }
}

beforeEach(() => {
  consumePlayNavFlash.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: false })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('PlayNavFlasher', () => {
  it('does nothing when no flash is pending', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true })
    setMocks({ pendingPlayNavFlash: false })
    render(<PlayNavFlasher />)
    act(() => { vi.advanceTimersByTime(2000) })

    expect(sidebar.classList.contains('play-nav-flash')).toBe(false)
    expect(bottom.classList.contains('play-nav-flash')).toBe(false)
    expect(consumePlayNavFlash).not.toHaveBeenCalled()
  })

  it('does not flash while notifQueue is non-empty', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true })
    setMocks({ pendingPlayNavFlash: true, notifQueue: [{ id: 'a', type: 'airstar' }] })
    render(<PlayNavFlasher />)
    act(() => { vi.advanceTimersByTime(2000) })

    expect(sidebar.classList.contains('play-nav-flash')).toBe(false)
    expect(bottom.classList.contains('play-nav-flash')).toBe(false)
    expect(consumePlayNavFlash).not.toHaveBeenCalled()
  })

  it('flashes BottomNav when it is the visible nav (mobile layout)', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true })
    setMocks({ pendingPlayNavFlash: true })
    render(<PlayNavFlasher />)

    act(() => { vi.advanceTimersByTime(100) })
    expect(bottom.classList.contains('play-nav-flash')).toBe(false)

    act(() => { vi.advanceTimersByTime(300) })
    expect(bottom.classList.contains('play-nav-flash')).toBe(true)
    expect(sidebar.classList.contains('play-nav-flash')).toBe(false)
    expect(consumePlayNavFlash).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(1300) })
    expect(bottom.classList.contains('play-nav-flash')).toBe(false)
  })

  it('flashes Sidebar when it is the visible nav (desktop layout)', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: true, bottomNavVisible: false })
    setMocks({ pendingPlayNavFlash: true })
    render(<PlayNavFlasher />)
    act(() => { vi.advanceTimersByTime(400) })

    expect(sidebar.classList.contains('play-nav-flash')).toBe(true)
    expect(bottom.classList.contains('play-nav-flash')).toBe(false)
    expect(consumePlayNavFlash).toHaveBeenCalledTimes(1)
  })

  it('does NOT consume flag when only available element is off-screen (mobile + immersive)', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true, bottomNavOnScreen: false })
    setMocks({ pendingPlayNavFlash: true, immersive: true })
    render(<PlayNavFlasher />)
    act(() => { vi.advanceTimersByTime(500) })

    expect(sidebar.classList.contains('play-nav-flash')).toBe(false)
    expect(bottom.classList.contains('play-nav-flash')).toBe(false)
    expect(consumePlayNavFlash).not.toHaveBeenCalled()
  })

  it('does not flash while flashcardCollectActive is true (FDN animation in progress)', () => {
    const { sidebar, bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true })
    setMocks({ pendingPlayNavFlash: true, flashcardCollectActive: true })
    render(<PlayNavFlasher />)
    act(() => { vi.advanceTimersByTime(2000) })

    expect(sidebar.classList.contains('play-nav-flash')).toBe(false)
    expect(bottom.classList.contains('play-nav-flash')).toBe(false)
    expect(consumePlayNavFlash).not.toHaveBeenCalled()
  })

  it('flashes once flashcardCollectActive flips false', () => {
    const { bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true })
    setMocks({ pendingPlayNavFlash: true, flashcardCollectActive: true })
    const { rerender } = render(<PlayNavFlasher />)

    // While FDN animation is in progress: no flash even after long wait
    act(() => { vi.advanceTimersByTime(2000) })
    expect(bottom.classList.contains('play-nav-flash')).toBe(false)
    expect(consumePlayNavFlash).not.toHaveBeenCalled()

    // FDN animation finishes → flag flips false → effect re-runs
    setMocks({ pendingPlayNavFlash: true, flashcardCollectActive: false })
    rerender(<PlayNavFlasher />)

    act(() => { vi.advanceTimersByTime(400) })
    expect(bottom.classList.contains('play-nav-flash')).toBe(true)
    expect(consumePlayNavFlash).toHaveBeenCalledTimes(1)
  })

  it('flashes once chrome returns from immersive', () => {
    const { bottom } = mountNav({ sidebarVisible: false, bottomNavVisible: true, bottomNavOnScreen: false })
    setMocks({ pendingPlayNavFlash: true, immersive: true })
    const { rerender } = render(<PlayNavFlasher />)

    act(() => { vi.advanceTimersByTime(500) })
    expect(bottom.classList.contains('play-nav-flash')).toBe(false)

    bottom.getBoundingClientRect = () => ({ width: 80, height: 64, top: 700, bottom: 764, left: 0, right: 80, x: 0, y: 700, toJSON: () => ({}) })
    setMocks({ pendingPlayNavFlash: true, immersive: false })
    rerender(<PlayNavFlasher />)

    act(() => { vi.advanceTimersByTime(400) })
    expect(bottom.classList.contains('play-nav-flash')).toBe(true)
    expect(consumePlayNavFlash).toHaveBeenCalledTimes(1)
  })
})
