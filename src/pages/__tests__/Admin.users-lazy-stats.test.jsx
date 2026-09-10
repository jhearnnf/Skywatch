import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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
    gameUnlocks: {},
    tutorials: {},
    statsLoaded: false,
    ...overrides,
  }
}

// What the list endpoint sends: identity and status, and none of the counted
// stats — those cost an aggregation per gameplay collection, so they are left
// to /users/stats and fetched per opened row.
const LIGHT_USERS = [
  makeUser({ _id: 'admin1', agentNumber: '001', email: 'me@test.com', isAdmin: true, subscriptionTier: 'gold' }),
  makeUser({ _id: 'user2',  agentNumber: '002', email: 'user2@test.com' }),
  makeUser({ _id: 'user3',  agentNumber: '003', email: 'user3@test.com' }),
]

const STATS = {
  user2: {
    profileStats: { brifsRead: 7, quizzesPlayed: 2, booPlayed: 1, wtaPlayed: 0, wherePlayed: 0, flashcardsPlayed: 0, cbatPlayed: 12, cbatStarted: 15 },
    emailsSent: 4,
    lastTestGameAt: null,
  },
  user3: {
    profileStats: { brifsRead: 1, quizzesPlayed: 0, booPlayed: 0, wtaPlayed: 0, wherePlayed: 0, flashcardsPlayed: 0, cbatPlayed: 0, cbatStarted: 0 },
    emailsSent: 0,
    lastTestGameAt: null,
  },
}

// holdList / holdStats keep a response open so the loading state can be read
// before it resolves; the returned release functions answer it.
function setupFetch({ holdList = false, holdStats = false, failStats = false } = {}) {
  const statsCalls = []
  let releaseList = () => {}
  let releaseStats = () => {}
  const listGate  = new Promise(resolve => { releaseList = resolve })
  const statsGate = new Promise(resolve => { releaseStats = resolve })

  const fetchMock = vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/users/stats')) {
      const ids = new URL(url, 'http://x').searchParams.get('ids')?.split(',') ?? []
      statsCalls.push(ids)
      if (failStats) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      const stats = Object.fromEntries(ids.filter(id => STATS[id]).map(id => [id, STATS[id]]))
      const answer = { ok: true, json: async () => ({ status: 'success', data: { stats } }) }
      return holdStats ? statsGate.then(() => answer) : Promise.resolve(answer)
    }
    if (url.includes('/api/admin/users/search')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [] } }) })
    }
    if (url.includes('/api/admin/users')) {
      const answer = { ok: true, json: async () => ({ status: 'success', data: { users: LIGHT_USERS } }) }
      return holdList ? listGate.then(() => answer) : Promise.resolve(answer)
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

  return { fetchMock, statsCalls, releaseList, releaseStats }
}

const shimmerCount = () => document.querySelectorAll('.skeleton-shimmer').length

async function openUsersTab() {
  render(<Admin />)
  fireEvent.click(screen.getByText('Users'))
  await waitFor(() => expect(screen.getByText('Agent 002')).toBeInTheDocument())
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: per-row stats are fetched lazily', () => {
  let statsCalls

  beforeEach(() => {
    localStorage.clear()
    const s = setupFetch()
    global.fetch = s.fetchMock
    statsCalls = s.statsCalls
  })
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('asks for no stats at all while every row is collapsed', async () => {
    await openUsersTab()
    expect(statsCalls).toEqual([])
  })

  it('fetches stats for a row when it is expanded, and shows them', async () => {
    await openUsersTab()

    fireEvent.click(screen.getByLabelText('Expand Agent 002'))

    await waitFor(() => expect(statsCalls).toEqual([['user2']]))
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument())   // Briefs Read
    expect(screen.getByText('12/15')).toBeInTheDocument()                     // CBAT Games Finished
    expect(screen.getByText('3')).toBeInTheDocument()                         // Games — 2 quizzes + 1 BOO
  })

  it('fetches only the row that was opened, not its neighbours', async () => {
    await openUsersTab()

    fireEvent.click(screen.getByLabelText('Expand Agent 003'))
    await waitFor(() => expect(statsCalls).toEqual([['user3']]))
    expect(statsCalls.flat()).not.toContain('user2')
  })

  it('does not fetch a second time when a row is re-opened', async () => {
    await openUsersTab()

    fireEvent.click(screen.getByLabelText('Expand Agent 002'))
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Collapse Agent 002'))
    fireEvent.click(screen.getByLabelText('Expand Agent 002'))
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument())

    expect(statsCalls).toEqual([['user2']])
  })
})

