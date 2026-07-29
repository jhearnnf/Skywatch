import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatCut from '../CbatCut'
import { press, START_SELECTOR, ANSWER_SELECTOR } from '../../components/landingGames/demoDriver'
import { CbatDemoContext } from '../../utils/cbat/demoMode'

// Swapping which system each display shows is the whole game — a real player
// does it constantly. The landing page's demo driver can only press controls
// carrying `data-demo-answer`, so without it on the display index a demo card
// sat on Message + Engine for its entire run.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// `demo` mirrors the real harness, which mounts every demo game inside
// CbatDemoContext.Provider — the page skips its pre-game difficulty flash there,
// so the driver's Start press lands straight in the game rather than sitting on
// a dimmed card for a second of a short loop.
function startedGame({ demo = true } = {}) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  const view = demo
    ? render(<CbatDemoContext.Provider value={{ portalTarget: null }}><CbatCut /></CbatDemoContext.Provider>)
    : render(<CbatCut />)
  act(() => { press(view.container.querySelector(START_SELECTOR)) })
  if (!demo) act(() => { vi.advanceTimersByTime(1100) })   // launch flash
  return view
}

describe('CUT — driveable by the demo wall', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('exposes the display index to the driver', () => {
    const { container } = startedGame()
    const labels = [...container.querySelectorAll(ANSWER_SELECTOR)].map(b => b.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Navigation', 'Sensor', 'Mission', 'System']))
  })

  it('changes what a display shows when the driver presses one', () => {
    const { container } = startedGame()
    // Display 1 opens on Message; nothing from Navigation is on screen.
    expect(screen.queryByText('Required')).toBeNull()

    const nav = [...container.querySelectorAll(ANSWER_SELECTOR)].find(b => b.textContent === 'Navigation')
    act(() => { press(nav) })

    expect(screen.getAllByText('Required').length).toBeGreaterThan(0)
  })

  // The column is a fixed 300px of a 900px stage — a third of the tile spent on
  // a score log nobody can read at that size.
  it('starts with the commentary column minimised in a tile', () => {
    localStorage.setItem('cbat:cut:commentary', '1')
    startedGame()

    expect(screen.getByTitle('Show commentary')).toBeTruthy()
  })

  // A demo tile has a few seconds of attention; a second of dimmed card before
  // anything moves is a second wasted.
  it('skips the pre-game difficulty flash in a tile', () => {
    const { container } = startedGame()
    // Straight into the game — the display index is live with no clock advance.
    expect(container.querySelectorAll(ANSWER_SELECTOR).length).toBeGreaterThan(0)
  })

  it('respects the saved preference for a real player', () => {
    localStorage.setItem('cbat:cut:commentary', '1')
    const { container } = startedGame({ demo: false })
    expect(container.querySelector('[title="Show commentary"]')).toBeNull()
    expect(screen.getByTitle('Minimise')).toBeTruthy()
  })
})
