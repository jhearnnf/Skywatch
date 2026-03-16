import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
    loading: false,
    API: '',
    awardAircoins: vi.fn(),
    setUser: vi.fn(),
    refreshUser: vi.fn(),
  }),
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
}))

vi.mock('../../../utils/sound', () => ({
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
  totalAircoins:    150,
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
  totalAircoins:    0,
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

    // Find the user card and assert the Briefs Read stat within it
    const card = screen.getByText('agent@test.com').closest('div[class*="border"]') ??
                 screen.getByText('agent@test.com').parentElement.parentElement

    expect(screen.getByText('Briefs Read')).toBeDefined()
    expect(screen.getByText('7')).toBeDefined()
  })

  it('shows 0 for Briefs Read when profileStats.brifsRead is 0', async () => {
    const userNoReads = { ...MOCK_USER, profileStats: { brifsRead: 0, quizAttempts: 0, quizWins: 0, boo: { total: 0 } } }
    global.fetch = setupFetch([userNoReads])
    render(<Admin />)

    const usersTab = await screen.findByRole('button', { name: /users/i })
    fireEvent.click(usersTab)

    await waitFor(() => screen.getByText('agent@test.com'))
    expect(screen.getByText('Briefs Read')).toBeDefined()
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

    fireEvent.click(screen.getByRole('button', { name: /^unban$/i }))
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

    fireEvent.click(screen.getByRole('button', { name: /^ban$/i }))
    await submitModal()

    const banCall = global.fetch.mock.calls.find(([url, opts]) =>
      url.includes('/ban') && !url.includes('/unban') && opts?.method === 'POST'
    )
    expect(banCall).toBeDefined()
  })
})

describe('Admin — Users tab: self-action error toasts', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows error toast when admin tries to delete their own account', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/admin/stats'))         return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
      if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
      if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
      if (url.includes('/api/admin/users') && opts?.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ message: 'You cannot delete your own account' }) })
      }
      if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [SELF_USER] } }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('admin@test.com'))

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await submitModal()

    await waitFor(() =>
      expect(screen.getByText('You cannot delete your own account')).toBeDefined()
    )
  })

  it('shows error toast when admin tries to ban their own account', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
      if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
      if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
      if (url.includes('/ban')) {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ message: 'You cannot ban your own account.' }) })
      }
      if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [SELF_USER] } }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('admin@test.com'))

    fireEvent.click(screen.getByRole('button', { name: /^ban$/i }))
    await submitModal()

    await waitFor(() =>
      expect(screen.getByText('You cannot ban your own account.')).toBeDefined()
    )
  })

  it('shows error toast when admin tries to remove their own admin status', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/admin/stats'))         return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
      if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
      if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
      if (url.includes('remove-admin')) {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ message: 'You cannot remove your own admin access.' }) })
      }
      if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [SELF_USER] } }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('admin@test.com'))

    fireEvent.click(screen.getByRole('button', { name: /^remove admin$/i }))
    await submitModal()

    await waitFor(() =>
      expect(screen.getByText('You cannot remove your own admin access.')).toBeDefined()
    )
  })
})
