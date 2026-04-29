import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatLeaderboard from '../CbatLeaderboard'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth   = vi.hoisted(() => vi.fn())
const mockUseParams = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useParams: () => mockUseParams(),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────

function mockApiFetch({ leaderboard = [], myBest = null } = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { leaderboard, myBest } }),
  })
}

function setupAuth(apiFetch = mockApiFetch()) {
  mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
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

describe('CbatLeaderboard — empty state', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders a "No scores yet" empty state with a Play Now CTA', async () => {
    setupAuth(mockApiFetch({ leaderboard: [] }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    await waitFor(() => expect(screen.getByText('No scores yet')).toBeDefined())
    const play = screen.getByRole('link', { name: /play now/i })
    expect(play.getAttribute('href')).toBe('/cbat/symbols')
  })
})

describe('CbatLeaderboard — populated rows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders entries with medal emojis for top 3 and # for the rest', async () => {
    setupAuth(mockApiFetch({
      leaderboard: [
        { _id: 'e1', userId: 'u1', rank: 1, bestScore: 15, bestTime: 30.5, agentNumber: 'A001' },
        { _id: 'e2', userId: 'u2', rank: 2, bestScore: 14, bestTime: 31.0, agentNumber: 'A002' },
        { _id: 'e3', userId: 'u3', rank: 3, bestScore: 13, bestTime: 32.0, agentNumber: 'A003' },
        { _id: 'e4', userId: 'u4', rank: 4, bestScore: 12, bestTime: 33.0, agentNumber: 'A004' },
      ],
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    await waitFor(() => expect(screen.getByText('Agent A001 (you)')).toBeDefined())
    expect(screen.getByText('🥇')).toBeDefined()
    expect(screen.getByText('🥈')).toBeDefined()
    expect(screen.getByText('🥉')).toBeDefined()
    expect(screen.getByText('#4')).toBeDefined()
  })

  it('formats the score per game config (e.g. "15/15" for Symbols)', async () => {
    setupAuth(mockApiFetch({
      leaderboard: [{ _id: 'e1', userId: 'u1', rank: 1, bestScore: 15, bestTime: 42.5, agentNumber: 'A001' }],
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    await waitFor(() => expect(screen.getByText('15/15')).toBeDefined())
    expect(screen.getByText('42.5s')).toBeDefined()
  })

  it('highlights the current user with "(you)" marker', async () => {
    setupAuth(mockApiFetch({
      leaderboard: [
        { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999' },
        { _id: 'e2', userId: 'u1',    rank: 2, bestScore: 14, bestTime: 31, agentNumber: 'A001' },
      ],
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    await waitFor(() => expect(screen.getByText(/Agent A001 \(you\)/)).toBeDefined())
    expect(screen.queryByText(/Agent A999 \(you\)/)).toBeNull()
  })

  it('shows myBest row below the table when current user is outside the top list', async () => {
    setupAuth(mockApiFetch({
      leaderboard: [
        { _id: 'e1', userId: 'other1', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A101' },
      ],
      myBest:     { userId: 'u1', rank: 47, bestScore: 10, bestTime: 55.0, agentNumber: 'A001' },
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    await waitFor(() => expect(screen.getByText('#47')).toBeDefined())
    expect(screen.getByText('Agent A001 (you)')).toBeDefined()
  })
})

describe('CbatLeaderboard — admin email display', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders email instead of agent number when backend returns email (admin view)', async () => {
    setupAuth(mockApiFetch({
      leaderboard: [
        { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', email: 'ace@skywatch.test' },
        { _id: 'e2', userId: 'u1',    rank: 2, bestScore: 14, bestTime: 31, agentNumber: 'A001', email: 'me@skywatch.test' },
      ],
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    await waitFor(() => expect(screen.getByText('ace@skywatch.test')).toBeDefined())
    expect(screen.getByText('me@skywatch.test (you)')).toBeDefined()
    expect(screen.queryByText(/Agent A999/)).toBeNull()
    expect(screen.queryByText(/Agent A001/)).toBeNull()
  })

  it('renders email on the myBest row when admin is outside the top list', async () => {
    setupAuth(mockApiFetch({
      leaderboard: [
        { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', email: 'ace@skywatch.test' },
      ],
      myBest: { userId: 'u1', rank: 42, bestScore: 8, bestTime: 55, agentNumber: 'A001', email: 'boss@skywatch.test' },
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    await waitFor(() => expect(screen.getByText('#42')).toBeDefined())
    expect(screen.getByText('boss@skywatch.test (you)')).toBeDefined()
  })

  it('falls back to agent number when email is absent (non-admin view)', async () => {
    setupAuth(mockApiFetch({
      leaderboard: [
        { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999' },
      ],
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    await waitFor(() => expect(screen.getByText('Agent A999')).toBeDefined())
  })

  it('renders a hover tooltip with the formatted achievedAt on admin rows', async () => {
    const achievedAt = '2026-04-29T13:45:00.000Z'
    setupAuth(mockApiFetch({
      leaderboard: [
        { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', email: 'ace@skywatch.test', achievedAt },
        { _id: 'e2', userId: 'u2',    rank: 2, bestScore: 14, bestTime: 31, agentNumber: 'A998', email: 'demo', isFake: true },
      ],
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    const realCell = await waitFor(() => screen.getByText('ace@skywatch.test'))
    expect(realCell.getAttribute('title')).toBe(new Date(achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }))

    // Fakes (no achievedAt) carry no tooltip
    const fakeCell = screen.getByText('demo')
    expect(fakeCell.getAttribute('title')).toBeNull()
  })

  it('renders a hover tooltip on the myBest row when achievedAt is present', async () => {
    const achievedAt = '2026-04-28T09:15:00.000Z'
    setupAuth(mockApiFetch({
      leaderboard: [
        { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999', email: 'ace@skywatch.test' },
      ],
      myBest: { userId: 'u1', rank: 42, bestScore: 8, bestTime: 55, agentNumber: 'A001', email: 'boss@skywatch.test', achievedAt },
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    const myCell = await waitFor(() => screen.getByText('boss@skywatch.test (you)'))
    expect(myCell.getAttribute('title')).toBe(new Date(achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }))
  })

  it('does NOT render a tooltip when achievedAt is absent (non-admin view)', async () => {
    setupAuth(mockApiFetch({
      leaderboard: [
        { _id: 'e1', userId: 'other', rank: 1, bestScore: 15, bestTime: 30, agentNumber: 'A999' },
      ],
    }))
    mockUseParams.mockReturnValue({ gameKey: 'symbols' })
    render(<CbatLeaderboard />)

    const cell = await waitFor(() => screen.getByText('Agent A999'))
    expect(cell.getAttribute('title')).toBeNull()
  })
})
