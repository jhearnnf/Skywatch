import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_STATS = {
  users: {
    totalUsers: 10, onlineUsers: 3, freeUsers: 5, trialUsers: 2, subscribedUsers: 3,
    easyPlayers: 6, mediumPlayers: 4, combinedStreaks: 20,
    emailsSent: 42, emailsFailed: 7,
  },
  games: {
    totalGamesPlayed: 50, totalGamesCompleted: 40, totalGamesWon: 30,
    totalPerfectScores: 5, totalGamesLost: 10, totalGamesAbandoned: 10,
    totalAirstarsEarned: 5000, quizTotalSeconds: 3600,
    boo:          { total: 5, won: 3, defeated: 1, abandoned: 1, totalSeconds: 600 },
    wta:          { total: 4, won: 2, abandoned: 1, round1Correct: 3, round2Correct: 2, totalSeconds: 300 },
    flashcard:    { sessions: 8, totalCards: 40, recalled: 30, abandoned: 2, totalSeconds: 200 },
    aptitudeSync: { total: 3, completed: 2, abandoned: 1, airstarsEarned: 120 },
  },
  briefs: { totalBrifsRead: 80, totalBrifsOpened: 120, totalReadSeconds: 10000 },
  tutorials: { viewed: 5, skipped: 2 },
  server: { serverUptimeSeconds: 3600, totalLoadingMs: 50000 },
}

const MOCK_OPENROUTER = {
  status: 'success',
  data: {
    main:      { today: 0.5,  todayCalls: 10, lifetime: 12.34 },
    aptitude:  { today: 0.1,  todayCalls: 3,  lifetime: 1.23  },
    socials:   { today: 0.05, todayCalls: 2,  lifetime: 0.75  },
    casefiles: { today: 0.07, todayCalls: 4,  lifetime: 5.67  },
  },
}

function setupFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: MOCK_STATS }) })
    }
    if (url.includes('/api/admin/openrouter/summary')) {
      return Promise.resolve({ ok: true, json: async () => MOCK_OPENROUTER })
    }
    if (url.includes('/api/admin/problems/count')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    }
    if (url.includes('/api/admin/email-logs')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { logs: [], total: 0, totalPages: 1 } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Stats tab: collapsible sections', () => {
  beforeEach(() => { global.fetch = setupFetch() })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders Users and OpenRouter sections open by default', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('$12.34')).toBeInTheDocument())     // OpenRouter lifetime main
  })

  it('renders TODAY and LIFETIME tiles for the casefiles key', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('$5.67')).toBeInTheDocument())     // casefiles lifetime
    // Two casefiles tiles (TODAY + LIFETIME) — find them via the shared label
    const labels = screen.getAllByText('casefiles')
    expect(labels.length).toBe(2)
  })

  it('renders Quiz/BOO/WTA/Flashcard/Aptitude sections closed by default', async () => {
    render(<Admin />)

    // Wait for stats to load before asserting hidden content
    await waitFor(() => expect(screen.getByText('Users')).toBeInTheDocument())

    // Section headers are visible, but their unique body labels are not
    expect(screen.getByText('Quiz')).toBeInTheDocument()
    expect(screen.queryByText('Perfect Score')).not.toBeInTheDocument()  // Quiz-only label
    expect(screen.queryByText('Defeated')).not.toBeInTheDocument()       // BOO-only label
    expect(screen.queryByText('R1 Correct (ID)')).not.toBeInTheDocument()// WTA-only label
    expect(screen.queryByText('Cards Total')).not.toBeInTheDocument()    // Flashcard-only label
    expect(screen.queryByText('Airstars Earned')).not.toBeInTheDocument()// Aptitude Sync-only label
  })

  it('expands Quiz section when its header is clicked', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users')).toBeInTheDocument())
    expect(screen.queryByText('Perfect Score')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Quiz'))
    expect(screen.getByText('Perfect Score')).toBeInTheDocument()
  })

  it('renders Emails Sent and Emails Failed cards with correct values', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Emails Sent')).toBeInTheDocument())
    expect(screen.getByText('Emails Failed')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument() // emailsSent
    expect(screen.getByText('7')).toBeInTheDocument()  // emailsFailed
  })

  it('clicking Emails Sent navigates to Intel → Email Logs with status=sent', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Emails Sent')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Emails Sent').closest('button'))

    // Intel tab → Email Logs sub is now active; status filter dropdown defaults to 'sent'
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Email Logs' })).toBeInTheDocument())
    const statusSelect = screen.getByDisplayValue('Sent')
    expect(statusSelect.value).toBe('sent')
  })

  it('clicking Emails Failed navigates to Intel → Email Logs with status=failed', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Emails Failed')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Emails Failed').closest('button'))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Email Logs' })).toBeInTheDocument())
    const statusSelect = screen.getByDisplayValue('Failed')
    expect(statusSelect.value).toBe('failed')
  })
})
