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
  cbatPassed: false, cbatPassedAt: null,
  profileStats: { brifsRead: 0 },
}

function setupFetch(users, { patchSpy, patchOk = true } = {}) {
  return vi.fn().mockImplementation((url, opts) => {
    if (url.includes('/cbat-passed') && opts?.method === 'PATCH') {
      patchSpy?.(url, opts)
      if (!patchOk) return Promise.resolve({ ok: false, json: async () => ({ message: 'nope' }) })
      const cbatPassed = JSON.parse(opts.body).cbatPassed
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success', data: { cbatPassed, cbatPassedAt: cbatPassed ? new Date().toISOString() : null } }),
      })
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

describe('Admin — Users tab: passed CBAT flag', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
    localStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('offers the checkbox only once the row is expanded', async () => {
    global.fetch = setupFetch([AGENT])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('plain@test.com'))

    expect(screen.queryByLabelText('passed CBAT')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(screen.getByLabelText('passed CBAT')).toBeTruthy()
  })

  it('ticking it PATCHes /cbat-passed with cbatPassed true', async () => {
    const patchSpy = vi.fn()
    global.fetch = setupFetch([AGENT], { patchSpy })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('plain@test.com'))
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))

    const checkbox = screen.getByLabelText('passed CBAT')
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)

    await waitFor(() => expect(patchSpy).toHaveBeenCalled())
    const [url, opts] = patchSpy.mock.calls[0]
    expect(url).toMatch(/\/api\/admin\/users\/u1\/cbat-passed$/)
    expect(JSON.parse(opts.body)).toEqual({ cbatPassed: true })
    // Optimistic update reflects immediately
    expect(checkbox.checked).toBe(true)
  })

  it('unticking it PATCHes cbatPassed false', async () => {
    const patchSpy = vi.fn()
    global.fetch = setupFetch(
      [{ ...AGENT, cbatPassed: true, cbatPassedAt: new Date('2026-03-01').toISOString() }],
      { patchSpy },
    )

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('plain@test.com'))
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))

    const checkbox = screen.getByLabelText('passed CBAT')
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)

    await waitFor(() => expect(patchSpy).toHaveBeenCalled())
    expect(JSON.parse(patchSpy.mock.calls[0][1].body)).toEqual({ cbatPassed: false })
    expect(checkbox.checked).toBe(false)
  })

  it('reverts the tick and warns when the save fails', async () => {
    global.fetch = setupFetch([AGENT], { patchOk: false })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('plain@test.com'))
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))

    const checkbox = screen.getByLabelText('passed CBAT')
    fireEvent.click(checkbox)

    await waitFor(() => screen.getByText('Could not update CBAT pass'))
    expect(checkbox.checked).toBe(false)
  })

  it('keeps the row expanded after ticking, so the checkbox stays reachable', async () => {
    const patchSpy = vi.fn()
    global.fetch = setupFetch([AGENT], { patchSpy })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('plain@test.com'))
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))

    fireEvent.click(screen.getByLabelText('passed CBAT'))
    await waitFor(() => expect(patchSpy).toHaveBeenCalled())

    // The optimistic rewrite of the users array must not collapse the row
    const stillThere = screen.getByLabelText('passed CBAT')
    expect(stillThere.checked).toBe(true)
  })

  it('leaves the tester flag alone', async () => {
    const patchSpy = vi.fn()
    global.fetch = setupFetch([AGENT], { patchSpy })

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('plain@test.com'))
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))

    fireEvent.click(screen.getByLabelText('passed CBAT'))
    await waitFor(() => expect(patchSpy).toHaveBeenCalled())

    expect(screen.getByLabelText('tester').checked).toBe(false)
  })
})
