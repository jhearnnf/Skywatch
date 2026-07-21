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
    gameKeys: ['plane-turn-2d', 'plane-turn-3d', 'target', 'angles', 'target-tutorial'],
    gameLabels: { 'plane-turn-2d': 'Trace Practise 2D', 'plane-turn-3d': 'Trace Practise 3D', target: 'Target', angles: 'Angles', 'target-tutorial': 'Target (tutorial)' },
    practiceKeys: ['target-tutorial', 'plane-turn-2d', 'plane-turn-3d'],
    sessionsPerPlayerBuckets: [
      { bucket: '0', users: 21 },
      { bucket: '1', users: 4 },
      { bucket: '2-4', users: 3 },
      { bucket: '5-9', users: 2 },
      { bucket: '10+', users: 0 },
    ],
    perGame: [
      { key: 'plane-turn-2d', label: 'Trace Practise 2D', sessions: 12, players: 4, avgPerPlayer: 3, starts: 15, abandonPct: 0.2 },
      { key: 'plane-turn-3d', label: 'Trace Practise 3D', sessions: 6,  players: 2, avgPerPlayer: 3, starts: 7,  abandonPct: 0.143 },
      { key: 'target',        label: 'Target',         sessions: 15, players: 4, avgPerPlayer: 3.75, starts: 17, abandonPct: 0.12 },
      { key: 'angles',        label: 'Angles',         sessions: 14, players: 6, avgPerPlayer: 2.33, starts: 16, abandonPct: 0.125 },
      { key: 'target-tutorial', label: 'Target (tutorial)', sessions: 8, players: 3, avgPerPlayer: 2.67, starts: 8, abandonPct: 0.375, isTutorial: true },
    ],
    tutorials: [
      {
        key: 'target-tutorial', label: 'Target (tutorial)', gameKey: 'target',
        sessions: 8, players: 3, completed: 5, completionRate: 0.625, totalSteps: 4,
        funnel: [
          { step: 0, reached: 8, dropOff: 1 },
          { step: 1, reached: 7, dropOff: 1 },
          { step: 2, reached: 6, dropOff: 0 },
          { step: 3, reached: 6, dropOff: 1 },
        ],
      },
    ],
  },
}

// Compare-mode payloads — only returned when the request carries compare=1.
const MOCK_WINDOW_CMP = {
  status: 'success',
  data: {
    ...MOCK_WINDOW.data,
    comparison: {
      signups:    { prev: 4, delta: 0.5 },
      active:     { prev: 10, delta: 0.4 },
      activation: { prev: 0.5, delta: -0.34 },
    },
    dailySignups: MOCK_WINDOW.data.dailySignups.map((r, i) => ({ ...r, prev: i })),
  },
}

const MOCK_CBAT_CMP = {
  status: 'success',
  data: {
    ...MOCK_CBAT.data,
    comparison: {
      totalSessions: { prev: 40, delta: 0.175 },
      uniquePlayers: { prev: 8,  delta: 0.125 },
      d1Retention:   { prev: 0.5, delta: -0.2 },
      d7Retention:   { prev: 0.25, delta: -0.2 },
    },
    dailySessions: MOCK_CBAT.data.dailySessions.map((r, i) => ({ ...r, _prevTotal: i + 1 })),
    perGame: MOCK_CBAT.data.perGame.map(g => ({ ...g, prevSessions: 5, sessionsDelta: 0.3 })),
  },
}

