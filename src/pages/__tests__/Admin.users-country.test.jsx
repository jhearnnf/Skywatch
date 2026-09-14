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
  geo: null, firstSeenCountry: null,
  profileStats: { brifsRead: 0 },
}

const GEO_GB = {
  country: 'GB', source: 'ip', mismatch: false, ipCountry: 'GB',
  timeZone: 'Europe/London', language: 'en-GB', updatedAt: new Date('2026-09-14').toISOString(),
}

function setupFetch(users) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/admin/stats'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: {}, games: { boo: {} }, briefs: {}, tutorials: {} } }) })
    if (url.includes('/api/admin/problems/count')) return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))       return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/users'))          return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function showList(users) {
  global.fetch = setupFetch(users)
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: /users/i }))
  await waitFor(() => screen.getByText('plain@test.com'))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: country', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
    localStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows a flag in the collapsed row and the detail once expanded', async () => {
    await showList([{ ...AGENT, geo: GEO_GB, firstSeenCountry: 'GB' }])

    const flag = screen.getByLabelText(/^Country: United Kingdom/)
    expect(flag.textContent).toBe('🇬🇧')
    expect(flag.getAttribute('title')).toBe('United Kingdom · Europe/London · en-GB')
    expect(screen.queryByText('Country')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(screen.getByText('Country')).toBeTruthy()
    expect(screen.getByText('United Kingdom')).toBeTruthy()
    expect(screen.getByText('Europe/London · en-GB')).toBeTruthy()
    expect(screen.queryByText(/IP says/)).toBeNull()
  })

  it('shows nothing for an account that has not reported a country', async () => {
    await showList([AGENT])
    expect(screen.queryByLabelText(/^Country:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(screen.queryByText('Country')).toBeNull()
  })

  it('surfaces a mismatch between the IP and the timezone', async () => {
    await showList([{ ...AGENT, geo: { ...GEO_GB, mismatch: true, ipCountry: 'NL' }, firstSeenCountry: 'GB' }])

    expect(screen.getByLabelText(/^Country:/).getAttribute('title')).toBe('United Kingdom · Europe/London · en-GB · IP says Netherlands')

    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(screen.getByText('IP says NL')).toBeTruthy()
  })

  it('notes where the account was first seen when it has since moved', async () => {
    await showList([{ ...AGENT, geo: { ...GEO_GB, country: 'AU', ipCountry: 'AU', timeZone: 'Australia/Sydney', language: 'en-AU' }, firstSeenCountry: 'GB' }])
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(screen.getByText('Australia')).toBeTruthy()
    expect(screen.getByText('Australia/Sydney · en-AU · first seen United Kingdom')).toBeTruthy()
  })
})
