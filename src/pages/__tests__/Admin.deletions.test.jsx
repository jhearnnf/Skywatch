import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ──────────────────────────────────────────────────────────────────

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
    setUser: vi.fn(),
  }),
}))

vi.mock('../../context/UnsolvedReportsContext', () => ({
  useUnsolvedReports: () => ({ unsolvedCount: 0, unresolvedSystemLogs: 0, refresh: vi.fn() }),
}))

vi.mock('../../components/RankBadge', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
  TUTORIAL_KEYS: {},
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: () => true }),
}))

vi.mock('../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(), previewTypingSound: vi.fn(), previewGridRevealTone: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeDeletion(overrides = {}) {
  return {
    _id:            overrides._id            ?? 'del1',
    deletedAt:      overrides.deletedAt      ?? new Date('2026-08-03T14:02:00Z').toISOString(),
    initiatedBy:    overrides.initiatedBy    ?? 'self',
    adminUserId:    overrides.adminUserId    ?? null,
    reason:         overrides.reason         ?? '',
    accountAgeDays: overrides.accountAgeDays ?? 214,
    recordsErased:  overrides.recordsErased  ?? 412,
    breakdown:      overrides.breakdown      ?? { AirstarLog: 300, User: 1 },
  }
}

function makeListResponse(deletions = [], extra = {}) {
  return {
    status: 'success',
    data: {
      deletions,
      total:      extra.total      ?? deletions.length,
      page:       extra.page       ?? 1,
      totalPages: extra.totalPages ?? (deletions.length > 0 ? 1 : 0),
      selfTotal:  extra.selfTotal  ?? 0,
      adminTotal: extra.adminTotal ?? 0,
    },
  }
}

// ── Base fetch handler ─────────────────────────────────────────────────────

function baseHandlers({ list, lookup } = {}) {
  return (url) => {
    if (url.includes('/api/admin/stats'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {
        users: { totalUsers:0, freeUsers:0, trialUsers:0, subscribedUsers:0, easyPlayers:0, mediumPlayers:0, totalLogins:0, combinedStreaks:0 },
        games: { totalGamesPlayed:0, totalGamesCompleted:0, totalGamesAbandoned:0, quizTotalSeconds:0, boo:{ totalSeconds:0 } },
        briefs: { totalBrifsRead:0, totalBrifsOpened:0, totalReadSeconds:0 },
        tutorials: { viewed:0, skipped:0 },
      }}) })
    if (url.includes('/api/admin/problems/count'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/account-deletions/lookup'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: lookup ?? { matches: [], stillActive: false } }) })
    if (url.includes('/api/admin/account-deletions'))
      return Promise.resolve({ ok: true, json: async () => list ?? makeListResponse() })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }
}

async function navigateToDeletionsTab() {
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: /intel/i }))
  fireEvent.click(await screen.findByRole('button', { name: /^deletions$/i }))
}

async function lookUp(email) {
  fireEvent.change(screen.getByLabelText(/check an email address/i), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: /look up/i }))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Admin Deletions — the register', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('lives under Intel', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: /intel/i }))
    expect(await screen.findByRole('button', { name: /^deletions$/i })).toBeDefined()
  })

  it('shows an empty state before anyone has deleted an account', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    await navigateToDeletionsTab()
    await screen.findByText(/no account deletions recorded/i)
  })

  it('renders a self-service row with its erasure count, and names nobody', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers({
      list: makeListResponse([makeDeletion({ recordsErased: 412, accountAgeDays: 214 })], { selfTotal: 1 }),
    }))
    await navigateToDeletionsTab()

    await screen.findByText('Self-service')
    expect(screen.getByText(/412 records erased/i)).toBeDefined()
    expect(screen.getByText(/account age 214d/i)).toBeDefined()
    // No byline on a self-service row — there is no person to name, and the
    // register holds nothing that could name them. (The server-side guarantee
    // that the row itself carries no identifiers is asserted in
    // backend/__tests__/integration/accountDeletionRegister.test.js.)
    expect(screen.queryByText(/^by agent/i)).toBeNull()
  })

  it('names the acting admin and the reason on an admin-initiated row', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers({
      list: makeListResponse([makeDeletion({
        initiatedBy: 'admin',
        adminUserId: { _id: 'admin1', agentNumber: 1001, email: 'admin@test.com' },
        reason: 'spam account',
      })], { adminTotal: 1 }),
    }))
    await navigateToDeletionsTab()

    await screen.findByText('Admin')
    expect(screen.getByText('spam account')).toBeDefined()
    expect(screen.getByText(/by agent 1001/i)).toBeDefined()
  })

  it('filters the list by who started the deletion', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers({
      list: makeListResponse([makeDeletion()], { selfTotal: 3, adminTotal: 2 }),
    }))
    await navigateToDeletionsTab()
    await screen.findByText('Self-service')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'admin' } })

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => c[0])
      expect(calls.some(u => u.includes('initiatedBy=admin'))).toBe(true)
    })
  })
})

describe('Admin Deletions — email lookup', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('confirms an erasure when the address matches a record', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers({
      lookup: { matches: [makeDeletion({ recordsErased: 88 })], stillActive: false },
    }))
    await navigateToDeletionsTab()
    await screen.findByLabelText(/check an email address/i)

    await lookUp('them@example.com')

    await screen.findByText(/erased — this address has a record/i)
    expect(screen.getByText(/88 records erased/i)).toBeDefined()
  })

  it('distinguishes a live account from no record at all', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers({
      lookup: { matches: [], stillActive: true },
    }))
    await navigateToDeletionsTab()
    await screen.findByLabelText(/check an email address/i)

    await lookUp('still.here@example.com')

    await screen.findByText(/account still active/i)
    expect(screen.queryByText(/^no record$/i)).toBeNull()
  })

  it('reports no record for an address we have never seen', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers({
      lookup: { matches: [], stillActive: false },
    }))
    await navigateToDeletionsTab()
    await screen.findByLabelText(/check an email address/i)

    await lookUp('stranger@example.com')

    await screen.findByText(/no record/i)
  })

  it('does not fire a lookup for an empty box', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    await navigateToDeletionsTab()
    await screen.findByLabelText(/check an email address/i)

    expect(screen.getByRole('button', { name: /look up/i }).disabled).toBe(true)
  })
})
