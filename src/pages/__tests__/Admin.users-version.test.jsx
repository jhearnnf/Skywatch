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

const SEEN_AT = new Date('2026-07-19T14:30:00Z').toISOString()

const CURRENT_ANDROID = {
  ...BASE, _id: 'u1', email: 'current@test.com',
  lastSeen: SEEN_AT,
  lastClients: { android: { version: '1.3.0', build: '8', buildNumber: 8, lastSeenAt: SEEN_AT } },
}
const STALE_ANDROID = {
  ...BASE, _id: 'u2', email: 'stale@test.com',
  lastSeen: SEEN_AT,
  lastClients: { android: { version: '1.2.3', build: '7', buildNumber: 7, lastSeenAt: SEEN_AT } },
}
const NEVER_REPORTED = { ...BASE, _id: 'u3', email: 'nodata@test.com', lastSeen: SEEN_AT }

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

// Each collapsed row wraps the eyebrow, name and email in one container.
const rowFor = (email) => screen.getByText(email).closest('div')

const expand = async (email) => {
  fireEvent.click(screen.getByText(email))
  await waitFor(() => screen.getByText(/last online/i))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: client version', () => {
  beforeEach(() => {
    adminClientRef.value = { platform: 'web', version: '1.3.0', build: 'bb11cc2' }
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('marks an account on the newest Android build as latest', async () => {
    await showUsers([CURRENT_ANDROID])
    expect(within(rowFor('current@test.com')).getByText(/latest version/i)).toBeInTheDocument()
  })

  it('marks an account on an older Android build as outdated', async () => {
    await showUsers([STALE_ANDROID])
    expect(within(rowFor('stale@test.com')).getByText(/outdated version/i)).toBeInTheDocument()
  })

  it('shows no verdict for an account that has never reported a build', async () => {
    // Legacy accounts must not fill the list with "unknown" noise.
    await showUsers([NEVER_REPORTED])
    const row = within(rowFor('nodata@test.com'))
    expect(row.queryByText(/latest version/i)).toBeNull()
    expect(row.queryByText(/outdated version/i)).toBeNull()
  })

  it('judges a web build against the bundle this admin page is running', async () => {
    // Same version name, different commit — the sha is what identifies a bundle,
    // and a stale service worker is exactly the case this has to catch.
    const stalePwa = {
      ...BASE, _id: 'u4', email: 'pwa@test.com', lastSeen: SEEN_AT,
      lastClients: { web: { version: '1.3.0', build: 'aaa0000', buildNumber: null, lastSeenAt: SEEN_AT } },
    }
    await showUsers([stalePwa])
    expect(within(rowFor('pwa@test.com')).getByText(/outdated version/i)).toBeInTheDocument()
  })

  it('gives no web verdict when the admin is browsing from the native app', async () => {
    // Nothing on screen is then known to be the current web deploy, so a verdict
    // would be a guess.
    adminClientRef.value = { platform: 'android', version: '1.3.0', build: '8' }
    const webUser = {
      ...BASE, _id: 'u5', email: 'web@test.com', lastSeen: SEEN_AT,
      lastClients: { web: { version: '1.3.0', build: 'aaa0000', buildNumber: null, lastSeenAt: SEEN_AT } },
    }
    await showUsers([webUser])
    const row = within(rowFor('web@test.com'))
    expect(row.queryByText(/outdated version/i)).toBeNull()
    expect(row.queryByText(/latest version/i)).toBeNull()
  })

  it('shows last online and both platform builds when expanded', async () => {
    const dual = {
      ...BASE, _id: 'u6', email: 'dual@test.com', lastSeen: SEEN_AT,
      lastClients: {
        android: { version: '1.2.3', build: '7',       buildNumber: 7,    lastSeenAt: SEEN_AT },
        web:     { version: '1.3.0', build: 'bb11cc2', buildNumber: null, lastSeenAt: SEEN_AT },
      },
    }
    await showUsers([dual])
    await expand('dual@test.com')

    expect(screen.getByText(/last online/i)).toBeInTheDocument()
    // Retained per platform: playing in the browser must not erase the phone.
    expect(screen.getByText('1.2.3 (7)')).toBeInTheDocument()
    expect(screen.getByText('1.3.0 (bb11cc2)')).toBeInTheDocument()
    expect(screen.getByText('Android')).toBeInTheDocument()
    expect(screen.getByText('Web')).toBeInTheDocument()
  })

  it('says so explicitly in the drilldown when nothing has been reported', async () => {
    await showUsers([NEVER_REPORTED])
    await expand('nodata@test.com')
    expect(screen.getByText(/not reported yet/i)).toBeInTheDocument()
  })
})
