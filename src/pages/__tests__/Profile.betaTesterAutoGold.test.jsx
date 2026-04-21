import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Profile from '../Profile'

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockUseAppSettings = vi.hoisted(() => vi.fn())

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(), useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
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

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseAppSettings,
}))

vi.mock('../../data/mockData', () => ({
  MOCK_LEADERBOARD: [],
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function mockFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { levels: [], useLiveLeaderboard: false } }),
  })
}

function setupUser(overrides = {}) {
  mockUseAuth.mockReturnValue({
    user: {
      _id: 'u1',
      displayName: 'Agent Test',
      subscriptionTier: 'free',
      cycleAirstars: 0,
      totalAirstars: 0,
      loginStreak: 0,
      ...overrides,
    },
    API: '', apiFetch: (...args) => fetch(...args),
    setUser: vi.fn(),
  })
}

function setupSettings(settings) {
  mockUseAppSettings.mockReturnValue({
    levels: [
      { levelNumber: 1, cumulativeAirstars: 0, airstarsToNextLevel: 100 },
      { levelNumber: 2, cumulativeAirstars: 100, airstarsToNextLevel: 150 },
    ],
    settings,
    loading: false,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Profile — betaTesterAutoGold hides subscription card', () => {
  beforeEach(() => {
    mockFetch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows subscription card when betaTesterAutoGold is false', async () => {
    setupUser()
    setupSettings({ betaTesterAutoGold: false })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Subscription')).toBeDefined())
    expect(screen.getByText('Current Plan')).toBeDefined()
  })

  it('shows subscription card when betaTesterAutoGold is absent (default)', async () => {
    setupUser()
    setupSettings({})
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Subscription')).toBeDefined())
  })

  it('hides subscription card when betaTesterAutoGold is true', async () => {
    setupUser()
    setupSettings({ betaTesterAutoGold: true })
    render(<Profile />)
    // Wait for any async effects to settle before asserting absence
    await waitFor(() => expect(screen.getByText('Agent Test')).toBeDefined())
    expect(screen.queryByText('Subscription')).toBeNull()
    expect(screen.queryByText('Current Plan')).toBeNull()
  })

  it('hides subscription card for gold user when betaTesterAutoGold is true', async () => {
    setupUser({ subscriptionTier: 'gold' })
    setupSettings({ betaTesterAutoGold: true })
    render(<Profile />)
    await waitFor(() => expect(screen.getByText('Agent Test')).toBeDefined())
    expect(screen.queryByText('Subscription')).toBeNull()
  })
})
