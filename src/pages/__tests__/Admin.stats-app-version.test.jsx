import { render, screen, waitFor } from '@testing-library/react'
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

// The card reports the build the admin is *viewing from*, so the platform is
// whatever appVersion resolves — web bundle on the site, store release on native.
const adminClientRef = vi.hoisted(() => ({ value: null, async: null }))
vi.mock('../../utils/appVersion', () => ({
  peekClientInfo: () => adminClientRef.value,
  getClientInfo:  () => Promise.resolve(adminClientRef.async ?? adminClientRef.value),
}))

function setupFetch() {
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {}, server: { serverUptimeSeconds: 60, totalLoadingMs: 0 } } }) })
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Stats: current app version card', () => {
  beforeEach(() => {
    adminClientRef.value = { platform: 'web', version: '1.2.4', build: 'bb11cc2' }
    adminClientRef.async  = null
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
    setupFetch()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows the site version when viewed from the web', async () => {
    render(<Admin />)
    expect(await screen.findByText('Site Version')).toBeInTheDocument()
    expect(screen.getByText('1.2.4')).toBeInTheDocument()
    expect(screen.getByText('Web · build bb11cc2')).toBeInTheDocument()
  })

  it('shows the Android app version when viewed from the native app', async () => {
    adminClientRef.value = { platform: 'android', version: '1.2.4', build: '8' }
    render(<Admin />)
    expect(await screen.findByText('App Version')).toBeInTheDocument()
    expect(screen.getByText('Android · build 8')).toBeInTheDocument()
  })

  it('resolves the native version asynchronously when the bridge is slow', async () => {
    // peekClientInfo returns null on native until the Capacitor bridge answers.
    adminClientRef.value = null
    adminClientRef.async  = { platform: 'android', version: '1.2.4', build: '8' }
    render(<Admin />)
    await waitFor(() => expect(screen.getByText('App Version')).toBeInTheDocument())
    expect(screen.getByText('Android · build 8')).toBeInTheDocument()
  })
})
