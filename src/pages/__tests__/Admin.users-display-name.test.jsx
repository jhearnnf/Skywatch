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

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: {}, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
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

const AGENT = {
  _id: 'u1', agentNumber: '001', email: 'plain@test.com',
  subscriptionTier: 'free', totalAirstars: 0, loginStreak: 0, logins: [],
  difficultySetting: 'easy', createdAt: new Date('2025-01-01').toISOString(),
  isAdmin: false, isBanned: false, isTester: false,
  cbatPassed: false, cbatPassedAt: null, cbatDate: null,
  redditUsername: null, cbatResultImages: [],
  profileStats: { brifsRead: 0 },
}

function setupFetch(users, { spy, ok = true, message = 'nope' } = {}) {
  return vi.fn().mockImplementation((url, opts) => {
    if (url.includes('/display-name') && opts?.method === 'PATCH') {
      spy?.(url, opts)
      if (!ok) return Promise.resolve({ ok: false, json: async () => ({ message }) })
      const { displayName } = JSON.parse(opts.body)
      users = users.map(u => url.includes(`/users/${u._id}/`) ? { ...u, displayName: displayName || null } : u)
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { displayName: displayName || null } }) })
    }
    if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// The expand button is named after the display name when there is one.
async function expandRow(users, opts) {
  global.fetch = setupFetch(users, opts)
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: /users/i }))
  await waitFor(() => screen.getByText('plain@test.com'))
  const name = users[0].displayName || 'Agent 001'
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`expand ${name}`, 'i') }))
}

// The reason modal's confirm button: the last "Confirm" on screen once it is open.
function confirmModal() {
  fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: display name', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
    localStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows the field only once the row is expanded', async () => {
    global.fetch = setupFetch([AGENT])

    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: /users/i }))
    await waitFor(() => screen.getByText('plain@test.com'))

    expect(screen.queryByLabelText('Display name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(screen.getByLabelText('Display name')).toBeTruthy()
    expect(screen.getByLabelText('Display name').value).toBe('')
    expect(screen.queryByRole('button', { name: 'Clear display name' })).toBeNull()
  })

  it('renames through the reason modal and shows the new name on the row', async () => {
    const spy = vi.fn()
    await expandRow([{ ...AGENT, displayName: 'CumBum' }], { spy })

    expect(screen.getByLabelText('Display name').value).toBe('CumBum')
    expect(screen.getByRole('button', { name: 'Save display name' }).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Well Behaved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }))

    // Nothing is sent until the reason modal confirms.
    expect(spy).not.toHaveBeenCalled()
    await screen.findByText('Rename Agent 001 → Well Behaved')
    fireEvent.change(screen.getByPlaceholderText(/briefly describe why/i), { target: { value: 'silly name' } })
    confirmModal()

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [url, opts] = spy.mock.calls[0]
    expect(url).toMatch(/\/api\/admin\/users\/u1\/display-name$/)
    expect(JSON.parse(opts.body)).toEqual({ displayName: 'Well Behaved', reason: 'silly name' })

    await screen.findByText('Action completed')
    await waitFor(() => expect(screen.getByLabelText('Display name').value).toBe('Well Behaved'))
  })

  it('clears a stored name', async () => {
    const spy = vi.fn()
    await expandRow([{ ...AGENT, displayName: 'CumBum' }], { spy })

    fireEvent.click(screen.getByRole('button', { name: 'Clear display name' }))
    await screen.findByText('Clear display name — Agent 001')
    confirmModal()

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ displayName: '', reason: 'testing' })
    await waitFor(() => expect(screen.getByLabelText('Display name').value).toBe(''))
    expect(screen.queryByRole('button', { name: 'Clear display name' })).toBeNull()
  })

  it('surfaces a rejected name as a toast', async () => {
    await expandRow([AGENT], { ok: false, message: 'That display name is already taken.' })

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Falcon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }))
    await screen.findByText('Rename Agent 001 → Falcon')
    confirmModal()

    await screen.findByText('That display name is already taken.')
  })
})
