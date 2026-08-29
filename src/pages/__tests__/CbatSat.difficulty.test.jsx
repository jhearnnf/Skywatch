import { render, screen, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatSat from '../CbatSat'
import { press, START_SELECTOR } from '../../components/landingGames/demoDriver'
import { CbatDemoContext } from '../../utils/cbat/demoMode'
import { submitCbatResult } from '../../lib/cbatOutbox'

// SAT ships an Easier/Hard split. The thing worth pinning is that a run only
// ever reaches the board belonging to the difficulty it was actually played at —
// Easier asks 10 questions where Hard asks 18, so a misrouted score doesn't just
// rank wrongly, it can post a number the other board can't reach.

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

function renderPage({ demo = false } = {}) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  return demo
    ? render(<CbatDemoContext.Provider value={{ portalTarget: null }}><CbatSat /></CbatDemoContext.Provider>)
    : render(<CbatSat />)
}

const difficultyButton = (container, key) => container.querySelector(`[data-difficulty="${key}"]`)

describe('SAT — difficulty selection', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('opens on Easier with both difficulties offered', () => {
    const { container } = renderPage()
    expect(difficultyButton(container, 'easier').getAttribute('aria-pressed')).toBe('true')
    expect(difficultyButton(container, 'hard').getAttribute('aria-pressed')).toBe('false')
  })

  it('states the run length of whichever difficulty is selected', () => {
    const { container } = renderPage()
    expect(screen.getByText(/2 situations · 10 questions total/)).toBeTruthy()

    act(() => { press(difficultyButton(container, 'hard')) })
    expect(screen.getByText(/3 situations · 18 questions total/)).toBeTruthy()
  })

  it('points the leaderboard link at the selected difficulty\'s board', () => {
    const { container } = renderPage()
    expect(screen.getByText(/View Leaderboard/).getAttribute('href')).toBe('/cbat/sat-easier/leaderboard')

    act(() => { press(difficultyButton(container, 'hard')) })
    expect(screen.getByText(/View Leaderboard/).getAttribute('href')).toBe('/cbat/sat/leaderboard')
  })

  it('remembers the last difficulty played', () => {
    const { container, unmount } = renderPage()
    act(() => { press(difficultyButton(container, 'hard')) })
    unmount()

    const second = renderPage()
    expect(difficultyButton(second.container, 'hard').getAttribute('aria-pressed')).toBe('true')
  })

  it('flashes the chosen difficulty before starting, and marks the run', () => {
    const { container } = renderPage()
    act(() => { press(container.querySelector(START_SELECTOR)) })

    // Still on the instructions card, dimmed, for the length of the flash.
    expect(screen.queryByText(/Memorise the picture/)).toBeNull()
    act(() => { vi.advanceTimersByTime(1100) })

    expect(screen.getByText(/Memorise the picture/)).toBeTruthy()
    expect(container.querySelector('[data-difficulty-marker="easier"]')).toBeTruthy()
  })

  // A demo tile has a few seconds of attention; a second of dimmed card before
  // anything moves is a second wasted.
  it('skips the pre-game flash in a demo tile', () => {
    renderPage({ demo: true })
    act(() => { press(document.querySelector(START_SELECTOR)) })
    expect(screen.getByText(/Memorise the picture/)).toBeTruthy()
  })
})

