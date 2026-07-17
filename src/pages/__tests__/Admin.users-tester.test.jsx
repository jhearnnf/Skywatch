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

    // One row → one header tester checkbox
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
})
