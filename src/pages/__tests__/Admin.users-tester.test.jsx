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

// No lastSeen → offline. Two offline users, one tester, one not.
const OFFLINE_PLAIN = {
  _id: 'u1', agentNumber: '001', email: 'plain@test.com',
  subscriptionTier: 'free', totalAirstars: 0, loginStreak: 0, logins: [],
  difficultySetting: 'easy', createdAt: new Date('2025-01-01').toISOString(),
  isAdmin: false, isBanned: false, isTester: false,
  profileStats: { brifsRead: 0 },
}
const OFFLINE_TESTER = {
  ...OFFLINE_PLAIN, _id: 'u2', agentNumber: '002', email: 'tester@test.com', isTester: true,
}

function setupFetch(users, patchSpy) {
  return vi.fn().mockImplementation((url, opts) => {
    if (url.includes('/tester') && opts?.method === 'PATCH') {
      patchSpy?.(url, opts)
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { isTester: JSON.parse(opts.body).isTester } }) })
    }
    if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function navigateToUsers() {
  const tab = await screen.findByRole('button', { name: /users/i })
  fireEvent.click(tab)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: tester flag', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('ticking the tester checkbox PATCHes /tester with isTester true', async () => {
    const patchSpy = vi.fn()
    global.fetch = setupFetch([OFFLINE_PLAIN], patchSpy)

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('plain@test.com'))

    // Checkbox only appears once the row is expanded
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))

    // One expanded row → one tester checkbox
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)

    await waitFor(() => expect(patchSpy).toHaveBeenCalled())
    const [url, opts] = patchSpy.mock.calls[0]
    expect(url).toMatch(/\/api\/admin\/users\/u1\/tester$/)
    expect(JSON.parse(opts.body)).toEqual({ isTester: true })
    // Optimistic update reflects immediately
    expect(checkbox.checked).toBe(true)
  })

  it('gives a tester who has NOT tested today the idle pulsing border', async () => {
    // No lastTestGameAt and no lastTestAppOpenAt → nothing today → idle
    global.fetch = setupFetch([OFFLINE_TESTER])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('tester@test.com'))

    const row = screen.getByText('tester@test.com').closest('.admin-tester-row')
    expect(row.className).toMatch(/admin-tester-idle/)
    expect(row.className).not.toMatch(/border-amber-700/)
  })

  it('does NOT flag a tester as idle when they played a test game today', async () => {
    const playedToday = { ...OFFLINE_TESTER, lastTestGameAt: new Date().toISOString() }
    global.fetch = setupFetch([playedToday])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('tester@test.com'))

    const row = screen.getByText('tester@test.com').closest('.admin-tester-row')
    expect(row.className).not.toMatch(/admin-tester-idle/)
    expect(row.className).toMatch(/border-amber-700/)
  })

  it('does NOT flag a tester as idle when they only opened the app today', async () => {
    // Opening the app is what beta testing asks of a tester, so a launch with no
    // game played still clears the row for the day.
    const openedApp = { ...OFFLINE_TESTER, lastTestAppOpenAt: new Date().toISOString() }
    global.fetch = setupFetch([openedApp])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('tester@test.com'))

    const row = screen.getByText('tester@test.com').closest('.admin-tester-row')
    expect(row.className).not.toMatch(/admin-tester-idle/)
    expect(row.className).toMatch(/border-amber-700/)
  })

  it('still flags a tester whose last app open was yesterday', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const stale = { ...OFFLINE_TESTER, lastTestAppOpenAt: yesterday.toISOString() }
    global.fetch = setupFetch([stale])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('tester@test.com'))

    const row = screen.getByText('tester@test.com').closest('.admin-tester-row')
    expect(row.className).toMatch(/admin-tester-idle/)
  })

  it('sorts an offline tester above an offline non-tester', async () => {
    // Array order puts the plain user first; the tester must still render first.
    global.fetch = setupFetch([OFFLINE_PLAIN, OFFLINE_TESTER])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('tester@test.com'))

    const testerEl = screen.getByText('tester@test.com')
    const plainEl  = screen.getByText('plain@test.com')
    // tester row appears before plain row in the DOM
    expect(testerEl.compareDocumentPosition(plainEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sorts a tester who owes a test today above one who has opened the app', async () => {
    const opened = {
      ...OFFLINE_TESTER, _id: 'u3', agentNumber: '003', email: 'played@test.com',
      lastTestAppOpenAt: new Date().toISOString(),
    }
    // Array order puts the satisfied tester first; the idle one must still lead.
    global.fetch = setupFetch([opened, OFFLINE_TESTER])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('tester@test.com'))

    const idleEl   = screen.getByText('tester@test.com')
    const playedEl = screen.getByText('played@test.com')
    expect(idleEl.compareDocumentPosition(playedEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps online status above tester urgency for a live tester', async () => {
    // Live tester who played today still outranks an offline tester who has not.
    const liveTester = {
      ...OFFLINE_TESTER, _id: 'u4', agentNumber: '004', email: 'live@test.com',
      lastSeen: new Date().toISOString(), lastTestGameAt: new Date().toISOString(),
    }
    global.fetch = setupFetch([OFFLINE_TESTER, liveTester])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('live@test.com'))

    const liveEl = screen.getByText('live@test.com')
    const idleEl = screen.getByText('tester@test.com')
    expect(liveEl.compareDocumentPosition(idleEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
