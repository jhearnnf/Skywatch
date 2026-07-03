import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatLeaderboard from '../CbatLeaderboard'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth   = vi.hoisted(() => vi.fn())
const mockUseParams = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useParams: () => mockUseParams(),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/cbat/x/leaderboard', search: '', hash: '' }),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
  useReducedMotion: () => true,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

// URL-aware: the component requests ?period=weekly first, ?period=all-time on switch.
function mockApi({ weekly = {}, allTime = {} } = {}) {
  return vi.fn((url) => {
    const isWeekly = String(url).includes('period=weekly')
    const data = isWeekly
      ? { period: 'weekly', resetsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
          leaderboard: weekly.leaderboard || [], myBest: weekly.myBest || null }
      : { period: 'all-time', leaderboard: allTime.leaderboard || [], myBest: allTime.myBest || null }
    return Promise.resolve({ ok: true, json: async () => ({ data }) })
  })
}

function setupAuth(apiFetch = mockApi()) {
  mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
}

const selectAllTime = async () => {
  fireEvent.click(screen.getByRole('tab', { name: /all time/i }))
  await waitFor(() => expect(screen.getByRole('tab', { name: /all time/i }).getAttribute('aria-selected')).toBe('true'))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatLeaderboard — unknown game', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows "Unknown game" for an unrecognised gameKey', () => {
    setupAuth()
    mockUseParams.mockReturnValue({ gameKey: 'nonsense' })
    render(<CbatLeaderboard />)
    expect(screen.getByText('Unknown game')).toBeDefined()
  })
})

describe('CbatLeaderboard — weekly (default) tab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to the weekly board and shows Points + Plays', async () => {
    setupAuth(mockApi({
      weekly: { leaderboard: [
        { _id: 'w1', userId: 'u2', rank: 1, weekTotal: 540, plays: 3, agentNumber: 'A002' },
        { _id: 'w2', userId: 'u1', rank: 2, weekTotal: 300, plays: 2, agentNumber: 'A001' },
      ] },
    }))
    mockUseParams.mockReturnValue({ gameKey: 'target' })
    render(<CbatLeaderboard />)

    expect(screen.getByRole('tab', { name: /this week/i }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(screen.getByText('Agent A001 (you)')).toBeDefined())
    expect(screen.getByText('540')).toBeDefined()  // weekTotal
    expect(screen.getByText('300')).toBeDefined()
    expect(screen.getByText('🥇')).toBeDefined()
  })

  it('shows an empty weekly state', async () => {
    setupAuth(mockApi({ weekly: { leaderboard: [] } }))
    mockUseParams.mockReturnValue({ gameKey: 'target' })
    render(<CbatLeaderboard />)
    await waitFor(() => expect(screen.getByText('No scores yet this week')).toBeDefined())
  })

  it('renders the weekly myBest row when the user is outside the top list', async () => {
    setupAuth(mockApi({
      weekly: {
        leaderboard: [{ _id: 'w1', userId: 'other', rank: 1, weekTotal: 900, plays: 3, agentNumber: 'A101' }],
        myBest: { _id: 'me', userId: 'u1', rank: 38, weekTotal: 120, plays: 1, agentNumber: 'A001' },
      },
    }))
    mockUseParams.mockReturnValue({ gameKey: 'target' })
    render(<CbatLeaderboard />)
    await waitFor(() => expect(screen.getByText('#38')).toBeDefined())
    expect(screen.getByText('Agent A001 (you)')).toBeDefined()
  })
})

describe('CbatLeaderboard — all-time tab', () => {
  beforeEach(() => vi.clearAllMocks())

  const allTimeRows = (rows) => mockApi({ allTime: { leaderboard: rows } })

  it('renders medals for top 3 and # for the rest', async () => {
    setupAuth(allTimeRows([
      { _id: 'e1', userId: 'u1', rank: 1, bestScore: 15, bestTime: 30.5, agentNumber: 'A001' },
      { _id: 'e2', userId: 'u2', rank: 2, bestScore: 14, bestTime: 31.0, agentNumber: 'A002' },
      { _id: 'e3', userId: 'u3', rank: 3, bestScore: 13, bestTime: 32.0, agentNumber: 'A003' },
      { _id: 'e4', userId: 'u4', rank: 4, bestScore: 12, bestTime: 33.0, agentNumber: 'A004' },
    ]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('Agent A001 (you)')).toBeDefined())
    expect(screen.getByText('🥇')).toBeDefined()
    expect(screen.getByText('🥈')).toBeDefined()
    expect(screen.getByText('🥉')).toBeDefined()
    expect(screen.getByText('#4')).toBeDefined()
  })

  it('formats the score per game config (e.g. "15/15" for Symbols) with time', async () => {
    setupAuth(allTimeRows([{ _id: 'e1', userId: 'u1', rank: 1, bestScore: 15, bestTime: 42.5, agentNumber: 'A001' }]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('15/15')).toBeDefined())
    expect(screen.getByText('42.5s')).toBeDefined()
  })

  it('renders email instead of agent number for admin rows', async () => {
    setupAuth(allTimeRows([
      { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', email: 'ace@skywatch.test' },
      { _id: 'e2', userId: 'u1',    rank: 2, bestScore: 14, bestTime: 31, agentNumber: 'A001', email: 'me@skywatch.test' },
    ]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('ace@skywatch.test')).toBeDefined())
    expect(screen.getByText('me@skywatch.test (you)')).toBeDefined()
  })

  it('renders displayName with precedence over email', async () => {
    setupAuth(allTimeRows([
      { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', displayName: 'Maverick', email: 'ace@skywatch.test' },
      { _id: 'e2', userId: 'u1',    rank: 2, bestScore: 14, bestTime: 31, agentNumber: 'A001', displayName: 'Goose' },
    ]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('Maverick')).toBeDefined())
    expect(screen.getByText('Goose (you)')).toBeDefined()
    expect(screen.queryByText('ace@skywatch.test')).toBeNull()
  })

  it('renders a hover tooltip with formatted achievedAt on admin rows, none on fakes', async () => {
    const achievedAt = '2026-04-29T13:45:00.000Z'
    setupAuth(allTimeRows([
      { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', email: 'ace@skywatch.test', achievedAt },
      { _id: 'e2', userId: 'u2',    rank: 2, bestScore: 14, bestTime: 31, agentNumber: 'A998', email: 'demo', isFake: true },
    ]))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    const realCell = await waitFor(() => screen.getByText('ace@skywatch.test'))
    expect(realCell.getAttribute('title')).toBe(new Date(achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }))
    expect(screen.getByText('demo').getAttribute('title')).toBeNull()
  })

  it('shows the all-time myBest row when the user is outside the top list', async () => {
    setupAuth(mockApi({
      allTime: {
        leaderboard: [{ _id: 'e1', userId: 'other1', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A101' }],
        myBest: { _id: 'me', userId: 'u1', rank: 47, bestScore: 10, bestTime: 55.0, agentNumber: 'A001' },
      },
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)
    await selectAllTime()

    await waitFor(() => expect(screen.getByText('#47')).toBeDefined())
    expect(screen.getByText('Agent A001 (you)')).toBeDefined()
  })
})
