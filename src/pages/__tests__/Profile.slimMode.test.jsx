import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Profile from '../Profile'

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

// ── Mocks ────────────────────────────────────────────────────────────────────

// Force the slimmed native app mode for this whole file.
vi.mock('../../utils/appMode', () => ({
  SLIM_APP: true,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../utils/sound', () => ({
  getMasterVolume: () => 1,
  setMasterVolume: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), replay: vi.fn(), resetAll: vi.fn() }),
}))

vi.mock('../../utils/subscription', () => ({
  displayTier: () => 'Free',
  isFreeUser: () => true,
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

vi.mock('../../data/mockData', () => ({ MOCK_LEADERBOARD: [] }))

const TEST_LEVELS = [
  { levelNumber: 1, cumulativeAirstars: 0,   airstarsToNextLevel: 100 },
  { levelNumber: 2, cumulativeAirstars: 100, airstarsToNextLevel: 150 },
]

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ levels: TEST_LEVELS, settings: {}, loading: false }),
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_USER = {
  _id: 'user1', email: 'agent@test.com', displayName: 'Agent Test',
  agentNumber: '1234567', totalAirstars: 1000, cycleAirstars: 250,
  loginStreak: 7, difficultySetting: 'easy',
  rank: { rankName: 'Corporal', rankAbbreviation: 'Cpl', rankNumber: 3 }, tutorials: {},
}

function setupAuth(userOverrides = {}) {
  mockUseAuth.mockReturnValue({
    user: userOverrides === null ? null : { ...BASE_USER, ...userOverrides },
    setUser: vi.fn(), API: '',
    apiFetch: vi.fn().mockImplementation((url) => {
      if (url.includes('/api/users/stats')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { brifsRead: 5, gamesPlayed: 8, abandonedGames: 2, winPercent: 67 } }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }),
    logout: vi.fn(),
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Profile — slim (native) mode', () => {
  beforeEach(() => {
    setupAuth()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    mockNavigate.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows Games Played but hides Briefs Read, Avg Score and Airstars cards', async () => {
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Games Played')).toBeDefined())
    expect(screen.queryByText('Briefs Read')).toBeNull()
    expect(screen.queryByText('Avg Score')).toBeNull()
    expect(screen.queryByText('Airstars')).toBeNull()
  })

  it('hides the Ranks tab', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText('Games Played'))
    expect(screen.queryByText('🏆 Ranks')).toBeNull()
    // Other tabs still present
    expect(screen.getByText('📊 Stats')).toBeDefined()
    expect(screen.getByText('⚙️ Settings')).toBeDefined()
  })

  it('hides the streak and the level meter', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText('Games Played'))
    expect(screen.queryByText('Streak')).toBeNull()
    expect(screen.queryByText(/Level \d/)).toBeNull()
  })

  it('Games Played card is not clickable (renders as a div, no navigation)', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText('Games Played'))
    // With no onClick the StatCard renders as a plain div, not a button.
    expect(screen.getByText('Games Played').closest('button')).toBeNull()
    fireEvent.click(screen.getByText('Games Played'))
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('Settings tab hides Recall Difficulty and Subscription but keeps Display Name and Volume', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText('Games Played'))
    fireEvent.click(screen.getByText('⚙️ Settings'))
    await waitFor(() => screen.getByText('Display Name'))
    expect(screen.getByText('Skywatch Volume')).toBeDefined()
    expect(screen.queryByText('Recall Difficulty')).toBeNull()
    expect(screen.queryByText('Subscription')).toBeNull()
  })

  it('Help tab hides the Replay Tutorials section but keeps Share / Report links', async () => {
    render(<Profile />)
    await waitFor(() => screen.getByText('Games Played'))
    fireEvent.click(screen.getByText('💡 Help'))
    await waitFor(() => screen.getByText('📤 Share SkyWatch'))
    expect(screen.getByText('⚠️ Report a Problem')).toBeDefined()
    expect(screen.queryByText(/Replay any tutorial/)).toBeNull()
    expect(screen.queryByText(/Reset All Tutorials/)).toBeNull()
  })
})
