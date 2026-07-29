import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import RecentCbatScores from '../RecentCbatScores'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className, ...rest }) => <a href={to} className={className} {...rest}>{children}</a>,
  useNavigate: () => mockNavigate,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

function mockFetch(recent) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', data: { recent } }),
  })
}

function setupAuth({ userId = 'me', isAdmin = false, apiFetch }) {
  mockUseAuth.mockReturnValue({
    user: { _id: userId, isAdmin },
    API: '',
    apiFetch,
  })
}

describe('RecentCbatScores — current-user highlight', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks the current user\'s rows with "(you)"', async () => {
    setupAuth({
      userId: 'me',
      apiFetch: mockFetch([
        { _id: 'r1', userId: 'other', gameKey: 'plane-turn-2d', gameLabel: 'Plane Turn 2D', rank: 1, agentNumber: 'A999', displayName: 'Maverick', achievedAt: new Date().toISOString() },
        { _id: 'r2', userId: 'me',    gameKey: 'angles',     gameLabel: 'Angles',     rank: 4, agentNumber: 'A001', displayName: 'Goose',    achievedAt: new Date().toISOString() },
      ]),
    })
    render(<RecentCbatScores />)
    await waitFor(() => expect(screen.getByText(/Goose \(you\)/)).toBeDefined())
    expect(screen.getByText('Maverick')).toBeDefined()
    expect(screen.queryByText(/Maverick \(you\)/)).toBeNull()
  })

  it('does not annotate rows when no row matches the current user', async () => {
    setupAuth({
      userId: 'me',
      apiFetch: mockFetch([
        { _id: 'r1', userId: 'other', gameKey: 'plane-turn-2d', gameLabel: 'Plane Turn 2D', rank: 1, agentNumber: 'A999', displayName: 'Maverick', achievedAt: new Date().toISOString() },
      ]),
    })
    render(<RecentCbatScores />)
    await waitFor(() => expect(screen.getByText('Maverick')).toBeDefined())
    expect(screen.queryByText(/\(you\)/)).toBeNull()
  })

  it('falls back to "Agent X" when no displayName is set', async () => {
    setupAuth({
      userId: 'me',
      apiFetch: mockFetch([
        { _id: 'r1', userId: 'me', gameKey: 'symbols', gameLabel: 'Symbols', rank: 3, agentNumber: 'A001', displayName: null, achievedAt: new Date().toISOString() },
      ]),
    })
    render(<RecentCbatScores />)
    await waitFor(() => expect(screen.getByText(/Agent A001 \(you\)/)).toBeDefined())
  })
})

describe('RecentCbatScores — row links to the all-time leaderboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('points the row link at the game leaderboard, pinned to the all-time tab', async () => {
    setupAuth({
      userId: 'me',
      apiFetch: mockFetch([
        { _id: 'r1', userId: 'other', gameKey: 'angles', gameLabel: 'Angles', rank: 2, agentNumber: 'A999', displayName: 'Maverick', achievedAt: new Date().toISOString() },
      ]),
    })
    render(<RecentCbatScores />)
    const link = await screen.findByRole('link', { name: /Angles all-time leaderboard/ })
    expect(link.getAttribute('href')).toBe('/cbat/angles/leaderboard?period=all-time')
  })
})

describe('RecentCbatScores — admin username → CBAT history', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the username as a button that opens the admin history for that user', async () => {
    setupAuth({
      userId: 'admin',
      isAdmin: true,
      apiFetch: mockFetch([
        { _id: 'r1', userId: 'other', gameKey: 'angles', gameLabel: 'Angles', rank: 2, agentNumber: 'A999', displayName: 'Maverick', achievedAt: new Date().toISOString() },
      ]),
    })
    render(<RecentCbatScores />)
    const btn = await screen.findByRole('button', { name: /Maverick/ })
    await userEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/cbat-game-history', {
      state: { adminUserId: 'other', adminUserName: 'Maverick' },
    })
  })

  it('does not expose a username button to non-admins', async () => {
    setupAuth({
      userId: 'me',
      isAdmin: false,
      apiFetch: mockFetch([
        { _id: 'r1', userId: 'other', gameKey: 'angles', gameLabel: 'Angles', rank: 2, agentNumber: 'A999', displayName: 'Maverick', achievedAt: new Date().toISOString() },
      ]),
    })
    render(<RecentCbatScores />)
    await screen.findByText('Maverick')
    expect(screen.queryByRole('button', { name: /Maverick/ })).toBeNull()
  })
})

// FLAG and CUT each keep two boards. A score on one means nothing without
// knowing which, and the backend's "(Easier)" label suffix is the first thing
// to truncate away in this narrow column — so the row carries an explicit chip.
describe('RecentCbatScores — difficulty chip', () => {
  beforeEach(() => vi.clearAllMocks())

  const row = (id, gameKey, gameLabel) => ({
    _id: id, userId: 'other', gameKey, gameLabel, rank: 2,
    agentNumber: 'A100', displayName: `Pilot ${id}`, achievedAt: new Date().toISOString(),
  })

  it('labels both halves of a split game, not just the easier one', async () => {
    setupAuth({
      apiFetch: mockFetch([
        row('r1', 'flag-easier', 'FLAG (Easier)'),
        row('r2', 'flag', 'FLAG'),
        row('r3', 'cut-easier', 'Cognitive Updating Test (Easier)'),
        row('r4', 'cut', 'Cognitive Updating Test'),
      ]),
    })
    render(<RecentCbatScores />)

    await waitFor(() => expect(document.querySelectorAll('[data-difficulty]')).toHaveLength(4))
    const chips = [...document.querySelectorAll('[data-difficulty]')].map(c => c.getAttribute('data-difficulty'))
    expect(chips).toEqual(['easier', 'hard', 'easier', 'hard'])
  })

  it('drops the duplicated "(Easier)" suffix from the title beside the chip', async () => {
    setupAuth({ apiFetch: mockFetch([row('r1', 'cut-easier', 'Cognitive Updating Test (Easier)')]) })
    render(<RecentCbatScores />)

    await waitFor(() => expect(screen.getByText('Cognitive Updating Test')).toBeDefined())
    expect(screen.queryByText(/\(Easier\)/)).toBeNull()
    expect(screen.getByText('Easier')).toBeDefined()
  })

  it('leaves games without a difficulty split unchipped', async () => {
    setupAuth({ apiFetch: mockFetch([row('r1', 'angles', 'Angles')]) })
    render(<RecentCbatScores />)

    await waitFor(() => expect(screen.getByText('Angles')).toBeDefined())
    expect(document.querySelector('[data-difficulty]')).toBeNull()
  })

  it('routes an Easier row to the Easier board', async () => {
    setupAuth({ apiFetch: mockFetch([row('r1', 'flag-easier', 'FLAG (Easier)')]) })
    render(<RecentCbatScores />)

    const link = await screen.findByRole('link', { name: /FLAG Easier all-time leaderboard/i })
    expect(link.getAttribute('href')).toBe('/cbat/flag-easier/leaderboard?period=all-time')
  })
})
