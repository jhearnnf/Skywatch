import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// The Questionnaires stat card is the shortcut into the questionnaire results,
// and coming back from there should land on the panel that owns them rather
// than on the Stats tab the admin started from.

const mockNavigate = vi.hoisted(() => vi.fn())
// Stable identity: sections inside the Content tab put searchParams in effect
// deps, and a fresh object per render would loop.
const mockSearchParams = vi.hoisted(() => [new URLSearchParams(), () => {}])
let mockLocationState = null

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState, pathname: '/admin' }),
  useSearchParams: () => mockSearchParams,
  useParams: () => ({}),
  Link: ({ children, ...r }) => <a {...r}>{children}</a>,
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
    awardAirstars: vi.fn(),
    setUser: vi.fn(),
    refreshUser: vi.fn(),
  }),
}))

vi.mock('../../context/UnsolvedReportsContext', () => ({
  useUnsolvedReports: () => ({ unsolvedCount: 0, unresolvedSystemLogs: 0, refresh: vi.fn() }),
}))

vi.mock('../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: () => ({ pending: null, clear: vi.fn() }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
  TUTORIAL_KEYS: {},
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: () => true }),
}))

vi.mock('../../components/RankBadge', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

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

function handlers() {
  return (url) => {
    if (url.includes('/api/admin/stats'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: {
        users:     { totalUsers: 0, freeUsers: 0, trialUsers: 0, subscribedUsers: 0, easyPlayers: 0, mediumPlayers: 0, totalLogins: 0, combinedStreaks: 0, questionnaire: { sent: 20, started: 8, completed: 5 } },
        games:     { totalGamesPlayed: 0, totalGamesCompleted: 0, totalGamesAbandoned: 0, quizTotalSeconds: 0, boo: { totalSeconds: 0 } },
        briefs:    { totalBrifsRead: 0, totalBrifsOpened: 0, totalReadSeconds: 0 },
        tutorials: { viewed: 0, skipped: 0 },
      }}) })
    if (url.includes('/api/admin/cbat-passers'))
      return Promise.resolve({ ok: true, json: async () => ({ data: {
        thresholds: { minCompletions: 10, dormantDays: 21, warmBandDays: 14 },
        batchSize: 50,
        groups: [],
        totals: { candidates: 0, ready: 0, warm: 0, emailed: 0, responded: 0, deferred: 0, remaining: 0 },
        nextBatchIds: [],
      }}) })
    if (url.includes('/api/admin/problems/count'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    if (url.includes('/api/admin/settings'))
      return Promise.resolve({ ok: true, json: async () => ({ data: { settings: {} } }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }
}

beforeEach(() => {
  global.Audio = class { play = vi.fn().mockResolvedValue(undefined) }
  global.fetch = vi.fn().mockImplementation(handlers())
  mockNavigate.mockClear()
  mockLocationState = null
})
afterEach(() => { vi.restoreAllMocks() })

describe('Admin Stats — the Questionnaires card', () => {
  it('opens the questionnaire results page when clicked', async () => {
    render(<Admin />)

    const card = await screen.findByTestId('stats-questionnaires-card')
    fireEvent.click(card)

    expect(mockNavigate).toHaveBeenCalledWith('/admin/cbat-questionnaire', { state: { fromStats: true } })
  })
})

describe('Admin Content — arriving back from the results page', () => {
  it('starts on Content with the passers panel expanded', async () => {
    mockLocationState = { openPassers: true }
    render(<Admin />)

    // The panel's own controls only exist once it is expanded.
    expect(await screen.findByText('Min games finished')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-questionnaires-card')).toBeNull()
  })

  it('leaves the panel collapsed on a plain visit', async () => {
    render(<Admin />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    expect(screen.queryByText('Min games finished')).toBeNull()
  })
})
