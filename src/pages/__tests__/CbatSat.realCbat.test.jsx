import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatSat from '../CbatSat'
import { press, START_SELECTOR } from '../../components/landingGames/demoDriver'
import { submitCbatResult } from '../../lib/cbatOutbox'

// Under the Real CBAT theme SAT asks the real test's way: an in-game clock on
// the console, about half the questions typed in, the rest with up to 8
// options. A run must still land on the same board with the same total.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children, gameKey }) => <div data-game-key={gameKey}>{children}</div> }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../utils/cbat/satSpeech', () => ({
  speak: vi.fn(), stopSpeech: vi.fn(), primeSpeech: vi.fn(),
}))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function renderCbat() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', uiTheme: 'cbat' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  return render(<CbatSat />)
}

const key = (k) => act(() => { fireEvent.keyDown(window, { key: k }) })

describe('SAT — Real CBAT theme', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('shows the in-game clock and the full console from Easier up', () => {
    const { container } = renderCbat()
    act(() => { press(container.querySelector(START_SELECTOR)) })
    act(() => { vi.advanceTimersByTime(1100) })

    const clock = container.querySelector('[data-sat-clock]')
    expect(clock.textContent).toMatch(/^\d\d:\d\d:\d\d$/)
    const before = clock.textContent
    act(() => { vi.advanceTimersByTime(2000) })
    expect(container.querySelector('[data-sat-clock]').textContent).not.toBe(before)

    // Real CBAT Easier is the console layout, not the bare card.
    expect(screen.getByText('Controller Aircraft')).toBeTruthy()
  })

  it('mixes typed and 8-option questions and submits to the same board', () => {
    const { container } = renderCbat()
    act(() => { press(container.querySelector(START_SELECTOR)) })
    act(() => { vi.advanceTimersByTime(1100) })

    let typed = 0
    let sawEightOptions = false
    for (let s = 0; s < 2; s++) {
      act(() => { vi.advanceTimersByTime(90_000) }) // observe window
      for (let q = 0; q < 5; q++) {
        const entry = container.querySelector('[data-sat-entry]')
        if (entry) {
          typed++
          expect(entry.textContent).toMatch(/_/)
          key('1')
          expect(container.querySelector('[data-sat-entry]').textContent).toMatch(/1/)
          key('Enter')
        } else {
          if (container.querySelectorAll('.cbat-keycap').length >= 8) sawEightOptions = true
          key('1')
          key('Enter')
        }
      }
    }

    // 40-60% of each 5-question situation: 2 or 3 apiece.
    expect(typed).toBeGreaterThanOrEqual(4)
    expect(typed).toBeLessThanOrEqual(6)
    expect(sawEightOptions).toBe(true)

    expect(submitCbatResult).toHaveBeenCalledTimes(1)
    const [gameKey, payload] = submitCbatResult.mock.calls[0]
    expect(gameKey).toBe('sat-easier')
    expect(payload.totalQuestions).toBe(10)
  })
})
