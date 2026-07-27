import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import DemoGameCard from '../DemoGameCard'

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
