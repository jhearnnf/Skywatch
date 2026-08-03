import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: {}, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
  }),
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

vi.mock('../../hooks/useSlimMode', () => ({
  useSlimMode: () => false,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const TARGET = {
  _id: 'u1', agentNumber: '001', displayName: 'Maverick', email: 'plain@test.com', emailsSent: 3,
  subscriptionTier: 'free', totalAirstars: 0, loginStreak: 0, logins: [],
  difficultySetting: 'easy', createdAt: new Date('2025-01-01').toISOString(),
  isAdmin: false, isBanned: false, isTester: false,
  profileStats: { brifsRead: 0 },
}

const LOG = {
  _id: 'log1', type: 'app_invite', status: 'sent',
  recipientEmail: 'plain@test.com', subject: 'You are invited',
  sentAt: new Date('2026-02-01').toISOString(),
  recipientUserId: { _id: 'u1', displayName: 'Maverick', agentNumber: '001' },
}

function setupFetch(emailLogSpy, users = [TARGET]) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/email-logs')) {
      emailLogSpy?.(url)
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { logs: [LOG], total: 1, page: 1, totalPages: 1 } }) })
    }
    if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function openUserRow() {
  fireEvent.click(await screen.findByRole('button', { name: /users/i }))
  fireEvent.click(await screen.findByText('Maverick'))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: email history', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('badges the icon with how many emails that user has been sent', async () => {
    global.fetch = setupFetch()

    render(<Admin />)
    await openUserRow()

    const btn = screen.getByRole('button', { name: /view email history/i })
    expect(within(btn).getByText('3')).toBeTruthy()
  })

  it('shows no badge for a user we have never emailed', async () => {
    global.fetch = setupFetch(undefined, [{ ...TARGET, emailsSent: 0 }])

    render(<Admin />)
    await openUserRow()

    const btn = screen.getByRole('button', { name: /view email history/i })
    expect(within(btn).queryByText('0')).toBeNull()
  })

  it('jumps to Email Logs filtered to the user and shows a clearable filter chip', async () => {
    const emailLogSpy = vi.fn()
    global.fetch = setupFetch(emailLogSpy)

    render(<Admin />)
    await openUserRow()

    fireEvent.click(screen.getByRole('button', { name: /view email history/i }))

    // Landed on Intel ▸ Email Logs with the userId filter applied, and the chip
    // names the agent so it is obvious the list is not the whole log
    await screen.findByText(/Email history for/i)
    expect(screen.getByText('Maverick')).toBeTruthy()
    expect(emailLogSpy).toHaveBeenCalled()
    expect(emailLogSpy.mock.calls[0][0]).toMatch(/userId=u1/)

    // "Show all" drops the filter and refetches unscoped
    emailLogSpy.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /show all/i }))

    await waitFor(() => expect(screen.queryByText(/Email history for/i)).toBeNull())
    expect(emailLogSpy).toHaveBeenCalled()
    expect(emailLogSpy.mock.calls[0][0]).not.toMatch(/userId=/)
  })

  it('does not reapply the user filter when Intel is re-entered later', async () => {
    const emailLogSpy = vi.fn()
    global.fetch = setupFetch(emailLogSpy)

    render(<Admin />)
    await openUserRow()

    fireEvent.click(screen.getByRole('button', { name: /view email history/i }))
    await screen.findByText(/Email history for/i)

    // Leave Intel, then come back via the tab bar
    fireEvent.click(screen.getByRole('button', { name: /users/i }))
    await screen.findByText('Maverick')
    emailLogSpy.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /intel/i }))

    // Defaults back to Reports, not a stale filtered Email Logs view
    await waitFor(() => expect(screen.queryByText('Maverick')).toBeNull())
    expect(screen.queryByText(/Email history for/i)).toBeNull()
    expect(emailLogSpy).not.toHaveBeenCalled()
  })
})
