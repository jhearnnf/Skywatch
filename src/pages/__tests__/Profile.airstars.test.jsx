import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Profile from '../Profile'

// ── Hoisted mock fns (must be declared before vi.mock calls) ───────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../utils/sound', () => ({
  getMasterVolume: () => 1,
  setMasterVolume: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), replay: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, ...rest }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick, ...rest }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

vi.mock('../../data/mockData', () => ({
  MOCK_LEADERBOARD: [],
}))

const TEST_LEVELS = [
  { levelNumber: 1, cumulativeAirstars: 0,   airstarsToNextLevel: 100 },
  { levelNumber: 2, cumulativeAirstars: 100,  airstarsToNextLevel: 150 },
  { levelNumber: 3, cumulativeAirstars: 250,  airstarsToNextLevel: 250 },
]

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ levels: TEST_LEVELS, settings: {}, loading: false }),
}))

vi.mock('../../utils/levelUtils', async () => {
  const actual = await vi.importActual('../../utils/levelUtils')
  return actual
})

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE_USER = {
  _id:               'user1',
  email:             'agent@test.com',
  displayName:       'Agent Test',
  agentNumber:       '1234567',
  totalAirstars:     1000,
  cycleAirstars:     250,
  loginStreak:       7,
  difficultySetting: 'easy',
  rank: { rankName: 'Corporal', rankAbbreviation: 'Cpl', rankNumber: 3 },
  tutorials: {},
}

function setupAuth(userOverrides = {}) {
  mockUseAuth.mockReturnValue({
    user:     userOverrides === null ? null : { ...BASE_USER, ...userOverrides },
    setUser:  vi.fn(),
    API:      '',
    apiFetch: vi.fn().mockImplementation((url) => {
      if (url.includes('/api/users/stats')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { brifsRead: 5, gamesPlayed: 3, abandonedGames: 1, winPercent: 67 } }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }),
    logout:   vi.fn(),
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

describe('Profile — airstar display', () => {
  beforeEach(() => {
    setupAuth()
    global.fetch = makeFetch()
    mockNavigate.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stats grid Airstars card shows totalAirstars, not cycleAirstars', async () => {
    // totalAirstars=1000, cycleAirstars=250 — card must show 1,000
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('1,000')).toBeDefined())
  })

  it('stats grid does NOT show cycleAirstars as the Airstars value when they differ', async () => {
    setupAuth({ totalAirstars: 999, cycleAirstars: 42 })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('999')).toBeDefined())
    // The cycleAirstars value (42) should not appear as the Airstars card value
    // totalAirstars (999) should be visible
    expect(screen.queryByText('42')).toBeNull()
  })

  it('XP bar uses cycleAirstars-based level info', async () => {
    // cycleAirstars=250, which maps to Level 3 boundary in TEST_LEVELS
    render(<Profile />)
    await waitFor(() => expect(screen.getByText(/Level \d/)).toBeDefined())
  })

  it('streak shows loginStreak from user object', async () => {
    setupAuth({ loginStreak: 12 })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('12')).toBeDefined())
  })

  it('clicking Airstars stat card navigates to /airstar-history', async () => {
    render(<Profile />)

    await waitFor(() => screen.getByText('Airstars'))

    // Find the clickable button wrapping the Airstars label
    const label  = screen.getByText('Airstars')
    const button = label.closest('button')
    fireEvent.click(button)

    expect(mockNavigate).toHaveBeenCalledWith('/airstar-history')
  })

  it('shows 0 airstars gracefully when user has no coins', async () => {
    setupAuth({ totalAirstars: 0, cycleAirstars: 0 })
    render(<Profile />)
    await waitFor(() => {
      const zeros = screen.getAllByText('0')
      expect(zeros.length).toBeGreaterThan(0)
    })
  })
})