describe('Admin — Users tab: an opened row while its stats are in flight', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('shimmers only the counted cells, leaving the rest of the panel readable', async () => {
    const s = setupFetch({ holdStats: true })
    global.fetch = s.fetchMock

    await openUsersTab()
    fireEvent.click(screen.getByLabelText('Expand Agent 002'))

    // Briefs Read, Games and CBAT Games Finished are the three that are counted.
    await waitFor(() => expect(shimmerCount()).toBe(3))
    expect(screen.getByText('Briefs Read')).toBeInTheDocument()
    expect(screen.getByText('Joined')).toBeInTheDocument()
    expect(screen.getByText('Last online')).toBeInTheDocument()

    await act(async () => { s.releaseStats() })

    await waitFor(() => expect(shimmerCount()).toBe(0))
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('marks the cells rather than shimmering forever when the fetch fails', async () => {
    const s = setupFetch({ failStats: true })
    global.fetch = s.fetchMock

    await openUsersTab()
    fireEvent.click(screen.getByLabelText('Expand Agent 002'))

    // Scoped by title: an em dash on its own also stands for an empty date
    // elsewhere in the panel, and this is specifically the unreadable-stat mark.
    await waitFor(() => expect(screen.getAllByTitle(/Could not load this number/).length).toBe(3))
    expect(shimmerCount()).toBe(0)
  })

  it('asks once, not forever, when the answer comes back without that row', async () => {
    // The merge that follows a stats answer hands the effect a fresh users
    // array, so an id the server never answers for has to be marked or the
    // request repeats on every pass.
    const calls = []
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/admin/users/stats')) {
        calls.push(url)
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { stats: {} } }) })
      }
      return setupFetch().fetchMock(url)
    })

    await openUsersTab()
    fireEvent.click(screen.getByLabelText('Expand Agent 002'))

    await waitFor(() => expect(screen.getAllByTitle(/Could not load this number/).length).toBe(3))
    const settled = calls.length
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(calls.length).toBe(settled)
    expect(settled).toBe(1)
  })

  it('retries a failed row when it is opened again', async () => {
    const s = setupFetch({ failStats: true })
    global.fetch = s.fetchMock

    await openUsersTab()
    fireEvent.click(screen.getByLabelText('Expand Agent 002'))
    await waitFor(() => expect(screen.getAllByTitle(/Could not load this number/).length).toBe(3))

    // Second attempt succeeds.
    const ok = setupFetch()
    global.fetch = ok.fetchMock
    fireEvent.click(screen.getByLabelText('Collapse Agent 002'))
    fireEvent.click(screen.getByLabelText('Expand Agent 002'))

    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument())
    expect(ok.statsCalls).toEqual([['user2']])
  })
})

describe('Admin — Users tab: the skeleton holds the page height', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('renders one skeleton row per row the page is about to hold', async () => {
    const s = setupFetch({ holdList: true })
    global.fetch = s.fetchMock

    render(<Admin />)
    fireEvent.click(screen.getByText('Users'))

    // A page is 20 rows, and three shimmer bars stand in for each one's version
    // verdict, name and email — so the page is its real height before it lands.
    await waitFor(() => expect(shimmerCount()).toBe(20 * 3))
    expect(screen.queryByText('Agent 002')).not.toBeInTheDocument()

    await act(async () => { s.releaseList() })

    await waitFor(() => expect(screen.getByText('Agent 002')).toBeInTheDocument())
    expect(shimmerCount()).toBe(0)
  })
})
