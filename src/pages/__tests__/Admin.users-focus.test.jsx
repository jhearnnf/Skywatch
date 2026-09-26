import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ─────────────────────────────────────────────────────────────────

// Arriving from "Manage in Admin" on Viper's agent profile.
const mockLocation = vi.hoisted(() => ({ state: { tab: 'users', focusUser: { id: 'u2', query: 'viper@test.com' } } }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => mockLocation,
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

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// The admin's own browser is the yardstick for "latest web build" — the server
// cannot know it, since the frontend deploys separately from the API.
const adminClientRef = vi.hoisted(() => ({ value: { platform: 'web', version: '1.3.0', build: 'bb11cc2' } }))
vi.mock('../../utils/appVersion', () => ({
  peekClientInfo: () => adminClientRef.value,
  getClientInfo:  () => Promise.resolve(adminClientRef.value),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const BASE = {
  agentNumber: '001', subscriptionTier: 'free', totalAirstars: 0, loginStreak: 0,
  logins: [], difficultySetting: 'easy', createdAt: new Date('2025-01-01').toISOString(),
  isAdmin: false, isBanned: false, isTester: false, profileStats: { brifsRead: 0 },
}
// A search can match more than the one agent (the query is a substring).
const VIPER      = { ...BASE, _id: 'u2', agentNumber: '1000042', displayName: 'Viper', email: 'viper@test.com' }
const VIPER_FAN  = { ...BASE, _id: 'u9', agentNumber: '1000099', displayName: 'Viperfan', email: 'viper@test.com.au' }

function setupFetch() {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/users/search'))   return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [VIPER, VIPER_FAN], latestClients: {} } }) })
    if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [VIPER_FAN], latestClients: {} } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('Admin — Users tab opened on one agent', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('opens on Users, searched for that agent, with only their row expanded', async () => {
    global.fetch = setupFetch()
    render(<Admin />)

    const viper = await screen.findByRole('button', { name: /collapse viper$/i })
    expect(viper).toHaveAttribute('aria-expanded', 'true')
    // Other hits of the same search stay closed, so the agent is the one open.
    expect(screen.getByRole('button', { name: /expand viperfan/i })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByDisplayValue('viper@test.com')).toBeInTheDocument()
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/api/admin/users/search?q=viper%40test.com'))).toBe(true)
  })
})
