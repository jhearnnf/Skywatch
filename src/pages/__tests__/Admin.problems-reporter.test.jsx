import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// Admin ▸ Intel ▸ Reports — who filed each report. The row used to print the
// agent number alone, so an account without one read "Unknown agent" even
// though the API sends a display name and an email alongside it.

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

function makeProblem(userId, overrides = {}) {
  return {
    _id:          overrides._id ?? 'p1',
    userId,
    time:         '2026-08-03T14:02:00Z',
    pageReported: '/brief/abc',
    description:  overrides.description ?? 'The map never loads',
    solved:       false,
    kind:         'bug',
    updates:      overrides.updates ?? [],
  }
}

function baseHandlers(problems) {
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
    if (url.includes('/api/admin/problems'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { problems } }) })
    if (url.includes('/api/admin/settings'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }
}

// Reports is Intel's default sub-tab; expanding a row reveals the byline.
async function openReport(problems) {
  global.fetch = vi.fn().mockImplementation(baseHandlers(problems))
  render(<Admin />)
  fireEvent.click(await screen.findByRole('button', { name: /intel/i }))
  fireEvent.click(await screen.findByText(problems[0].description))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Admin ▸ Intel ▸ Reports — reporter byline', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('leads with the display name and keeps the agent number', async () => {
    await openReport([makeProblem({ _id: 'u1', displayName: 'Falcon', email: 'falcon@test.com', agentNumber: '1234567' })])
    expect(await screen.findByText(/Falcon · Agent 1234567/)).toBeDefined()
  })

  it('falls back to the email when the account has no display name', async () => {
    await openReport([makeProblem({ _id: 'u1', displayName: null, email: 'nobody@test.com', agentNumber: '1234567' })])
    expect(await screen.findByText(/nobody@test\.com · Agent 1234567/)).toBeDefined()
  })

  it('names the reporter even without an agent number', async () => {
    await openReport([makeProblem({ _id: 'u1', displayName: 'Falcon', email: 'falcon@test.com' })])
    const line = await screen.findByText(/Falcon/)
    expect(line.textContent).not.toMatch(/unknown agent/i)
  })

  it('says Unknown agent only when the account is gone entirely', async () => {
    await openReport([makeProblem(null)])
    expect(await screen.findByText(/Unknown agent/)).toBeDefined()
  })

  it('names the admin who left an update', async () => {
    await openReport([makeProblem(
      { _id: 'u1', displayName: 'Falcon', agentNumber: '1234567' },
      { updates: [{
        description: 'Fixed in build 42',
        time: '2026-08-04T09:00:00Z',
        adminUserId: { _id: 'admin1', displayName: 'Hawkeye', email: 'admin@test.com', agentNumber: '7654321' },
        isUserVisible: false,
      }] },
    )])
    expect(await screen.findByText(/Hawkeye · Agent 7654321/)).toBeDefined()
  })
})

// ── Replying to a report ───────────────────────────────────────────────────
// Email and in-app used to be mutually exclusive radios; they are now
// independent checkboxes, so a reply can go out on both at once.

const reporter = { _id: 'u1', displayName: 'Falcon', email: 'falcon@test.com', agentNumber: '1234567' }

async function startReply(note = 'We have fixed it') {
  await openReport([makeProblem(reporter)])
  fireEvent.change(await screen.findByPlaceholderText(/add admin note/i), { target: { value: note } })
  fireEvent.click(screen.getByLabelText(/send update to user/i))
}

const channel = (name) => screen.getByLabelText(name)

function sentBody() {
  const call = global.fetch.mock.calls.find(
    ([url, opts]) => url.includes('/api/admin/problems/') && opts?.method === 'POST',
  )
  return call ? JSON.parse(call[1].body) : null
}

describe('Admin ▸ Intel ▸ Reports — reply delivery channels', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('defaults to in-app only', async () => {
    await startReply()
    expect(channel(/in-app notification/i).checked).toBe(true)
    expect(channel(/^email$/i).checked).toBe(false)
  })

  it('lets both channels be ticked at once', async () => {
    await startReply()
    fireEvent.click(channel(/^email$/i))

    expect(channel(/in-app notification/i).checked).toBe(true)
    expect(channel(/^email$/i).checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /save note/i }))
    await screen.findByText(/by email and as an in-app notification/i)

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(sentBody()).not.toBeNull())
    expect(sentBody()).toMatchObject({ notifyUser: true, sendEmail: true, sendNotification: true })
  })

  it('sends email alone when in-app is unticked', async () => {
    await startReply()
    fireEvent.click(channel(/^email$/i))
    fireEvent.click(channel(/in-app notification/i))

    fireEvent.click(screen.getByRole('button', { name: /save note/i }))
    await screen.findByText(/by email/i)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(sentBody()).not.toBeNull())
    expect(sentBody()).toMatchObject({ sendEmail: true, sendNotification: false })
  })

  it('blocks the reply while both channels are unticked', async () => {
    await startReply()
    fireEvent.click(channel(/in-app notification/i))   // leaves nothing ticked

    expect(await screen.findByText(/pick at least one way to reach them/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /save note/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /mark solved/i }).disabled).toBe(true)
  })

  it('marks an update that went out both ways', async () => {
    await openReport([makeProblem(reporter, { updates: [{
      description: 'Fixed in build 42',
      time: '2026-08-04T09:00:00Z',
      adminUserId: { _id: 'admin1', displayName: 'Hawkeye', agentNumber: '7654321' },
      isUserVisible: true,
      emailSent: true,
      notificationSent: true,
    }] })])
    expect(await screen.findByText('emailed + notified')).toBeDefined()
  })

  it('reads a pre-split update with no notificationSent as notified', async () => {
    await openReport([makeProblem(reporter, { updates: [{
      description: 'Legacy reply',
      time: '2026-08-04T09:00:00Z',
      adminUserId: { _id: 'admin1', agentNumber: '7654321' },
      isUserVisible: true,
      emailSent: false,
    }] })])
    expect(await screen.findByText('notified')).toBeDefined()
  })
})
