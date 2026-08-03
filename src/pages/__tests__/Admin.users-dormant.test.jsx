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

const BASE = {
  _id: 'u1', agentNumber: '001', email: 'plain@test.com',
  subscriptionTier: 'free', totalAirstars: 0, loginStreak: 0, logins: [],
  difficultySetting: 'easy', createdAt: new Date('2025-01-01').toISOString(),
  isAdmin: false, isBanned: false, isTester: false,
  profileStats: { brifsRead: 0 },
}

// No lastSeen at all → never online, so definitely dormant
const OFFLINE = { ...BASE }
// Stale lastSeen (an hour ago) → past the 10-minute "away" window
const STALE   = { ...BASE, _id: 'u2', agentNumber: '002', email: 'stale@test.com', lastSeen: new Date(Date.now() - 60 * 60_000).toISOString() }
// Inside 90s → live
const LIVE    = { ...BASE, _id: 'u3', agentNumber: '003', email: 'live@test.com',  lastSeen: new Date().toISOString() }
// Between 90s and 10m → away
const AWAY    = { ...BASE, _id: 'u4', agentNumber: '004', email: 'away@test.com',  lastSeen: new Date(Date.now() - 5 * 60_000).toISOString() }

function setupFetch(users) {
  return vi.fn().mockImplementation(url => {
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

// The dimmed wrapper is the row's outermost element — two levels above the card
// that holds the email.
const rowWrapper = email => screen.getByText(email).closest('.relative').parentElement

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Users tab: greying out inactive users', () => {
  beforeEach(() => {
    global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
    localStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('greys out a user who has never been seen', async () => {
    global.fetch = setupFetch([OFFLINE])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('plain@test.com'))

    expect(rowWrapper('plain@test.com').className).toMatch(/opacity-40/)
  })

  it('greys out a user whose last activity is past the away window', async () => {
    global.fetch = setupFetch([STALE])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('stale@test.com'))

    expect(rowWrapper('stale@test.com').className).toMatch(/opacity-40/)
  })

  it('leaves online and away users at full strength', async () => {
    global.fetch = setupFetch([LIVE, AWAY])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('live@test.com'))

    expect(rowWrapper('live@test.com').className).not.toMatch(/opacity-40/)
    expect(rowWrapper('away@test.com').className).not.toMatch(/opacity-40/)
  })

  it('lifts the fade while a dormant row is expanded', async () => {
    global.fetch = setupFetch([OFFLINE])

    render(<Admin />)
    await navigateToUsers()
    await waitFor(() => screen.getByText('plain@test.com'))

    expect(rowWrapper('plain@test.com').className).toMatch(/opacity-40/)
    fireEvent.click(screen.getByRole('button', { name: /expand agent 001/i }))
    expect(rowWrapper('plain@test.com').className).not.toMatch(/opacity-40/)
  })
})
