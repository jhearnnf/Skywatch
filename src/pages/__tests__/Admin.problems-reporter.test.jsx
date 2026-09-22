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
    ...(overrides.title              ? { title: overrides.title }                           : {}),
    ...(overrides.conversationId     ? { conversationId: overrides.conversationId }         : {}),
    ...(overrides.clientPlatform     ? { clientPlatform: overrides.clientPlatform }         : {}),
    ...(overrides.environment        ? { environment: overrides.environment }               : {}),
    ...(overrides.environmentSummary ? { environmentSummary: overrides.environmentSummary } : {}),
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
  // The card header carries the generated title when there is one.
  fireEvent.click(await screen.findByText(problems[0].title || problems[0].description))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Admin ▸ Intel ▸ Reports — reporter byline', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('leads with the display name and keeps the agent number', async () => {
    await openReport([makeProblem({ _id: 'u1', displayName: 'Falcon', email: 'falcon@test.com', agentNumber: '1234567' })])
    expect(await screen.findByText(/Falcon .* Agent 1234567/)).toBeDefined()
  })

  // A report whose body quotes an email address reads as being about someone
  // else entirely when the byline shows only a display name.
  it('shows the email alongside the display name', async () => {
    await openReport([makeProblem({ _id: 'u1', displayName: 'Falcon', email: 'falcon@test.com', agentNumber: '1234567' })])
    expect(await screen.findByText(/Falcon · falcon@test\.com · Agent 1234567/)).toBeDefined()
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
    expect(await screen.findByText(/Hawkeye · admin@test\.com · Agent 7654321/)).toBeDefined()
  })
})

const reporter = { _id: 'u1', displayName: 'Falcon', email: 'falcon@test.com', agentNumber: '1234567' }

// ── The card header ───────────────────────────────────────────────────────

describe('Admin ▸ Intel ▸ Reports — card title', () => {
  it('leads with the generated title when there is one, keeping the full report below', async () => {
    await openReport([makeProblem(reporter, { title: 'Map never loads on the brief page' })])
    expect(await screen.findByText('Map never loads on the brief page')).toBeDefined()
    expect(screen.getByText('The map never loads')).toBeDefined()
  })

  it('falls back to the report text on a report with no title yet', async () => {
    await openReport([makeProblem(reporter)])
    expect(await screen.findByText('Original report')).toBeDefined()
    expect(screen.getAllByText('The map never loads').length).toBeGreaterThan(0)
  })
})

// ── The device it was filed from ──────────────────────────────────────────
// A report that reads "the needles are off the screen" cannot be triaged
// without knowing the OS, browser, screen and GPU. The server describes them
// as rows; the card shows every row it gets and the raw user agent under them.

describe('Admin ▸ Intel ▸ Reports — device environment', () => {
  it('shows the described rows and the raw user agent', async () => {
    await openReport([makeProblem(reporter, {
      environment: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0' },
      environmentSummary: [
        { label: 'OS',       value: 'Windows 11' },
        { label: 'Browser',  value: 'Chrome 128' },
        { label: 'Display',  value: 'screen 1920×1080, viewport 1440×760, no touch' },
        { label: 'Graphics', value: 'NVIDIA GeForce RTX 3060 (D3D11)' },
      ],
    })])
    expect(await screen.findByText('Windows 11')).toBeDefined()
    expect(screen.getByText('Chrome 128')).toBeDefined()
    expect(screen.getByText('NVIDIA GeForce RTX 3060 (D3D11)')).toBeDefined()
    expect(screen.getByText(/Mozilla\/5\.0 \(Windows NT 10\.0/)).toBeDefined()
  })

  it('shows nothing about the device on a report filed before it was captured', async () => {
    await openReport([makeProblem(reporter, { environmentSummary: [] })])
    await screen.findAllByText('The map never loads')
    expect(screen.queryByText('User agent')).toBeNull()
    expect(screen.queryByText('OS')).toBeNull()
  })
})

// ── The ticket the report opened ──────────────────────────────────────────

describe('Admin ▸ Intel ▸ Reports — the ticket thread', () => {
  it('offers the thread, which carries the answers the reporter sent', async () => {
    await openReport([makeProblem(reporter, { conversationId: 't1' })])
    expect(await screen.findByTestId('open-ticket')).toBeDefined()
  })

  it('offers nothing to open on a report filed before tickets', async () => {
    await openReport([makeProblem(reporter)])
    await screen.findByText('Original report')
    expect(screen.queryByTestId('open-ticket')).toBeNull()
  })
})

// ── Replying to a report ───────────────────────────────────────────────────
// A reply always lands in the reporter's ticket, where they can answer; email
// is the optional second channel.

async function startReply(note = 'We have fixed it') {
  await openReport([makeProblem(reporter)])
  fireEvent.change(await screen.findByPlaceholderText(/add admin note/i), { target: { value: note } })
  fireEvent.click(screen.getByLabelText(/reply to the reporter/i))
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

  // A visible reply always lands in the reporter's Support tickets on the
  // Community page; email is the optional extra. There is no longer an in-app
  // toast to tick on or off.
  it('posts a reply into the ticket, without email by default', async () => {
    await startReply()
    expect(channel(/also send by email/i).checked).toBe(false)
    expect(screen.getByText(/posted in their ticket, where they can reply/i)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /save note/i }))
    await screen.findByText(/posted in the reporter's ticket as SkyWatch Support:/i)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(sentBody()).not.toBeNull())
    expect(sentBody()).toMatchObject({ notifyUser: true, sendEmail: false, sendNotification: true })
  })

  it('emails as well when asked', async () => {
    await startReply()
    fireEvent.click(channel(/also send by email/i))

    fireEvent.click(screen.getByRole('button', { name: /save note/i }))
    await screen.findByText(/and emailed to them/i)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(sentBody()).not.toBeNull())
    expect(sentBody()).toMatchObject({ notifyUser: true, sendEmail: true, sendNotification: true })
  })

  // Slim mode has no Community, so a reporter on the app cannot open their
  // ticket: email is the only way the reply reaches them.
  it('ticks email by default for a report filed from the app', async () => {
    await openReport([makeProblem(reporter, { clientPlatform: 'android' })])
    fireEvent.change(await screen.findByPlaceholderText(/add admin note/i), { target: { value: 'Fixed' } })
    fireEvent.click(screen.getByLabelText(/reply to the reporter/i))

    expect(channel(/also send by email/i).checked).toBe(true)
    expect(screen.getByText(/reported from the app/i)).toBeDefined()
  })

  it('never blocks a reply for want of a channel: the ticket is always one', async () => {
    await startReply()
    expect(screen.getByRole('button', { name: /save note/i }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: /mark solved/i }).disabled).toBe(false)
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
