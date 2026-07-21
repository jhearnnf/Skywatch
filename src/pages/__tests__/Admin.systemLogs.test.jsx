import { render, screen, fireEvent } from '@testing-library/react'
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
  useUnsolvedReports: () => ({ unsolvedCount: 0, unresolvedSystemLogs: 1, refresh: vi.fn() }),
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

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

function makeCorsLog(overrides = {}) {
  return {
    _id:         overrides._id         ?? 'log1',
    type:        'cors_origin_rejected',
    origin:      overrides.origin      ?? 'https://api.skywatch.academy',
    requestPath: overrides.requestPath ?? '/open/',
    referer:     overrides.referer     ?? '',
    userAgent:   overrides.userAgent   ?? IPHONE_UA,
    hitCount:    overrides.hitCount     ?? 4,
    firstSeenAt: overrides.firstSeenAt ?? '2026-07-21T15:55:31.261Z',
    lastSeenAt:  overrides.lastSeenAt  ?? '2026-07-21T15:55:31.378Z',
    failureReason: overrides.failureReason ?? `Origin ${overrides.origin ?? 'https://api.skywatch.academy'} is not on the CORS allowlist`,
    resolved:    false,
    time:        '2026-07-21T15:55:31.261Z',
  }
}

function systemLogsResponse(logs = []) {
  return { status: 'success', data: { logs, total: logs.length, page: 1, totalPages: logs.length > 0 ? 1 : 0 } }
}

function baseHandlers(logs) {
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
    if (url.includes('/api/admin/system-logs'))
      return Promise.resolve({ ok: true, json: async () => systemLogsResponse(logs) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }
}

async function navigateToSystemLogs() {
  render(<Admin />)
  const intelTab = await screen.findByRole('button', { name: /intel/i })
  fireEvent.click(intelTab)
  const sysLogsBtn = await screen.findByRole('button', { name: /^system logs$/i })
  fireEvent.click(sysLogsBtn)
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Admin System Logs — cors_origin_rejected context', () => {
  beforeEach(() => { global.Audio = class { play = vi.fn().mockResolvedValue(undefined) } })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders a friendly label instead of the raw type', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers([makeCorsLog()]))
    await navigateToSystemLogs()
    expect(await screen.findByText(/blocked unknown origin/i)).toBeDefined()
    expect(screen.queryByText('cors_origin_rejected')).toBeNull()
  })

  it('shows where it came from: origin, path and device', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers([makeCorsLog()]))
    await navigateToSystemLogs()
    expect(await screen.findByText('https://api.skywatch.academy')).toBeDefined()
    expect(screen.getByText('/open/')).toBeDefined()
    expect(screen.getByText(/iPhone · Safari/)).toBeDefined()
  })

  it('reads an api.* origin as harmless', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers([makeCorsLog({ origin: 'https://api.skywatch.academy' })]))
    await navigateToSystemLogs()
    expect(await screen.findByText(/no real visitor was affected/i)).toBeDefined()
  })

  it('flags a genuine skywatch origin for investigation', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers([
      makeCorsLog({ _id: 'log2', origin: 'https://beta.skywatch.academy' }),
    ]))
    await navigateToSystemLogs()
    expect(await screen.findByText(/can silently break the site/i)).toBeDefined()
  })

  it('shows the referer when the browser sent one', async () => {
    global.fetch = vi.fn().mockImplementation(baseHandlers([
      makeCorsLog({ referer: 'https://some-site.example.com/page' }),
    ]))
    await navigateToSystemLogs()
    expect(await screen.findByText('https://some-site.example.com/page')).toBeDefined()
  })
})
