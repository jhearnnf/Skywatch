import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ──────────────────────────────────────────────────────────────────

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

const ADMIN_USER  = { _id: 'admin1', agentNumber: 1001, email: 'admin@test.com' }
const TARGET_USER = { _id: 'user1',  agentNumber: 1002, email: 'user@test.com'  }

function makeAction(overrides = {}) {
  return {
    _id:          overrides._id        ?? 'action1',
    actionType:   overrides.actionType ?? 'edit_brief',
    reason:       overrides.reason     ?? 'Test reason',
    time:         overrides.time       ?? new Date('2026-01-15T10:30:00Z').toISOString(),
    userId:       overrides.userId     ?? ADMIN_USER,
    targetUserId: overrides.targetUserId ?? null,
  }
}

function makeLogsResponse(actions = [], { total, page = 1, totalPages } = {}) {
  return {
    status: 'success',
    data: {
      actions,
      total:      total      ?? actions.length,
      page,
      totalPages: totalPages ?? (actions.length > 0 ? 1 : 0),
    },
  }
}

// ── Base fetch handler ─────────────────────────────────────────────────────

function baseHandlers(logsResponse) {
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
    if (url.includes('/api/admin/actions'))
      return Promise.resolve({ ok: true, json: async () => logsResponse })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function navigateToLogsTab() {
  render(<Admin />)
  const intelTab = await screen.findByRole('button', { name: /intel/i })
  fireEvent.click(intelTab)
  const actionLogsBtn = await screen.findByRole('button', { name: /^action logs$/i })
  fireEvent.click(actionLogsBtn)
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Admin Logs — tab navigation', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders an Intel tab containing an Action Logs sub-tab', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(makeLogsResponse()))
    render(<Admin />)
    const intelTab = await screen.findByRole('button', { name: /intel/i })
    fireEvent.click(intelTab)
    expect(await screen.findByRole('button', { name: /^action logs$/i })).toBeDefined()
  })

  it('shows the logs panel when Logs tab is clicked', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(makeLogsResponse()))
    await navigateToLogsTab()
    await screen.findByText(/admin action logs/i)
  })
})

describe('Admin Logs — empty state', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows "No logs found" when list is empty', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(makeLogsResponse([])))
    await navigateToLogsTab()
    await screen.findByText(/no logs found/i)
  })
})

describe('Admin Logs — log rows', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders the action type badge for each log', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(
      makeLogsResponse([makeAction({ actionType: 'edit_brief', reason: 'Fixed typo' })])
    ))
    await navigateToLogsTab()
    await screen.findByText('Edit Brief')
  })

  it('renders the reason text for each log', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(
      makeLogsResponse([makeAction({ reason: 'Outdated content removed' })])
    ))
    await navigateToLogsTab()
    await screen.findByText('Outdated content removed')
  })

  it('renders the acting admin agent number', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(
      makeLogsResponse([makeAction({ userId: ADMIN_USER })])
    ))
    await navigateToLogsTab()
    await screen.findByText(/agent 1001/i)
  })

  it('renders the target user agent number when present', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(
      makeLogsResponse([makeAction({ actionType: 'ban_user', targetUserId: TARGET_USER })])
    ))
    await navigateToLogsTab()
    await screen.findByText(/agent 1002/i)
  })

  it('does not render a target when targetUserId is null', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(
      makeLogsResponse([makeAction({ targetUserId: null })])
    ))
    await navigateToLogsTab()
    await waitFor(() => screen.findByText('Edit Brief'))
    expect(screen.queryByText(/→ Agent/i)).toBeNull()
  })

  it('renders multiple log rows', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(
      makeLogsResponse([
        makeAction({ _id: 'a1', reason: 'First action'  }),
        makeAction({ _id: 'a2', reason: 'Second action' }),
        makeAction({ _id: 'a3', reason: 'Third action'  }),
      ])
    ))
    await navigateToLogsTab()
    await screen.findByText('First action')
    expect(screen.getByText('Second action')).toBeDefined()
    expect(screen.getByText('Third action')).toBeDefined()
  })
})

describe('Admin Logs — type filter', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders a filter dropdown with "All actions" default', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(makeLogsResponse()))
    await navigateToLogsTab()
    await screen.findByText(/admin action logs/i)
    const select = screen.getByRole('combobox')
    expect(select.value).toBe('')
  })

  it('calls the API with ?type= when filter is changed', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(makeLogsResponse()))
    await navigateToLogsTab()
    await screen.findByText(/admin action logs/i)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'ban_user' } })

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => c[0])
      expect(calls.some(u => u.includes('type=ban_user'))).toBe(true)
    })
  })
})

describe('Admin Logs — pagination', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows pagination controls when totalPages > 1', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(
      makeLogsResponse(
        Array.from({ length: 20 }, (_, i) => makeAction({ _id: `a${i}`, reason: `reason ${i}` })),
        { total: 35, page: 1, totalPages: 2 }
      )
    ))
    await navigateToLogsTab()
    await screen.findByText(/page 1 of 2/i)
    expect(screen.getByRole('button', { name: /next/i })).toBeDefined()
  })

  it('hides pagination controls when only one page', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(
      makeLogsResponse([makeAction()], { total: 1, page: 1, totalPages: 1 })
    ))
    await navigateToLogsTab()
    await screen.findByText('Edit Brief')
    expect(screen.queryByText(/page 1 of/i)).toBeNull()
  })

  it('Prev button is disabled on page 1', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers(
      makeLogsResponse(
        Array.from({ length: 20 }, (_, i) => makeAction({ _id: `a${i}`, reason: `r${i}` })),
        { total: 25, page: 1, totalPages: 2 }
      )
    ))
    await navigateToLogsTab()
    await screen.findByText(/page 1 of 2/i)
    expect(screen.getByRole('button', { name: /prev/i }).disabled).toBe(true)
  })
})
