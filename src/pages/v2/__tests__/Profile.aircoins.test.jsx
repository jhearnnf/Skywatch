import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Profile from '../Profile'

// ── Hoisted mock fns (must be declared before vi.mock calls) ───────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../../utils/sound', () => ({
  getMasterVolume: () => 1,
  setMasterVolume: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), replay: vi.fn() }),
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, ...rest }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, ...rest }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

vi.mock('../../../data/mockData', () => ({
  MOCK_LEVELS: [
    { levelNumber: 1, cumulativeAircoins: 0,   aircoinsToNextLevel: 100 },
    { levelNumber: 2, cumulativeAircoins: 100,  aircoinsToNextLevel: 150 },
    { levelNumber: 3, cumulativeAircoins: 250,  aircoinsToNextLevel: 250 },
  ],
  MOCK_LEADERBOARD: [],
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE_USER = {
  _id:               'user1',
  email:             'agent@test.com',
  displayName:       'Agent Test',
  agentNumber:       '1234567',
  totalAircoins:     1000,
  cycleAircoins:     250,
  loginStreak:       7,
  difficultySetting: 'easy',
  rank: { rankName: 'Corporal', rankAbbreviation: 'Cpl', rankNumber: 3 },
  tutorials: {},
}

function setupAuth(userOverrides = {}) {
  mockUseAuth.mockReturnValue({
    user:    userOverrides === null ? null : { ...BASE_USER, ...userOverrides },
    setUser: vi.fn(),
    API:     '',
  })
}

function makeFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/users/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { brifsRead: 5, gamesPlayed: 3, abandonedGames: 1, winPercent: 67 } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Profile — aircoin display', () => {
  beforeEach(() => {
    setupAuth()
    global.fetch = makeFetch()
    mockNavigate.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stats grid Aircoins card shows totalAircoins, not cycleAircoins', async () => {
    // totalAircoins=1000, cycleAircoins=250 — card must show 1,000
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('1,000')).toBeDefined())
  })

  it('stats grid does NOT show cycleAircoins as the Aircoins value when they differ', async () => {
    setupAuth({ totalAircoins: 999, cycleAircoins: 42 })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('999')).toBeDefined())
    // The cycleAircoins value (42) should not appear as the Aircoins card value
    // totalAircoins (999) should be visible
    expect(screen.queryByText('42')).toBeNull()
  })

  it('XP bar uses cycleAircoins-based level info', async () => {
    // cycleAircoins=250, which maps to Level 3 boundary in MOCK_LEVELS
    render(<Profile />)
    await waitFor(() => expect(screen.getByText(/Level \d/)).toBeDefined())
  })

  it('streak shows loginStreak from user object', async () => {
    setupAuth({ loginStreak: 12 })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('12')).toBeDefined())
  })

  it('clicking Aircoins stat card navigates to /aircoin-history', async () => {
    render(<Profile />)

    await waitFor(() => screen.getByText('Aircoins'))

    // Find the clickable button wrapping the Aircoins label
    const label  = screen.getByText('Aircoins')
    const button = label.closest('button')
    fireEvent.click(button)

    expect(mockNavigate).toHaveBeenCalledWith('/aircoin-history')
  })

  it('shows 0 aircoins gracefully when user has no coins', async () => {
    setupAuth({ totalAircoins: 0, cycleAircoins: 0 })
    render(<Profile />)
    await waitFor(() => {
      const zeros = screen.getAllByText('0')
      expect(zeros.length).toBeGreaterThan(0)
    })
  })
})
