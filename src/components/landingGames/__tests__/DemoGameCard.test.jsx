import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import DemoGameCard from '../DemoGameCard'
import { frameFor } from '../demoFraming'

// The card mounts a real game, so everything below it is stubbed out — these
// tests are about the frame: what it links to, what it exposes to the page, and
// how it behaves when the game inside won't cooperate.
vi.mock('../demoHarness', () => ({ default: ({ children }) => <div>{children}</div> }))

const entry = {
  id: 'sat',
  label: 'SAT',
  gameKey: 'sat',
  path: '/cbat/sat',
  poster: '/images/SAT.png',
  answerIntervalMs: 0,
}

const StubGame = () => <button data-demo-start>Start</button>
const ExplodingGame = () => { throw new Error('boom') }

function renderCard(props = {}) {
  return render(
    <MemoryRouter>
      <DemoGameCard entry={entry} Component={StubGame} {...props} />
    </MemoryRouter>,
  )
}

describe('DemoGameCard', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('sends logged-out visitors to register, not into the game', () => {
    renderCard({ loggedIn: false })
    expect(screen.getByRole('link').getAttribute('href')).toBe('/login?tab=register')
  })

  it('sends signed-in visitors straight to the game', () => {
    renderCard({ loggedIn: true })
    expect(screen.getByRole('link').getAttribute('href')).toBe('/cbat/sat')
  })

  it('names the mode when the tile is showing one of several', () => {
    // /cbat/trace opens on whichever mode was last played, so a Trace Practise
    // 3D tile that linked to the bare path could land you in Trace 1.
    const traceEntry = { ...entry, id: 'plane-turn-3d', path: '/cbat/trace', props: { forcedMode: '3d' } }
    render(
      <MemoryRouter>
        <DemoGameCard entry={traceEntry} Component={StubGame} loggedIn />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link').getAttribute('href')).toBe('/cbat/trace?mode=3d')
  })

  it('leaves single-mode games with a plain path', () => {
    renderCard({ loggedIn: true })
    expect(screen.getByRole('link').getAttribute('href')).not.toContain('?mode=')
  })

  it('keeps the link out of the game’s ancestry', () => {
    // The driver clicks inside the mounted game and those clicks bubble. If the
    // link wrapped the stage, every bot press would navigate the visitor into a
    // random game — which is exactly what it did before this was a sibling.
    const { container } = renderCard()
    act(() => { vi.advanceTimersByTime(500) })
    const link = container.querySelector('a')
    const stage = container.querySelector('[inert]')
    expect(stage).not.toBeNull()
    expect(link.contains(stage)).toBe(false)
  })

  it('hides the running game from assistive tech and the tab order', () => {
    const { container } = renderCard()
    act(() => { vi.advanceTimersByTime(500) })
    const stage = container.querySelector('[inert]')
    expect(stage.getAttribute('aria-hidden')).toBe('true')
  })

  it('does not mount the game until the card is in view', () => {
    const { container } = renderCard({ active: false })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(container.querySelector('[inert]')).toBeNull()
  })

  it('falls back to the poster when the game throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <MemoryRouter>
        <DemoGameCard entry={entry} Component={ExplodingGame} />
      </MemoryRouter>,
    )
    act(() => { vi.advanceTimersByTime(500) })
    const poster = container.querySelector('img')
    expect(poster.getAttribute('src')).toBe('/images/SAT.png')
    expect(poster.style.opacity).toBe('1')
    expect(container.querySelector('[inert]')).toBeNull()
  })

  it('shows the poster until the game is actually running', () => {
    const { container } = renderCard()
    expect(container.querySelector('img').style.opacity).toBe('1')
  })
})

describe('frameFor', () => {
  const DESKTOP = { w: 900, h: 600 }
  const PHONE   = { w: 430, h: 560 }
  // The Trace practise arena: a 448px square sitting below the header + HUD.
  const BOARD   = { w: 448, h: 448, top: 48 }

  it('leaves a game alone when it declares no focus', () => {
    expect(frameFor(DESKTOP, undefined)).toEqual({ zoom: 1, offsetY: 0 })
  })

  it('zooms a narrow game up until its focus fills the stage', () => {
    const { zoom } = frameFor(DESKTOP, BOARD)
    // Height is the binding constraint: 600 / 448.
    expect(zoom).toBeCloseTo(600 / 448, 5)
    // Which is what takes the board from half the card's width to two thirds.
    expect((BOARD.w * zoom) / DESKTOP.w).toBeCloseTo(0.667, 2)
  })

  it('lifts the stage so the focus box is centred, not the page header', () => {
    const { zoom, offsetY } = frameFor(DESKTOP, BOARD)
    const visibleH = DESKTOP.h / zoom
    // The visible slice starts at the top of the board and ends at its bottom.
    expect(offsetY).toBeCloseTo(BOARD.top, 5)
    expect(offsetY + visibleH).toBeCloseTo(BOARD.top + BOARD.h, 5)
  })

  it('never crops: the offset stays inside the stage', () => {
    const { zoom, offsetY } = frameFor(DESKTOP, { w: 448, h: 448, top: 400 })
    expect(offsetY).toBeGreaterThanOrEqual(0)
    expect(offsetY + DESKTOP.h / zoom).toBeLessThanOrEqual(DESKTOP.h + 1e-9)
  })

  it('does nothing on the phone stage, where the same game already fills it', () => {
    expect(frameFor(PHONE, BOARD)).toEqual({ zoom: 1, offsetY: 0 })
  })
})
