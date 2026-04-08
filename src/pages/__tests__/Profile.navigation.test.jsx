import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Profile from '../Profile'

// ── Hoisted mock fns ───────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../utils/sound', () => ({
  getMasterVolume: () => 50,
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
  { levelNumber: 1, cumulativeAircoins: 0,   aircoinsToNextLevel: 100 },
  { levelNumber: 2, cumulativeAircoins: 100,  aircoinsToNextLevel: 150 },
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
  totalAircoins:     500,
  cycleAircoins:     100,
  loginStreak:       3,
  difficultySetting: 'easy',
  subscriptionTier:  'free',
  rank: { rankName: 'Airman', rankAbbreviation: 'AC', rankNumber: 1 },
}

function setupAuth() {
  mockUseAuth.mockReturnValue({
    user:     { ...BASE_USER },
    setUser:  vi.fn(),
    API:      '',
    apiFetch: vi.fn().mockImplementation((url) => {
      if (url.includes('/api/users/stats')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { brifsRead: 8, gamesPlayed: 4, abandonedGames: 2, winPercent: 75 } }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }),
    logout:   vi.fn(),
  })
}

function makeFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/users/stats')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { brifsRead: 8, gamesPlayed: 4, abandonedGames: 2, winPercent: 75 } }),
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Profile — stat card navigation', () => {
  beforeEach(() => {
    setupAuth()
    global.fetch = makeFetch()
    mockNavigate.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clicking "Briefs Read" navigates to /intel-brief-history', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText('Briefs Read'))
    fireEvent.click(screen.getByText('Briefs Read').closest('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/intel-brief-history')
  })

  it('clicking "Avg Score" navigates to /game-history', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText('Avg Score'))
    fireEvent.click(screen.getByText('Avg Score').closest('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/game-history')
  })

  it('clicking "Games Played" card navigates to /game-history', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText('Games Played'))
    fireEvent.click(screen.getByText('Games Played').closest('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/game-history')
  })

  it('shows abandoned badge when abandonedGames > 0', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText(/2 abandoned/))
  })

  it('clicking "Aircoins" navigates to /aircoin-history', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText('Aircoins'))
    fireEvent.click(screen.getByText('Aircoins').closest('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/aircoin-history')
  })
})
