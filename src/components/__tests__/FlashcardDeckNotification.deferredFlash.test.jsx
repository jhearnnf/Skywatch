import { render, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import FlashcardDeckNotification from '../FlashcardDeckNotification'

const requestPlayNavFlash = vi.hoisted(() => vi.fn())

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({
    immersive: false,
    enterImmersive: () => {},
    exitImmersive: () => {},
    pendingPlayNavFlash: false,
    requestPlayNavFlash,
    consumePlayNavFlash: () => {},
    flashcardCollectActive: false,
    enterFlashcardCollect: () => {},
    exitFlashcardCollect: () => {},
  }),
}))

// Render portal contents inline in the test container so React's unmount
// cleanup matches the DOM tree we built.
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createPortal: (node) => node }
})

// Track the latest onAnimationComplete handler in a module-level holder so
// the test can fire it directly (framer-motion's real animation never runs
// in jsdom). Each render replaces the holder with the current callback.
const animationHandlerHolder = { fire: null }

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onAnimationComplete, ...rest }) => {
      if (onAnimationComplete) animationHandlerHolder.fire = onAnimationComplete
      return <div {...rest}>{children}</div>
    },
  },
}))

const CARD_RECT = { top: 100, left: 50, width: 280, height: 64 }

beforeEach(() => {
  requestPlayNavFlash.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  // Manually-appended play elements aren't cleaned by RTL — remove between
  // tests so getPlayNavElement doesn't pick up a previous test's element.
  document.querySelectorAll('[data-nav="play"]').forEach(el => el.remove())
})

function makePlayEl({ onScreen }) {
  const el = document.createElement('button')
  el.setAttribute('data-nav', 'play')
  document.body.appendChild(el)
  // jsdom returns a zero rect by default — stub.
  el.getBoundingClientRect = () => onScreen
    ? { top: 600, bottom: 656, left: 100, right: 200, width: 100, height: 56, x: 0, y: 0, toJSON: () => ({}) }
    // bottom < 0 → off-screen above; matches the BottomNav-translated-down case
    // closely enough for the elementIsOnScreen check (bottom > 0 fails, OR top
    // > innerHeight fails). We use top > innerHeight here.
    : { top: 2000, bottom: 2056, left: 100, right: 200, width: 100, height: 56, x: 0, y: 0, toJSON: () => ({}) }
  return el
}

function fireAnimationComplete() {
  act(() => { animationHandlerHolder.fire() })
}

describe('FlashcardDeckNotification — deferred play-nav flash', () => {
  it('flashes directly when play element is on-screen', () => {
    const playEl = makePlayEl({ onScreen: true })
    const onDone = vi.fn()
    render(<FlashcardDeckNotification cardRect={CARD_RECT} onDone={onDone} />)

    fireAnimationComplete() // flying-in → showing
    act(() => { vi.advanceTimersByTime(1700) }) // showing timer → flying-out
    fireAnimationComplete() // flying-out complete (on-screen branch)

    expect(playEl.classList.contains('play-nav-flash')).toBe(true)
    expect(requestPlayNavFlash).not.toHaveBeenCalled()
  })

  it('defers when play element is off-screen (immersive translate)', () => {
    const playEl = makePlayEl({ onScreen: false })
    const onDone = vi.fn()
    render(<FlashcardDeckNotification cardRect={CARD_RECT} onDone={onDone} />)

    fireAnimationComplete() // flying-in → showing
    act(() => { vi.advanceTimersByTime(1700) }) // showing timer → flying-out
    fireAnimationComplete() // flying-out complete (off-screen branch)

    expect(playEl.classList.contains('play-nav-flash')).toBe(false)
    expect(requestPlayNavFlash).toHaveBeenCalledTimes(1)
  })
})
