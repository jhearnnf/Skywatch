import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import TopBar from '../../../components/layout/TopBar'

// ── Hoisted mock fns ────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_USER = {
  _id:           'user1',
  email:         'agent@test.com',
  displayName:   'Agent Test',
  totalAircoins: 850,
  loginStreak:   5,
  rank: { rankName: 'Aircraftman', rankAbbreviation: 'AC', rankNumber: 1 },
}

function setupAuth(userOverrides) {
  mockUseAuth.mockReturnValue({
    user:   userOverrides === null ? null : { ...BASE_USER, ...userOverrides },
    logout: vi.fn(),
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TopBar — aircoin display', () => {
  beforeEach(() => {
    setupAuth({})
    mockNavigate.mockClear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('shows totalAircoins in the aircoins badge', () => {
    render(<TopBar />)
    expect(screen.getByText('850')).toBeDefined()
  })

  it('shows loginStreak in the streak badge', () => {
    render(<TopBar />)
    expect(screen.getByText('5')).toBeDefined()
  })

  it('clicking aircoins badge navigates to /rankings', () => {
    render(<TopBar />)
    fireEvent.click(screen.getByLabelText('View agent levels'))
    expect(mockNavigate).toHaveBeenCalledWith('/rankings')
  })

  it('clicking streak badge navigates to /profile', () => {
    render(<TopBar />)
    fireEvent.click(screen.getByLabelText('View profile'))
    expect(mockNavigate).toHaveBeenCalledWith('/profile')
  })

  it('avatar shows AC abbreviation for rank 1 (no badge SVG for AC)', () => {
    render(<TopBar />)
    expect(screen.getByText('AC')).toBeDefined()
  })

  it('avatar shows badge SVG (not text) for a non-AC rank', () => {
    setupAuth({ rank: { rankName: 'Corporal', rankAbbreviation: 'Cpl', rankNumber: 4 } })
    render(<TopBar />)
    // RankBadge renders an SVG for rankNumber > 1 — no abbreviation text in the button
    expect(screen.queryByText('Cpl')).toBeNull()
    expect(screen.getByLabelText('View RAF ranks').querySelector('svg')).toBeDefined()
  })

  it('avatar falls back to AC when user has no rank', () => {
    setupAuth({ rank: null })
    render(<TopBar />)
    expect(screen.getByText('AC')).toBeDefined()
  })

  it('clicking avatar navigates to /rankings with ranks tab state', () => {
    render(<TopBar />)
    fireEvent.click(screen.getByLabelText('View RAF ranks'))
    expect(mockNavigate).toHaveBeenCalledWith('/rankings', { state: { tab: 'ranks' } })
  })

  it('shows Sign In link when no user is logged in', () => {
    setupAuth(null)
    render(<TopBar />)
    expect(screen.getByText('Sign In')).toBeDefined()
  })

  it('does not show streak or aircoins badges when no user', () => {
    setupAuth(null)
    render(<TopBar />)
    expect(screen.queryByLabelText('View agent levels')).toBeNull()
    expect(screen.queryByLabelText('View profile')).toBeNull()
  })

  it('shows 0 for both badges when user has no coins or streak', () => {
    setupAuth({ totalAircoins: 0, loginStreak: 0 })
    render(<TopBar />)
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(2)
  })
})
