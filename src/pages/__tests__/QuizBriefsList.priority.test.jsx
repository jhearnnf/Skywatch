import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'
import QuizBriefsList from '../QuizBriefsList'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { _id: 'u1' }, API: '', apiFetch: (...args) => fetch(...args) })),
}))

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

import { useAuth } from '../../context/AuthContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mock the new single endpoint /api/games/quiz/briefs.
 * The endpoint returns { briefs, total, page, totalPages, availableMode }
 * where each brief has a quizState field.
 */
function mockEndpoint({ briefs = [], availableMode = null, totalPages = 1 } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: { briefs, total: briefs.length, page: 1, totalPages, availableMode },
    }),
  })
}

function setup(opts = {}) {
  useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: (...args) => fetch(...args) })
  mockEndpoint(opts)
  render(<QuizBriefsList />)
}

afterEach(() => { vi.restoreAllMocks() })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('QuizBriefsList — Available tab (server-driven)', () => {
  it('renders active briefs returned by the server', async () => {
    setup({
      briefs: [{ _id: 'b1', title: 'Active Brief', category: 'Aircrafts', quizState: 'active' }],
      availableMode: 'active',
    })
    await waitFor(() => screen.getByText('Active Brief'))
  })

  it('renders needs-read briefs with "Read first" badge', async () => {
    setup({
      briefs: [{ _id: 'b1', title: 'Unread Brief', category: 'Aircrafts', quizState: 'needs-read' }],
      availableMode: 'needs-read',
    })
    await waitFor(() => screen.getByText('Unread Brief'))
    expect(screen.getByText(/read first/i)).toBeDefined()
  })

  it('shows "read to unlock" banner when availableMode=needs-read', async () => {
    setup({
      briefs: [{ _id: 'b1', title: 'Unread Brief', category: 'Aircrafts', quizState: 'needs-read' }],
      availableMode: 'needs-read',
    })
    await waitFor(() => screen.getByText(/read these briefs to unlock their quizzes/i))
  })

  it('does not show "read to unlock" banner when availableMode=active', async () => {
    setup({
      briefs: [{ _id: 'b1', title: 'Active Brief', category: 'Aircrafts', quizState: 'active' }],
      availableMode: 'active',
    })
    await waitFor(() => screen.getByText('Active Brief'))
    expect(screen.queryByText(/read these briefs to unlock their quizzes/i)).toBeNull()
  })

  it('shows "all quizzes complete" banner when availableMode=all-passed', async () => {
    setup({ briefs: [], availableMode: 'all-passed' })
    // Empty list triggers the empty state message, not the all-complete banner.
    // all-passed banner is shown when briefs list is non-empty in the fallback.
    // Re-setup with a passed brief so the list is non-empty:
    vi.restoreAllMocks()
    setup({
      briefs: [{ _id: 'b1', title: 'Passed Brief', category: 'Aircrafts', quizState: 'passed' }],
      availableMode: 'all-passed',
    })
    await waitFor(() => screen.getByText(/all quizzes complete/i))
  })
})

describe('QuizBriefsList — Completed tab', () => {
  it('fetches completed state when Completed tab is clicked', async () => {
    setup({
      briefs: [{ _id: 'b1', title: 'Active Brief', category: 'Aircrafts', quizState: 'active' }],
      availableMode: 'active',
    })
    await waitFor(() => screen.getByText('Active Brief'))

    // Switch to Completed tab — a new fetch fires with state=completed
    mockEndpoint({
      briefs: [{ _id: 'b2', title: 'Passed Brief', category: 'Aircrafts', quizState: 'passed' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))

    await waitFor(() => screen.getByText('Passed Brief'))
    expect(screen.queryByText('Active Brief')).toBeNull()
  })

  it('shows ✓ Passed badge on passed briefs', async () => {
    useAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch: (...args) => fetch(...args) })
    mockEndpoint({
      briefs: [{ _id: 'b1', title: 'Passed Brief', category: 'Aircrafts', quizState: 'passed' }],
    })
    render(<QuizBriefsList />)
    // Click Completed tab
    mockEndpoint({
      briefs: [{ _id: 'b1', title: 'Passed Brief', category: 'Aircrafts', quizState: 'passed' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    await waitFor(() => screen.getByText(/✓ Passed/i))
  })
})

describe('QuizBriefsList — All tab', () => {
  it('fetches all state when All tab is clicked', async () => {
    setup({
      briefs: [{ _id: 'b1', title: 'Active Brief', category: 'Aircrafts', quizState: 'active' }],
      availableMode: 'active',
    })
    await waitFor(() => screen.getByText('Active Brief'))

    mockEndpoint({
      briefs: [
        { _id: 'b1', title: 'Active Brief', category: 'Aircrafts', quizState: 'active' },
        { _id: 'b2', title: 'Passed Brief', category: 'Aircrafts', quizState: 'passed' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'All' }))

    await waitFor(() => screen.getByText('Passed Brief'))
    expect(screen.getByText('Active Brief')).toBeDefined()
  })
})

describe('QuizBriefsList — Load More', () => {
  it('shows Load More button when hasMore is true (totalPages > 1)', async () => {
    setup({
      briefs: [{ _id: 'b1', title: 'Brief 1', category: 'Aircrafts', quizState: 'active' }],
      totalPages: 2,
      availableMode: 'active',
    })
    await waitFor(() => screen.getByRole('button', { name: /load more/i }))
  })

  it('does not show Load More when on last page', async () => {
    setup({
      briefs: [{ _id: 'b1', title: 'Brief 1', category: 'Aircrafts', quizState: 'active' }],
      totalPages: 1,
      availableMode: 'active',
    })
    await waitFor(() => screen.getByText('Brief 1'))
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })

  it('appends briefs when Load More is clicked', async () => {
    setup({
      briefs: [{ _id: 'b1', title: 'Brief 1', category: 'Aircrafts', quizState: 'active' }],
      totalPages: 2,
      availableMode: 'active',
    })
    await waitFor(() => screen.getByText('Brief 1'))

    mockEndpoint({
      briefs: [{ _id: 'b2', title: 'Brief 2', category: 'Aircrafts', quizState: 'active' }],
      totalPages: 2,
    })
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))

    await waitFor(() => screen.getByText('Brief 2'))
    expect(screen.getByText('Brief 1')).toBeDefined()
  })
})

describe('QuizBriefsList — empty and unauthenticated states', () => {
  it('shows sign-in prompt when user is null', () => {
    useAuth.mockReturnValue({ user: null, API: '', apiFetch: (...args) => fetch(...args) })
    global.fetch = vi.fn()
    render(<QuizBriefsList />)
    expect(screen.getAllByText(/sign in/i).length).toBeGreaterThan(0)
  })

  it('shows empty state when no briefs returned', async () => {
    setup({ briefs: [], availableMode: null })
    await waitFor(() => screen.getByText(/no briefs in this category yet/i))
  })
})
