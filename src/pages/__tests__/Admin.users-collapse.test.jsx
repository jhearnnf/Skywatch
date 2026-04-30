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
    refreshUser: vi.fn(),
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
  TUTORIAL_KEYS: [],
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: () => true }),
}))

vi.mock('../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(), previewTypingSound: vi.fn(), previewGridRevealTone: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeUser(overrides) {
  return {
    agentNumber: '000',
    email: 'x@test.com',
    isAdmin: false,
    isBanned: false,
    subscriptionTier: 'free',
    difficultySetting: 'easy',
    totalAirstars: 0,
    loginStreak: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    profileStats: { brifsRead: 0, quizzesPlayed: 0, booPlayed: 0, wtaPlayed: 0, wherePlayed: 0, flashcardsPlayed: 0, cbatPlayed: 0, cbatStarted: 0 },
    gameUnlocks: {},
    tutorials: {},
    ...overrides,
  }
}

const MOCK_USERS = [
  makeUser({ _id: 'admin1', agentNumber: '001', email: 'me@test.com',    isAdmin: true,  subscriptionTier: 'gold' }),
  makeUser({ _id: 'user2',  agentNumber: '002', email: 'user2@test.com', isAdmin: false, subscriptionTier: 'free' }),
  makeUser({ _id: 'user3',  agentNumber: '003', email: 'user3@test.com', isAdmin: false, subscriptionTier: 'free' }),
]

function setupFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/users/search')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: MOCK_USERS } }) })
    }
    if (url.includes('/api/admin/users')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: MOCK_USERS } }) })
    }
    if (url.includes('/api/admin/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({
        status: 'success',
        data: {
          users:  { totalUsers: 0, freeUsers: 0, trialUsers: 0, subscribedUsers: 0, easyPlayers: 0, mediumPlayers: 0, combinedStreaks: 0, emailsSent: 0, emailsFailed: 0 },
          games:  { boo: {}, wta: {}, flashcard: {}, aptitudeSync: {} },
          briefs: {},
          tutorials: {},
          server: {},
        },
      }) })
    }
    if (url.includes('/api/admin/openrouter/summary')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { main: {}, aptitude: {}, socials: {}, casefiles: {} } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: {} }) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: collapsible rows', () => {
  beforeEach(() => { global.fetch = setupFetch() })
  afterEach(() => { vi.restoreAllMocks() })

  async function openUsersTab() {
    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))
    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())
  }

  it('expands the current admin by default and keeps other users collapsed', async () => {
    await openUsersTab()

    // All three rows render their headers
    expect(screen.getByText('Agent 001')).toBeInTheDocument()
    expect(screen.getByText('Agent 002')).toBeInTheDocument()
    expect(screen.getByText('Agent 003')).toBeInTheDocument()

    // Stats grid (only inside expanded rows) — "Joined" label appears once for admin1 only
    expect(screen.getAllByText('Joined').length).toBe(1)
  })

  it('expands a collapsed user when their header is clicked', async () => {
    await openUsersTab()

    expect(screen.getAllByText('Joined').length).toBe(1)

    fireEvent.click(screen.getByLabelText('Expand Agent 002'))

    await waitFor(() => expect(screen.getAllByText('Joined').length).toBe(2))
  })

  it('collapses an expanded user when their header is clicked again', async () => {
    await openUsersTab()

    fireEvent.click(screen.getByLabelText('Collapse Agent 001'))

    await waitFor(() => expect(screen.queryAllByText('Joined').length).toBe(0))
  })

  it('Expand all and Collapse all buttons toggle every row', async () => {
    await openUsersTab()

    fireEvent.click(screen.getByText('Expand all'))
    expect(screen.getAllByText('Joined').length).toBe(3)

    fireEvent.click(screen.getByText('Collapse all'))
    expect(screen.queryAllByText('Joined').length).toBe(0)
  })
})
