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

const ALL_USERS = [
  makeUser({ _id: 'admin1', agentNumber: '001', email: 'me@test.com',    isAdmin: true, subscriptionTier: 'gold' }),
  makeUser({ _id: 'user2',  agentNumber: '002', email: 'user2@test.com' }),
  makeUser({ _id: 'user3',  agentNumber: '003', email: 'user3@test.com' }),
]

const SEARCH_HIT = [makeUser({ _id: 'user2', agentNumber: '002', email: 'user2@test.com' })]

// The whole point of this file: hold the full-population response open so the
// search can be fired — and answered — while it is still in flight.
function setupFetch() {
  let releaseFullList
  const fullListPending = new Promise(resolve => { releaseFullList = resolve })

  const fetchMock = vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/users/search')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: SEARCH_HIT } }) })
    }
    if (url.includes('/api/admin/users')) {
      return fullListPending.then(() => ({ ok: true, json: async () => ({ status: 'success', data: { users: ALL_USERS } }) }))
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

  return { fetchMock, releaseFullList }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: search vs. slow full-list load', () => {
  let releaseFullList

  beforeEach(() => {
    const s = setupFetch()
    global.fetch = s.fetchMock
    releaseFullList = s.releaseFullList
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('keeps the search results when the slow full-list response lands afterwards', async () => {
    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))

    // The full list is still in flight, so nothing is listed yet.
    expect(screen.queryByText('Agent 001')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search by email or agent number…'), {
      target: { value: 'user2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(screen.getByText('Agent 002')).toBeInTheDocument())
    expect(screen.queryByText('Agent 001')).not.toBeInTheDocument()

    // Now let the stale full-population request answer. It must not repopulate
    // the list behind the admin's back.
    releaseFullList()
    await Promise.resolve()

    await waitFor(() => expect(screen.getByText('Agent 002')).toBeInTheDocument())
    expect(screen.queryByText('Agent 001')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent 003')).not.toBeInTheDocument()
    // Still in search mode, so the Clear escape hatch is on offer.
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('Clear returns the full list once it arrives', async () => {
    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))

    fireEvent.change(screen.getByPlaceholderText('Search by email or agent number…'), {
      target: { value: 'user2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.getByText('Agent 002')).toBeInTheDocument())

    releaseFullList()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(screen.getByText('Agent 001')).toBeInTheDocument())
    expect(screen.getByText('Agent 003')).toBeInTheDocument()
  })
})
