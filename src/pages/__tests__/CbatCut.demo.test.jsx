import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatCut from '../CbatCut'
import { press, START_SELECTOR, ANSWER_SELECTOR } from '../../components/landingGames/demoDriver'

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

function startedGame() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  const view = render(<CbatCut />)
  act(() => { press(view.container.querySelector(START_SELECTOR)) })
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
})
