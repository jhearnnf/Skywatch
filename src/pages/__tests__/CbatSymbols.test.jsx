import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatSymbols from '../CbatSymbols'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../components/SEO', () => ({ default: () => null }))

const mockSubmitCbatResult = vi.hoisted(() => vi.fn(() => Promise.resolve({ synced: true })))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: mockSubmitCbatResult }))

// Passthrough so the results screen renders without the reveal's own deps
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, onClick }) => <div className={className} onClick={onClick}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

function mockApiFetch(personalBestData = null) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/cbat/symbols/personal-best'))
      return Promise.resolve({ ok: true, json: async () => ({ data: personalBestData }) })
    if (url.includes('/cbat/symbols/result'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { saved: true } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function setupUser(apiFetch = mockApiFetch()) {
  mockUseAuth.mockReturnValue({
    user:     { _id: 'u1', email: 'a@b.com' },
    API:      '',
    apiFetch,
  })
}

function setupGuest() {
  mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch: vi.fn() })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatSymbols — guest gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows sign-in prompt when not logged in', () => {
    setupGuest()
    render(<CbatSymbols />)
    expect(screen.getByText('Sign in to play')).toBeDefined()
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull()
  })

  it('sign-in CTA links to /login', () => {
    setupGuest()
    render(<CbatSymbols />)
    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link.getAttribute('href')).toBe('/login')
  })
})

describe('CbatSymbols — intro screen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders intro with Start button for logged-in user', () => {
    setupUser()
    render(<CbatSymbols />)
    expect(screen.getByText('Symbol Recognition')).toBeDefined()
    expect(screen.getByRole('button', { name: /^start$/i })).toBeDefined()
  })

  it('displays tier descriptions', () => {
    setupUser()
    render(<CbatSymbols />)
    expect(screen.getByText(/Rounds 1.5/)).toBeDefined()
    expect(screen.getByText(/Rounds 6.10/)).toBeDefined()
    expect(screen.getByText(/Rounds 11.15/)).toBeDefined()
  })

  it('shows personal best when API returns one', async () => {
    setupUser(mockApiFetch({ bestScore: 12, bestTime: 42.5, attempts: 3 }))
    render(<CbatSymbols />)
    await waitFor(() => expect(screen.getByText(/Personal Best/i)).toBeDefined())
    expect(screen.getByText(/12\/15/)).toBeDefined()
    expect(screen.getByText(/42\.50s/)).toBeDefined()
  })

  it('hides personal best section when none exists', async () => {
    setupUser(mockApiFetch(null))
    render(<CbatSymbols />)
    // Give personal-best fetch a chance to resolve
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(/Personal Best/i)).toBeNull()
  })

  it('links to leaderboard', () => {
    setupUser()
    render(<CbatSymbols />)
    const link = screen.getByRole('link', { name: /view leaderboard/i })
    expect(link.getAttribute('href')).toBe('/cbat/symbols/leaderboard')
  })
})

describe('CbatSymbols — gameplay', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clicking Start transitions to round 1 with a symbol grid', () => {
    setupUser()
    render(<CbatSymbols />)
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }))

    expect(screen.getByText(/Round/)).toBeDefined()
    expect(screen.getByText(/Find the target symbol/i)).toBeDefined()
  })

  it('the round grid has at least 12 tiles (minimum tier-1 size)', () => {
    setupUser()
    render(<CbatSymbols />)
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }))

    // Every symbol rendered as a button inside the grid container
    const grid = document.querySelector('.grid')
    const tiles = grid.querySelectorAll('button')
    expect(tiles.length).toBeGreaterThanOrEqual(12)
    expect(tiles.length).toBeLessThanOrEqual(15) // tier 1 max
  })

  it('picking a non-target symbol reveals the correct one and disables further picks for the round', async () => {
    setupUser()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<CbatSymbols />)
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }))

    const grid = document.querySelector('.grid')
    const tiles = Array.from(grid.querySelectorAll('button'))
    // Pick the first tile — very low chance it is the target in tier 1
    fireEvent.click(tiles[0])

    // In feedback phase, tiles are disabled
    await waitFor(() => {
      const disabled = Array.from(document.querySelectorAll('.grid button')).every(b => b.disabled)
      expect(disabled).toBe(true)
    })
    vi.useRealTimers()
  })
})

describe('CbatSymbols — total time consistency', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.useRealTimers())

  // Plays all 15 rounds. Think time is deliberately 150ms — NOT a multiple of
  // the 100ms tick — so each round ends 50ms past the last sampled tick. The
  // old timer re-based itself off that stale sample on every phase change, so
  // it silently dropped the 50ms remainder twice a round.
  async function playFullGame() {
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
    for (let i = 0; i < 15; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(150) })
      fireEvent.click(document.querySelector('.grid button'))
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    }
    // Submission happens synchronously inside the final feedback timeout, so
    // there is nothing to poll for (and waitFor cannot poll on fake timers).
    expect(mockSubmitCbatResult).toHaveBeenCalled()
    return mockSubmitCbatResult.mock.calls[0]
  }

  // Regression: re-basing the clock on each phase change made the recorded
  // total run progressively short (~50ms per transition here, 1.5s over a run).
  it('records the true elapsed time without drifting short', async () => {
    setupUser()
    // No shouldAdvanceTime — the clock must advance only by what we ask for,
    // or real time bleeds in and the elapsed assertions go flaky under load.
    vi.useFakeTimers()
    render(<CbatSymbols />)

    const [gameKey, payload] = await playFullGame()

    expect(gameKey).toBe('symbols')
    // 15 rounds x (150ms think + 1000ms feedback) = 17.25s of real elapsed time
    expect(payload.totalTime).toBeGreaterThan(17.2)
    expect(payload.totalTime).toBeLessThan(17.4)
  })

  // Regression: the screen rendered the live `elapsed` state (last 100ms tick)
  // while the leaderboard was sent `elapsed + FEEDBACK_MS`, so the same run
  // could show 12.4s on screen and 12.5s on the board.
  it('submits exactly the total time it shows on the results screen', async () => {
    setupUser()
    // No shouldAdvanceTime — the clock must advance only by what we ask for,
    // or real time bleeds in and the elapsed assertions go flaky under load.
    vi.useFakeTimers()
    render(<CbatSymbols />)

    const [, payload] = await playFullGame()

    expect(screen.getByText('total time')).toBeDefined()
    expect(screen.getAllByText(`${payload.totalTime.toFixed(2)}s`).length).toBeGreaterThan(0)
  })
})
