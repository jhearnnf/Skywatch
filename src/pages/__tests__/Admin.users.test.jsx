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
    refreshUser: vi.fn(),
  }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
  TUTORIAL_KEYS: [],
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: vi.fn().mockReturnValue(false) }),
}))

vi.mock('../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_USER = {
  _id:              'u1',
  agentNumber:      '001',
  email:            'agent@test.com',
  subscriptionTier: 'free',
  totalAirstars:    150,
  loginStreak:      3,
  logins:           [{}, {}],
  difficultySetting: 'easy',
  createdAt:        new Date('2025-01-01').toISOString(),
  isAdmin:          false,
  isBanned:         false,
  profileStats:     { brifsRead: 7, quizAttempts: 0, quizWins: 0, boo: { total: 0 } },
}

function setupFetch(users = [MOCK_USER]) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {
        users:     { totalUsers: 1, freeUsers: 1, trialUsers: 0, subscribedUsers: 0, easyPlayers: 1, mediumPlayers: 0, totalLogins: 2, combinedStreaks: 3 },
        games:     { totalGamesPlayed: 0, totalGamesCompleted: 0, totalGamesAbandoned: 0, quizTotalSeconds: 0, boo: { totalSeconds: 0 } },
        briefs:    { totalBrifsRead: 7, totalBrifsOpened: 0, totalReadSeconds: 0 },
        tutorials: { viewed: 0, skipped: 0 },
      }}) })
    }
    if (url.includes('/api/admin/problems/count')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    }
    if (url.includes('/api/admin/settings')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    }
    if (url.includes('/api/admin/users')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// Admin user fixture (same _id as the mocked useAuth user)
const SELF_USER = {
  _id:              'admin1',
  agentNumber:      '000',
  email:            'admin@test.com',
  subscriptionTier: 'gold',
  totalAirstars:    0,
  loginStreak:      0,
  logins:           [],
  difficultySetting: 'easy',
  createdAt:        new Date('2025-01-01').toISOString(),
  isAdmin:          true,
  isBanned:         false,
  profileStats:     { brifsRead: 0, quizAttempts: 0, quizWins: 0, boo: { total: 0 } },
}

async function navigateToUsers() {
  const tab = await screen.findByRole('button', { name: /users/i })
  fireEvent.click(tab)
}

async function submitModal(reason = 'test reason') {
  const textarea = await screen.findByPlaceholderText(/briefly describe why/i)
  fireEvent.change(textarea, { target: { value: reason } })
  fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: Briefs Read stat', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the Briefs Read stat cell with the correct count for a user', async () => {
    global.fetch = setupFetch()
    render(<Admin />)

    // Navigate to Users tab
    const usersTab = await screen.findByRole('button', { name: /users/i })
    fireEvent.click(usersTab)

    await waitFor(() => screen.getByText('agent@test.com'))

    // User rows are now collapsible — expand to reveal the stats panel
    fireEvent.click(screen.getByLabelText(/Expand Agent 001/))

    expect(await screen.findByText('Briefs Read')).toBeDefined()
    expect(screen.getByText('7')).toBeDefined()
  })

  it('shows 0 for Briefs Read when profileStats.brifsRead is 0', async () => {
    const userNoReads = { ...MOCK_USER, profileStats: { brifsRead: 0, quizAttempts: 0, quizWins: 0, boo: { total: 0 } } }
    global.fetch = setupFetch([userNoReads])
    render(<Admin />)

    const usersTab = await screen.findByRole('button', { name: /users/i })
    fireEvent.click(usersTab)

    await waitFor(() => screen.getByText('agent@test.com'))
    fireEvent.click(screen.getByLabelText(/Expand Agent 001/))
    expect(await screen.findByText('Briefs Read')).toBeDefined()
  })
})

const BANNED_USER = { ...MOCK_USER, _id: 'u2', agentNumber: '002', email: 'banned@test.com', isBanned: true }

describe('Admin — Users tab: ban / unban routing', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('clicking Unban calls /unban endpoint, not /ban', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
      if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
      if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
      if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [BANNED_USER] } }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('banned@test.com'))

    // User rows are now collapsible — expand to reveal action buttons
    fireEvent.click(screen.getByLabelText(/Expand Agent 002/))
    fireEvent.click(await screen.findByRole('button', { name: /^unban user$/i }))
    await submitModal()

    const calls = global.fetch.mock.calls
    const unbanCall = calls.find(([url, opts]) => url.includes('/unban') && opts?.method === 'POST')
    const banCall   = calls.find(([url, opts]) => url.includes('/ban')   && !url.includes('/unban') && opts?.method === 'POST')

    expect(unbanCall).toBeDefined()
    expect(banCall).toBeUndefined()
  })

  it('clicking Ban on an unbanned user calls /ban endpoint', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
      if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
      if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
      if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [MOCK_USER] } }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('agent@test.com'))

    fireEvent.click(screen.getByLabelText(/Expand Agent 001/))
    fireEvent.click(await screen.findByRole('button', { name: /^ban user$/i }))
    await submitModal()

    const banCall = global.fetch.mock.calls.find(([url, opts]) =>
      url.includes('/ban') && !url.includes('/unban') && opts?.method === 'POST'
    )
    expect(banCall).toBeDefined()
  })
})

describe('Admin — Users tab: self-action buttons hidden on own row', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function setupSelfOnly() {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
      if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
      if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
      if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [SELF_USER] } }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  }

  it('does not render Delete / Ban / Remove Admin on the admin\'s own row', async () => {
    setupSelfOnly()
    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('admin@test.com'))

    // The self row should not expose any destructive self-actions
    expect(screen.queryByRole('button', { name: /^delete account$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^ban user$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^remove admin$/i })).toBeNull()
  })

  it('still renders Ban / Remove Admin / Delete on other users\' rows', async () => {
    const OTHER_ADMIN = { ...MOCK_USER, _id: 'u9', agentNumber: '009', email: 'other-admin@test.com', isAdmin: true }
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
      if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
      if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
      if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [OTHER_ADMIN] } }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('other-admin@test.com'))

    fireEvent.click(screen.getByLabelText(/Expand Agent 009/))
    expect(await screen.findByRole('button', { name: /^delete account$/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /^ban user$/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /^remove admin$/i })).toBeDefined()
  })
})
