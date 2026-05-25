import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
    loading: false,
    API: '',
    apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('../../context/UnsolvedReportsContext', () => ({
  useUnsolvedReports: () => ({ unsolvedCount: 0, unresolvedSystemLogs: 0, refresh: vi.fn() }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: {}, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
  }),
}))

vi.mock('../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: () => ({ pending: null, clear: vi.fn() }),
}))

vi.mock('../../components/RankBadge', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
  TUTORIAL_KEYS: {},
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: () => true }),
}))

vi.mock('../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(), previewTypingSound: vi.fn(), previewGridRevealTone: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, ...r }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled, ...r }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// Recharts uses ResponsiveContainer which needs a width — mock it to render children directly.
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div data-testid="recharts-container">{children}</div>,
  }
})

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_SNAPSHOT = {
  status: 'success',
  data: {
    headlines: {
      dau: 4, wau: 12, mau: 25, totalUsers: 30,
    },
    dailyDau: Array.from({ length: 30 }, (_, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, count: i % 5 })),
    signupSource: { google: 18, email: 12 },
    subscription: { free: 25, trial: 3, silver: 1, gold: 1 },
  },
}

const MOCK_WINDOW = {
  status: 'success',
  data: {
    window: '7d',
    headlines: {
      signupsInWindow: 6, signupsDelta: 0.5,
      activeInWindow: 14, activeRate: 0.47,
      activationRate: 0.33,
      newUsersInWindow: 6, activatedUsersInWindow: 2,
    },
    dailySignups: [
      { date: '2026-05-01', count: 1 },
      { date: '2026-05-02', count: 2 },
    ],
  },
}

const MOCK_CBAT = {
  status: 'success',
  data: {
    window: '7d',
    headlines: {
      totalSessions: 47, uniquePlayers: 9,
      d1Retention: 0.4, d7Retention: 0.2,
      cohortSize: 5, totalUsers: 30,
    },
    dailySessions: [
      { date: '2026-05-01', 'plane-turn-2d': 2, 'plane-turn-3d': 1, target: 1, angles: 0 },
      { date: '2026-05-02', 'plane-turn-2d': 5, 'plane-turn-3d': 2, target: 3, angles: 1 },
    ],
    gameKeys: ['plane-turn-2d', 'plane-turn-3d', 'target', 'angles'],
    gameLabels: { 'plane-turn-2d': 'Plane Turn 2D', 'plane-turn-3d': 'Plane Turn 3D', target: 'Target', angles: 'Angles' },
    sessionsPerPlayerBuckets: [
      { bucket: '0', users: 21 },
      { bucket: '1', users: 4 },
      { bucket: '2-4', users: 3 },
      { bucket: '5-9', users: 2 },
      { bucket: '10+', users: 0 },
    ],
    perGame: [
      { key: 'plane-turn-2d', label: 'Plane Turn 2D', sessions: 12, players: 4, avgPerPlayer: 3, starts: 15, abandonPct: 0.2 },
      { key: 'plane-turn-3d', label: 'Plane Turn 3D', sessions: 6,  players: 2, avgPerPlayer: 3, starts: 7,  abandonPct: 0.143 },
      { key: 'target',        label: 'Target',         sessions: 15, players: 4, avgPerPlayer: 3.75, starts: 17, abandonPct: 0.12 },
      { key: 'angles',        label: 'Angles',         sessions: 14, players: 6, avgPerPlayer: 2.33, starts: 16, abandonPct: 0.125 },
    ],
  },
}

function setupFetch(overrides = {}) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/reports/snapshot')) {
      return Promise.resolve({ ok: true, json: async () => overrides.snapshot ?? MOCK_SNAPSHOT })
    }
    if (url.includes('/api/admin/reports/window')) {
      return Promise.resolve({ ok: true, json: async () => overrides.windowed ?? MOCK_WINDOW })
    }
    if (url.includes('/api/admin/reports/cbat')) {
      return Promise.resolve({ ok: true, json: async () => overrides.cbat ?? MOCK_CBAT })
    }
    if (url.includes('/api/admin/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: {}, briefs: {}, tutorials: {}, server: {} } }) })
    }
    if (url.includes('/api/admin/openrouter/summary')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {} }) })
    }
    if (url.includes('/api/admin/problems/count')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function openReportsTab() {
  render(<Admin />)
  // Switch to Reports tab.
  const reportsTab = await screen.findByRole('button', { name: /Reports/i })
  fireEvent.click(reportsTab)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Reports tab', () => {
  beforeEach(() => { global.fetch = setupFetch() })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders Snapshot headline cards (window-independent)', async () => {
    await openReportsTab()
    await waitFor(() => expect(screen.getByText('DAU')).toBeInTheDocument())
    expect(screen.getByText('WAU')).toBeInTheDocument()
    expect(screen.getByText('MAU')).toBeInTheDocument()
    expect(screen.getByText('Total Users')).toBeInTheDocument()
  })

  it('renders Within Window section with platform-wide acquisition stats', async () => {
    await openReportsTab()
    await waitFor(() => expect(screen.getByText('Active in Window')).toBeInTheDocument())
    expect(screen.getByText('Signups (window)')).toBeInTheDocument()
  })

  it('renders CBAT headlines including Activation and per-game table', async () => {
    await openReportsTab()
    await waitFor(() => expect(screen.getByText('Total Sessions')).toBeInTheDocument())
    // Activation now lives under CBAT Engagement.
    expect(screen.getByText('Activation')).toBeInTheDocument()
    expect(screen.getByText('33%')).toBeInTheDocument()
    expect(screen.getByText('Unique Players')).toBeInTheDocument()
    expect(screen.getByText('D1 Retention')).toBeInTheDocument()
    expect(screen.getByText('D7 Retention')).toBeInTheDocument()
    expect(screen.getByText('Plane Turn 2D')).toBeInTheDocument()
    expect(screen.getByText('Plane Turn 3D')).toBeInTheDocument()
    expect(screen.getByText('Target')).toBeInTheDocument()
    expect(screen.getByText('Angles')).toBeInTheDocument()
  })

  it('refetches window + cbat (but NOT snapshot) when window changes', async () => {
    await openReportsTab()
    await waitFor(() => expect(screen.getByText('DAU')).toBeInTheDocument())

    // Snapshot fetched once.
    const snapshotCalls = () => global.fetch.mock.calls.filter(c => String(c[0]).includes('/api/admin/reports/snapshot')).length
    expect(snapshotCalls()).toBe(1)

    // Initial window=7d call.
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/reports/window?window=7d'),
      expect.any(Object),
    )

    // Switch to 30d.
    fireEvent.click(screen.getByRole('button', { name: '30d' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/reports/window?window=30d'),
        expect.any(Object),
      )
    })

    // Snapshot should NOT have been re-fetched.
    expect(snapshotCalls()).toBe(1)
  })

  it('shows error state if fetch fails', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/admin/reports/')) {
        return Promise.reject(new Error('boom'))
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    await openReportsTab()
    await waitFor(() => expect(screen.getByText(/Failed to load/i)).toBeInTheDocument())
  })
})
