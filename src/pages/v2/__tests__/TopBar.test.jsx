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
  rank: { rankName: 'Corporal', rankAbbreviation: 'Cpl', rankNumber: 3 },
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

  it('avatar shows rank abbreviation when user has a rank', () => {
    render(<TopBar />)
    expect(screen.getByText('Cpl')).toBeDefined()
  })

  it('avatar falls back to first letter of displayName when user has no rank', () => {
    setupAuth({ rank: null, displayName: 'Agent Test' })
    render(<TopBar />)
    expect(screen.getByText('A')).toBeDefined()
  })

  it('avatar falls back to first letter of email when displayName is absent', () => {
    setupAuth({ rank: null, displayName: null, email: 'zara@test.com' })
    render(<TopBar />)
    expect(screen.getByText('Z')).toBeDefined()
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