describe('SAT — observe layouts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  const startAt = (container, key) => {
    if (key) act(() => { press(difficultyButton(container, key)) })
    act(() => { press(container.querySelector(START_SELECTOR)) })
    act(() => { vi.advanceTimersByTime(1100) })
  }

  const AIRCRAFT_FIELD_LABELS = ['Next Waypoint', 'Next Waypoint At', 'Altitude', 'Comms Channel']

  it('gives the fact a screen to itself on Easier', () => {
    const { container } = renderPage()
    startAt(container)
    // No console around it — the aircraft panel and the radio ticker only exist
    // on the card that is currently up.
    expect(screen.queryByText('Controller Aircraft')).toBeNull()
  })

  it('keeps the whole console on screen on Hard', () => {
    const { container } = renderPage()
    startAt(container, 'hard')

    expect(screen.getByText('Controller Aircraft')).toBeTruthy()
    expect(screen.getByText('Radio')).toBeTruthy()
    // Every field box is present from the first card, whether or not it holds a
    // value — an idle panel that collapsed would reflow the console every 2.5s.
    for (const label of AIRCRAFT_FIELD_LABELS) expect(screen.getByText(label)).toBeTruthy()
  })

  // The point of the rebuild: the console is all there, but only ever one thing
  // in it is live. If two facts were ever readable at once we would be back to
  // the divided-attention test this replaced.
  it('lights exactly one fact at a time on Hard', () => {
    const { container } = renderPage()
    startAt(container, 'hard')

    const liveCount = () => {
      const plotted = container.querySelectorAll('svg circle').length
      const fields = [...container.querySelectorAll('dd')].filter(d => d.textContent !== '—').length
      const radio = container.querySelector('[data-radio-line]').textContent === '—' ? 0 : 1
      return plotted + fields + radio
    }

    // Hard's shortest queue is 13 facts, so 12 steps stay inside the window.
    for (let i = 0; i < 12; i++) {
      expect(liveCount(), `card ${i + 1}`).toBe(1)
      act(() => { vi.advanceTimersByTime(3500) })
    }
  })

  it('counts the facts down on both layouts', () => {
    const { container } = renderPage()
    startAt(container)
    expect(screen.getByText(/^Fact 1 \/ \d+$/)).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByText(/^Fact 2 \/ \d+$/)).toBeTruthy()
  })
})

describe('SAT — a run reaches only its own board', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  // Play a whole run out by letting every clock expire: the observe window, then
  // each question's timer. Timeouts count as wrong, which is fine — this is about
  // where the score is sent, not what it is.
  function playOut(container, situations, questionsPer) {
    for (let s = 0; s < situations; s++) {
      // The observe window is now the card queue's length x the difficulty's
      // dwell, so it varies per situation. 90s clears the longest possible one
      // (Hard's 21 cards at 2.5s).
      act(() => { vi.advanceTimersByTime(90_000) })       // observe window
      for (let q = 0; q < questionsPer; q++) {
        act(() => { vi.advanceTimersByTime(22_500) })     // question timer expires
        // The reveal waits for a click; advancing the clock further would just
        // idle. Pressing Next is a separate commit from the timeout above.
        act(() => { press(screen.getByRole('button', { name: /Next|See Results/ })) })
      }
    }
  }

  it('submits an Easier run to the easier board, scored out of 10', () => {
    const { container } = renderPage()
    act(() => { press(container.querySelector(START_SELECTOR)) })
    act(() => { vi.advanceTimersByTime(1100) })

    playOut(container, 2, 5)

    expect(submitCbatResult).toHaveBeenCalledTimes(1)
    const [gameKey, payload] = submitCbatResult.mock.calls[0]
    expect(gameKey).toBe('sat-easier')
    expect(payload.totalQuestions).toBe(10)
    expect(container.querySelector('[data-game-key="sat-easier"]')).toBeTruthy()
  })

  it('submits a Hard run to the original board, scored out of 18', () => {
    const { container } = renderPage()
    act(() => { press(difficultyButton(container, 'hard')) })
    act(() => { press(container.querySelector(START_SELECTOR)) })
    act(() => { vi.advanceTimersByTime(1100) })

    playOut(container, 3, 6)

    expect(submitCbatResult).toHaveBeenCalledTimes(1)
    const [gameKey, payload] = submitCbatResult.mock.calls[0]
    expect(gameKey).toBe('sat')
    expect(payload.totalQuestions).toBe(18)
  })

  // The instructions card is still on screen during the launch flash and its
  // buttons still take clicks, so the run's difficulty has to be pinned at the
  // press of Start — not read back at submit time.
  it('ignores a difficulty flipped during the launch flash', () => {
    const { container } = renderPage()
    act(() => { press(container.querySelector(START_SELECTOR)) })
    act(() => { vi.advanceTimersByTime(400) })
    act(() => { press(difficultyButton(container, 'hard')) })
    act(() => { vi.advanceTimersByTime(1100) })

    // Hard is now selected on the card, but the run in play is the Easier one.
    expect(container.querySelector('[data-difficulty-marker="easier"]')).toBeTruthy()
    playOut(container, 2, 5)

    expect(submitCbatResult.mock.calls[0][0]).toBe('sat-easier')
    expect(submitCbatResult.mock.calls[0][1].totalQuestions).toBe(10)
  })
})
