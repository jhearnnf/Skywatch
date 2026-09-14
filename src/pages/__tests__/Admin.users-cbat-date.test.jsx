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
    if (url.includes('/cbat-date') && opts?.method === 'PATCH') {
      spy?.(url, opts)
      if (!ok) return Promise.resolve({ ok: false, json: async () => ({ message }) })
      const { cbatDate } = JSON.parse(opts.body)
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success', data: { cbatDate: cbatDate ? `${cbatDate}T00:00:00.000Z` : null } }),
      })
    }
    if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function expandRow(users, opts) {
  global.fetch = setupFetch(users, opts)
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: /users/i }))
  await waitFor(() => screen.getByText('plain@test.com'))
  fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: CBAT date', () => {
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

    expect(screen.queryByLabelText('CBAT date')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(screen.getByLabelText('CBAT date')).toBeTruthy()
  })

  it('saves a picked date to /cbat-date', async () => {
    const spy = vi.fn()
    await expandRow([AGENT], { spy })

    expect(screen.getByRole('button', { name: 'Save CBAT date' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('CBAT date'), { target: { value: '2026-10-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save CBAT date' }))

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [url, opts] = spy.mock.calls[0]
    expect(url).toMatch(/\/api\/admin\/users\/u1\/cbat-date$/)
    expect(JSON.parse(opts.body)).toEqual({ cbatDate: '2026-10-05' })
    await screen.findByText('CBAT date set to 5 Oct 2026')
  })

  it('prefills a stored date and clears it', async () => {
    const spy = vi.fn()
    await expandRow([{ ...AGENT, cbatDate: '2026-10-05T00:00:00.000Z' }], { spy })

    expect(screen.getByLabelText('CBAT date').value).toBe('2026-10-05')

    fireEvent.click(screen.getByRole('button', { name: 'Clear CBAT date' }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ cbatDate: '' })
    await screen.findByText('CBAT date cleared')
    expect(screen.getByLabelText('CBAT date').value).toBe('')
    expect(screen.queryByRole('button', { name: 'Clear CBAT date' })).toBeNull()
  })

  it('surfaces a rejected date as a toast', async () => {
    await expandRow([AGENT], { ok: false, message: 'CBAT date must be a calendar date (YYYY-MM-DD).' })

    fireEvent.change(screen.getByLabelText('CBAT date'), { target: { value: '2026-10-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save CBAT date' }))

    await screen.findByText('CBAT date must be a calendar date (YYYY-MM-DD).')
  })
})
