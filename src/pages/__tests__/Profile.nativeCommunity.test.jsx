import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Profile from '../Profile'

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

// NATIVE_APP resolves from Capacitor at import time, so it is exposed here as a
// getter over a mutable ref — the named import stays live, and Profile reads it
// during render, so flipping the ref between tests is enough to switch between
// the packaged app and web slim mode.
const mockNativeApp = vi.hoisted(() => ({ value: true }))
vi.mock('../../utils/appMode', () => ({
  get NATIVE_APP() { return mockNativeApp.value },
}))

// The native app is always slim; web slim mode is the same hook with a flag.
vi.mock('../../hooks/useSlimMode', () => ({ useSlimMode: () => true }))

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

function setupAuth() {
  mockUseAuth.mockReturnValue({
    user: { ...BASE_USER },
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

async function openHelpTab() {
  render(<Profile />)
  await waitFor(() => screen.getByText('Games Played'))
  fireEvent.click(screen.getByText('💡 Help'))
  await waitFor(() => screen.getByText('📤 Share SkyWatch'))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Profile — Community row in the Help tab', () => {
  beforeEach(() => {
    setupAuth()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    mockNavigate.mockClear()
    mockNativeApp.value = true
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows a Community row in the native app, pointing at /chat', async () => {
    await openHelpTab()
    const row = screen.getByText('💬 Community').closest('a')
    expect(row).not.toBeNull()
    expect(row.getAttribute('href')).toBe('/chat')
  })

  it('places Community above Share and Report', async () => {
    await openHelpTab()
    const labels = ['💬 Community', '📤 Share SkyWatch', '⚠️ Report a Problem']
      .map(t => screen.getByText(t))
    // Ordered as rendered: each label precedes the next in document order.
    expect(labels[0].compareDocumentPosition(labels[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(labels[1].compareDocumentPosition(labels[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides the Community row in web slim mode, which has the real nav button', async () => {
    mockNativeApp.value = false
    await openHelpTab()
    expect(screen.queryByText('💬 Community')).toBeNull()
    // The neighbouring rows are unaffected.
    expect(screen.getByText('⚠️ Report a Problem')).toBeDefined()
  })
})