function setupFetch(overrides = {}) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/reports/snapshot')) {
      return Promise.resolve({ ok: true, json: async () => overrides.snapshot ?? MOCK_SNAPSHOT })
    }
    if (url.includes('/api/admin/reports/window')) {
      const cmp = url.includes('compare=1')
      return Promise.resolve({ ok: true, json: async () => overrides.windowed ?? (cmp ? MOCK_WINDOW_CMP : MOCK_WINDOW) })
    }
    if (url.includes('/api/admin/reports/cbat')) {
      const cmp = url.includes('compare=1')
      return Promise.resolve({ ok: true, json: async () => overrides.cbat ?? (cmp ? MOCK_CBAT_CMP : MOCK_CBAT) })
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
    expect(screen.getByText('Trace Practise 2D')).toBeInTheDocument()
    expect(screen.getByText('Trace Practise 3D')).toBeInTheDocument()
    expect(screen.getByText('Target')).toBeInTheDocument()
    expect(screen.getByText('Angles')).toBeInTheDocument()
  })

  it('shows the Target (tutorial) entry and a per-step Tutorial Drop-off funnel', async () => {
    await openReportsTab()
    await waitFor(() => expect(screen.getByText('Total Sessions')).toBeInTheDocument())
    // Tutorial surfaces as its own entry (table + funnel both render the label).
    expect(screen.getAllByText('Target (tutorial)').length).toBeGreaterThan(0)
    // Per-step drop-off funnel.
    expect(screen.getByText('Tutorial Drop-off')).toBeInTheDocument()
    expect(screen.getByText(/8 plays · 5 completed/)).toBeInTheDocument()
    expect(screen.getByText('Step 1')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('greys the names of tutorial/practice games in the per-game table', async () => {
    await openReportsTab()
    await waitFor(() => expect(screen.getByText('Total Sessions')).toBeInTheDocument())

    // Practice/tutorial names render greyed; the scored test (Target) does not.
    const tutorialCell = screen.getAllByText('Target (tutorial)').find(el => el.tagName === 'TD')
    expect(tutorialCell.className).toContain('text-slate-400')
    const trace2dCell = screen.getByText('Trace Practise 2D')
    expect(trace2dCell.className).toContain('text-slate-400')
    const targetCell = screen.getByText('Target')
    expect(targetCell.className).not.toContain('text-slate-400')
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

  it('requests compare data and shows the date-range label when Compare is toggled on', async () => {
    await openReportsTab()
    await waitFor(() => expect(screen.getByText('Total Sessions')).toBeInTheDocument())

    // No compare param initially.
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('compare=1'), expect.any(Object),
    )

    fireEvent.click(screen.getByRole('switch', { name: /Compare to previous/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/reports/window?window=7d&compare=1'),
        expect.any(Object),
      )
    })
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/reports/cbat?window=7d&compare=1'),
      expect.any(Object),
    )
    // Date-range label + per-game delta column header surface in compare mode.
    await waitFor(() => expect(screen.getByText(/Comparing/i)).toBeInTheDocument())
    expect(screen.getByText(/Δ vs prev/i)).toBeInTheDocument()
    // Non-comparable panels (distribution, sessions-by-game, tutorial drop-off)
    // are tagged "current only" rather than hidden.
    expect(screen.getAllByText(/current only/i).length).toBeGreaterThanOrEqual(2)
  })

  it('disables Compare for the all-time window and forces it off', async () => {
    await openReportsTab()
    await waitFor(() => expect(screen.getByText('Total Sessions')).toBeInTheDocument())

    // Turn compare on, then switch to All — compare must not be requested for all-time.
    fireEvent.click(screen.getByRole('switch', { name: /Compare to previous/i }))
    await waitFor(() => expect(screen.getByText(/Comparing/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'All' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/reports/cbat?window=all'),
        expect.any(Object),
      )
    })
    // The all-time request must NOT carry compare=1.
    const allCalls = global.fetch.mock.calls.filter(c => String(c[0]).includes('window=all'))
    expect(allCalls.length).toBeGreaterThan(0)
    expect(allCalls.every(c => !String(c[0]).includes('compare=1'))).toBe(true)
    // Switch is disabled for all-time.
    expect(screen.getByRole('switch', { name: /Compare to previous/i })).toBeDisabled()
  })

  it('marks each window-driven chart/table with a compact Time-window badge', async () => {
    await openReportsTab()
    await waitFor(() => expect(screen.getByText('Total Sessions')).toBeInTheDocument())

    // Two section-header chips (Activity & Growth, CBAT Engagement) plus a compact
    // chip on every window-driven chart/table (Daily Signups, Daily CBAT Sessions,
    // Activity heatmap, Sessions per User, Sessions by Game, Per-game Breakdown,
    // Tutorial Drop-off) all read the active window "7D".
    expect(screen.getAllByText('7D').length).toBeGreaterThanOrEqual(8)

    // The window-independent Snapshot section is not marked with a window chip.
    expect(screen.getByText('FIXED')).toBeInTheDocument()
  })

  it('flags window-driven cards as busy while new-window data is in flight', async () => {
    let releaseWindow, releaseCbat
    const pendingWindow = new Promise((res) => { releaseWindow = res })
    const pendingCbat   = new Promise((res) => { releaseCbat = res })

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/admin/reports/snapshot')) {
        return Promise.resolve({ ok: true, json: async () => MOCK_SNAPSHOT })
      }
      if (url.includes('/api/admin/reports/window')) {
        // First (7d) load resolves immediately; the 30d refetch stays pending.
        if (url.includes('window=30d')) return pendingWindow.then(() => ({ ok: true, json: async () => MOCK_WINDOW }))
        return Promise.resolve({ ok: true, json: async () => MOCK_WINDOW })
      }
      if (url.includes('/api/admin/reports/cbat')) {
        if (url.includes('window=30d')) return pendingCbat.then(() => ({ ok: true, json: async () => MOCK_CBAT }))
        return Promise.resolve({ ok: true, json: async () => MOCK_CBAT })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    await openReportsTab()
    await waitFor(() => expect(screen.getByText('Total Sessions')).toBeInTheDocument())

    // At rest (data loaded), nothing is busy.
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBe(0)

    // Switch window — stale content stays put and window-driven cards mark busy.
    fireEvent.click(screen.getByRole('button', { name: '30d' }))
    await waitFor(() => expect(document.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0))

    // Once the new-window data lands, the busy flag clears.
    releaseWindow()
    releaseCbat()
    await waitFor(() => expect(document.querySelectorAll('[aria-busy="true"]').length).toBe(0))
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
