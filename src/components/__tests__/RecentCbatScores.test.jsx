import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import RecentCbatScores from '../RecentCbatScores'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

function mockFetch(recent) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', data: { recent } }),
  })
}

function setupAuth({ userId = 'me', apiFetch }) {
  mockUseAuth.mockReturnValue({
    user: { _id: userId },
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
