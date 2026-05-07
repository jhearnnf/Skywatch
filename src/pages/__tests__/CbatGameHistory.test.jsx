import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'
import CbatGameHistory from '../CbatGameHistory'

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())
const mockLocation = vi.hoisted(() => ({
  state: { adminUserId: 'target1', adminUserName: 'Agent X' },
  pathname: '/cbat-game-history', search: '', hash: '',
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN_USER = { _id: 'admin1', email: 'admin@test.com', displayName: 'Admin', isAdmin: true }

function makeSession(overrides = {}) {
  return {
    _id:              `s-${Math.random()}`,
    gameKey:          'target',
    gameLabel:        'Target',
    status:           'finished',
    startedAt:        new Date('2026-04-01T10:00:00Z').toISOString(),
    finishedAt:       new Date('2026-04-01T10:05:00Z').toISOString(),
    totalTimeSeconds: 60,
    primaryField:     'totalScore',
    primaryValue:     42,
    grade:            null,
    ...overrides,
  }
}

function makeFetch(sessions = [], total = sessions.length, counts = null) {
  return vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({ data: {
      sessions, total, page: 1, limit: 20,
      counts: counts ?? { total, finished: sessions.filter(s => s.status === 'finished').length, abandoned: sessions.filter(s => s.status === 'abandoned').length },
    } }),
  })
}

function setup(fetchImpl) {
  mockUseAuth.mockReturnValue({ user: { ...ADMIN_USER }, API: '', apiFetch: (...args) => fetch(...args) })
  global.fetch = fetchImpl
  mockNavigate.mockClear()
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CbatGameHistory', () => {
  afterEach(() => vi.restoreAllMocks())

  it('hits the admin endpoint with the target user id', async () => {
    const mockFetch = makeFetch([makeSession()])
    setup(mockFetch)
    render(<CbatGameHistory />)
    await waitFor(() => {
      const calls = mockFetch.mock.calls.map(([url]) => url)
      expect(calls.some(url => url.includes('/api/admin/users/target1/cbat-history'))).toBe(true)
    })
  })

  it('renders finished and abandoned status badges', async () => {
    setup(makeFetch([
      makeSession({ status: 'finished',  gameLabel: 'Target',  _id: 'a' }),
      makeSession({ status: 'abandoned', gameLabel: 'Symbols', _id: 'b', finishedAt: null }),
    ], 2))
    render(<CbatGameHistory />)
    await waitFor(() => screen.getByText('Finished'))
    expect(screen.getByText('Abandoned')).toBeDefined()
  })

  it('clicking a game filter pill sends ?gameKey= param', async () => {
    const mockFetch = makeFetch([makeSession()])
    setup(mockFetch)
    render(<CbatGameHistory />)
    await waitFor(() => screen.getByText('Symbols'))

    fireEvent.click(screen.getByText('Symbols'))

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map(([url]) => url)
      expect(calls.some(url => url.includes('gameKey=symbols'))).toBe(true)
    })
  })

  it('clicking a result filter pill sends ?result= param', async () => {
    const mockFetch = makeFetch([makeSession()])
    setup(mockFetch)
    render(<CbatGameHistory />)
    await waitFor(() => screen.getByText('— Abandoned'))

    fireEvent.click(screen.getByText('— Abandoned'))

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map(([url]) => url)
      expect(calls.some(url => url.includes('result=abandoned'))).toBe(true)
    })
  })

  it('"All Games" does not include gameKey in the URL', async () => {
    const mockFetch = makeFetch([makeSession()])
    setup(mockFetch)
    render(<CbatGameHistory />)
    await waitFor(() => screen.getByText('Symbols'))

    fireEvent.click(screen.getByText('Symbols'))
    fireEvent.click(screen.getByText('All Games'))

    await waitFor(() => {
      const lastCall = mockFetch.mock.calls.at(-1)[0]
      expect(lastCall).not.toMatch(/gameKey=/)
    })
  })

  it('shows finished/abandoned/total counts in the header', async () => {
    setup(makeFetch(
      [makeSession({ status: 'finished' }), makeSession({ status: 'abandoned' })],
      2,
      { total: 2, finished: 1, abandoned: 1 }
    ))
    render(<CbatGameHistory />)
    await waitFor(() => screen.getByText('Agent X', { exact: false }))
    // Loose match across spans (numbers can render in separate elements).
    expect(screen.getByText(/finished/)).toBeDefined()
    expect(screen.getByText(/abandoned/)).toBeDefined()
  })

  it('shows the empty state when there are no sessions', async () => {
    setup(makeFetch([], 0, { total: 0, finished: 0, abandoned: 0 }))
    render(<CbatGameHistory />)
    await waitFor(() => screen.getByText(/No CBAT sessions yet/))
  })
})
