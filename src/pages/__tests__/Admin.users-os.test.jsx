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

const SEEN_AT = new Date('2026-07-19T14:30:00Z').toISOString()

const MIXED_OS_USER = {
  ...BASE, _id: 'u1', email: 'mixed@test.com',
  lastSeen: SEEN_AT,
  osSeen: { windows: SEEN_AT, ios: SEEN_AT },
}

const LATEST_CLIENTS = { android: { version: '1.3.0', build: '8' }, ios: null }

function setupFetch(users, latestClients = LATEST_CLIENTS) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users, latestClients } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function showUsers(users, latestClients) {
  global.fetch = setupFetch(users, latestClients)
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: /users/i }))
  await waitFor(() => screen.getByText(users[0].email))
}

const rowFor = (email) => screen.getByText(email).closest('div')

describe('Admin — Users tab: OS spread', () => {
  beforeEach(() => {
    adminClientRef.value = { platform: 'web', version: '1.3.0', build: 'bb11cc2' }
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows lit badges for OSes the account has been seen on, without expanding the card', async () => {
    await showUsers([MIXED_OS_USER])

    expect(screen.getByTitle(/Seen on Windows/i)).toBeInTheDocument()
    expect(screen.getByTitle(/Seen on iOS/i)).toBeInTheDocument()
  })

  it('greys out an OS the account has never been seen on', async () => {
    await showUsers([MIXED_OS_USER])

    expect(screen.getByTitle('Never seen on Android')).toBeInTheDocument()
    expect(screen.getByTitle('Never seen on macOS')).toBeInTheDocument()
    expect(screen.getByTitle('Never seen on Linux')).toBeInTheDocument()
  })

  it('shows every OS as unseen when osSeen is entirely absent', async () => {
    const noOsData = { ...BASE, _id: 'u2', email: 'noos@test.com', lastSeen: SEEN_AT }
    await showUsers([noOsData])

    expect(screen.getByTitle('Never seen on Windows')).toBeInTheDocument()
    expect(screen.getByTitle('Never seen on macOS')).toBeInTheDocument()
    expect(screen.getByTitle('Never seen on Linux')).toBeInTheDocument()
    expect(screen.getByTitle('Never seen on iOS')).toBeInTheDocument()
    expect(screen.getByTitle('Never seen on Android')).toBeInTheDocument()
  })
})
