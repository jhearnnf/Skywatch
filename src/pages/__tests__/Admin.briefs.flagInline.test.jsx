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

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
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

// ── Fixtures ───────────────────────────────────────────────────────────────

const UNFLAGGED_BRIEF = {
  _id: 'b-unflagged', title: 'Typhoon', subtitle: 'Jet', category: 'Aircrafts',
  status: 'published', flaggedForEdit: false, flaggedAt: null,
}
const FLAGGED_BRIEF = {
  _id: 'b-flagged', title: 'Tornado', subtitle: 'Attack', category: 'Aircrafts',
  status: 'published', flaggedForEdit: true, flaggedAt: new Date().toISOString(),
}

function baseHandlers(briefs = [UNFLAGGED_BRIEF, FLAGGED_BRIEF]) {
  return (url) => {
    if (url.includes('/api/admin/stats'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {
        users:     { totalUsers: 0, freeUsers: 0, trialUsers: 0, subscribedUsers: 0, easyPlayers: 0, mediumPlayers: 0, totalLogins: 0, combinedStreaks: 0 },
        games:     { totalGamesPlayed: 0, totalGamesCompleted: 0, totalGamesAbandoned: 0, quizTotalSeconds: 0, boo: { totalSeconds: 0 } },
        briefs:    { totalBrifsRead: 0, totalBrifsOpened: 0, totalReadSeconds: 0 },
        tutorials: { viewed: 0, skipped: 0 },
      }}) })
    if (url.includes('/api/admin/problems/count'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    if (url.includes('/api/admin/briefs'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { briefs, total: briefs.length } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }
}

async function navigateToBriefsTab() {
  const tab = await screen.findByRole('button', { name: /briefs/i })
  fireEvent.click(tab)
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Admin Briefs — inline flag-for-edit checkbox', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders a flag toggle for each brief, reflecting its flagged state', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers())
    render(<Admin />)
    await navigateToBriefsTab()
    const unflaggedCb = await screen.findByLabelText(/flag typhoon for editing/i)
    const flaggedCb   = await screen.findByLabelText(/flag tornado for editing/i)
    expect(unflaggedCb.getAttribute('aria-checked')).toBe('false')
    expect(flaggedCb.getAttribute('aria-checked')).toBe('true')
  })

  it('auto-saves with a hardcoded reason (no prompt) and flips the flag', async () => {
    const patchCalls = []
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.endsWith('/api/admin/briefs/b-unflagged') && opts?.method === 'PATCH') {
        patchCalls.push(JSON.parse(opts.body))
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { brief: { ...UNFLAGGED_BRIEF, flaggedForEdit: true } } }) })
      }
      return baseHandlers()(url, opts)
    })

    render(<Admin />)
    await navigateToBriefsTab()
    const cb = await screen.findByLabelText(/flag typhoon for editing/i)
    expect(cb.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(cb)

    await waitFor(() => expect(patchCalls.length).toBe(1))
    expect(patchCalls[0].flaggedForEdit).toBe(true)
    expect(typeof patchCalls[0].reason).toBe('string')
    expect(patchCalls[0].reason.length).toBeGreaterThan(0)
    // Optimistic update: flag flips to checked immediately
    await waitFor(() => expect(cb.getAttribute('aria-checked')).toBe('true'))
    // No confirmation modal / reason prompt is shown
    expect(screen.queryByPlaceholderText(/briefly describe why/i)).toBeNull()
  })

  it('clicking the flag does not open the brief editor', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.endsWith('/api/admin/briefs/b-unflagged') && opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { brief: { ...UNFLAGGED_BRIEF, flaggedForEdit: true } } }) })
      }
      return baseHandlers()(url, opts)
    })

    render(<Admin />)
    await navigateToBriefsTab()
    const cb = await screen.findByLabelText(/flag typhoon for editing/i)
    fireEvent.click(cb)

    // Editor-only controls should NOT appear
    await waitFor(() => expect(cb.getAttribute('aria-checked')).toBe('true'))
    expect(screen.queryByRole('button', { name: /regenerate all/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /save brief/i })).toBeNull()
  })

  it('reverts optimistic update when the PATCH fails', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.endsWith('/api/admin/briefs/b-unflagged') && opts?.method === 'PATCH') {
        return Promise.resolve({ ok: false, json: async () => ({ status: 'error', message: 'Nope' }) })
      }
      return baseHandlers()(url, opts)
    })

    render(<Admin />)
    await navigateToBriefsTab()
    const cb = await screen.findByLabelText(/flag typhoon for editing/i)
    fireEvent.click(cb)

    await waitFor(() => expect(cb.getAttribute('aria-checked')).toBe('false'))
  })
})
