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
    expect(screen.getByText(/42\.5s/)).toBeDefined()
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
