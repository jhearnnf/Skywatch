import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import IntelBriefHistory from '../IntelBriefHistory'

// ── Hoisted mock fns ───────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...rest }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE_USER = { _id: 'user1', email: 'agent@test.com', displayName: 'Agent' }

const MOCK_READS = [
  {
    _id: 'r1',
    briefId: 'b1',
    title: 'F-35 Stealth Overview',
    category: 'aviation',
    timeSpentSeconds: 185,
    firstReadAt: '2026-03-10T14:30:00.000Z',
    lastReadAt:  '2026-03-10T14:33:05.000Z',
  },
  {
    _id: 'r2',
    briefId: 'b2',
    title: 'Hypersonic Missiles',
    category: 'weapons',
    timeSpentSeconds: 300,
    firstReadAt: '2026-03-09T10:00:00.000Z',
    lastReadAt:  '2026-03-09T10:05:00.000Z',
  },
]

function setupAuth(user = BASE_USER) {
  mockUseAuth.mockReturnValue({ user, API: '', apiFetch: (...args) => fetch(...args) })
}

function makeSuccessFetch(reads = MOCK_READS, total = 2, avgTimeSeconds = 242) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { reads, total, avgTimeSeconds } }),
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('IntelBriefHistory', () => {
  beforeEach(() => {
    setupAuth()
    mockNavigate.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('redirects to /login if no user', () => {
    mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch: (...args) => fetch(...args) })
    global.fetch = vi.fn()
    render(<IntelBriefHistory />)
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })

  it('shows loading skeletons while fetching', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) // never resolves
    render(<IntelBriefHistory />)
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders brief titles after fetch', async () => {
    global.fetch = makeSuccessFetch()
    render(<IntelBriefHistory />)
    await waitFor(() => screen.getByText('F-35 Stealth Overview'))
    expect(screen.getByText('Hypersonic Missiles')).toBeDefined()
  })

  it('renders category badges', async () => {
    global.fetch = makeSuccessFetch()
    render(<IntelBriefHistory />)
    await waitFor(() => screen.getByText('Aviation'))
    expect(screen.getByText('Weapons')).toBeDefined()
  })

  it('renders time spent for each brief', async () => {
    global.fetch = makeSuccessFetch()
    render(<IntelBriefHistory />)
    // 185s = 3m 5s, 300s = 5m
    await waitFor(() => screen.getByText('3m 5s'))
    expect(screen.getByText('5m')).toBeDefined()
  })

  it('renders avg read time in the summary card', async () => {
    global.fetch = makeSuccessFetch(MOCK_READS, 2, 242) // 242s = 4m 2s
    render(<IntelBriefHistory />)
    await waitFor(() => screen.getByText('4m 2s'))
  })

  it('shows total brief count in summary card', async () => {
    global.fetch = makeSuccessFetch(MOCK_READS, 2, 242)
    render(<IntelBriefHistory />)
    await waitFor(() => screen.getByText(/2 briefs on record/))
  })

  it('shows empty state when no reads', async () => {
    global.fetch = makeSuccessFetch([], 0, 0)
    render(<IntelBriefHistory />)
    await waitFor(() => screen.getByText('No briefs read yet.'))
  })

  it('shows "—" for zero time spent', async () => {
    const reads = [{ ...MOCK_READS[0], timeSpentSeconds: 0 }]
    global.fetch = makeSuccessFetch(reads, 1, 0)
    render(<IntelBriefHistory />)
    await waitFor(() => screen.getByText('F-35 Stealth Overview'))
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows error message on fetch failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Server error' }),
    })
    render(<IntelBriefHistory />)
    await waitFor(() => screen.getByText('Server error'))
  })

  it('Back button navigates to /profile', async () => {
    global.fetch = makeSuccessFetch()
    render(<IntelBriefHistory />)
    await waitFor(() => screen.getByText('← Back'))
    fireEvent.click(screen.getByText('← Back'))
    expect(mockNavigate).toHaveBeenCalledWith('/profile')
  })

  it('shows pagination controls when totalPages > 1', async () => {
    // 31 results with limit=30 → 2 pages
    const manyReads = Array.from({ length: 30 }, (_, i) => ({
      ...MOCK_READS[0],
      _id: `r${i}`,
      title: `Brief ${i}`,
    }))
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { reads: manyReads, total: 31, avgTimeSeconds: 100 } }),
    })
    render(<IntelBriefHistory />)
    await waitFor(() => screen.getByText('Next →'))
    expect(screen.getByText('← Prev')).toBeDefined()
  })
})
