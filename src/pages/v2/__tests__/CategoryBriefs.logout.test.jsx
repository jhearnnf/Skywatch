import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CategoryBriefs from '../CategoryBriefs'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ category: 'Aircrafts' }),
  useNavigate: () => vi.fn(),
  Link:        ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../../data/mockData', () => ({
  CATEGORY_ICONS: { Aircrafts: '✈️' },
  SUBCATEGORIES:  {},
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BRIEF = { _id: 'b1', title: 'Typhoon FGR4', category: 'Aircrafts', keywords: [] }

const LOGGED_IN_USER = { _id: 'u1' }

function makeFetch({ briefIds = [], passedIds = [] } = {}) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('read-briefs'))          return Promise.resolve({ json: async () => ({ data: { briefIds } }) })
    if (url.includes('completed-brief-ids'))  return Promise.resolve({ json: async () => ({ data: { ids: passedIds } }) })
    return Promise.resolve({ json: async () => ({ data: { briefs: [BRIEF] } }) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CategoryBriefs — stale read/quiz state cleared on logout', () => {
  beforeEach(() => {
    global.fetch = makeFetch({ briefIds: ['b1'], passedIds: ['b1'] })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('shows read and quiz-passed indicators when logged in', async () => {
    mockUseAuth.mockReturnValue({ user: LOGGED_IN_USER, API: '' })
    render(<CategoryBriefs />)

    await waitFor(() => {
      expect(screen.getByText('✓ Read')).toBeDefined()
      expect(screen.getByText('★ Quiz Passed')).toBeDefined()
    })
  })

  it('clears read indicators when user logs out', async () => {
    mockUseAuth.mockReturnValue({ user: LOGGED_IN_USER, API: '' })
    const { rerender } = render(<CategoryBriefs />)

    await waitFor(() => expect(screen.getByText('✓ Read')).toBeDefined())

    // Simulate logout — guest fetch returns no read/quiz data
    global.fetch = makeFetch()
    mockUseAuth.mockReturnValue({ user: null, API: '' })
    rerender(<CategoryBriefs />)

    await waitFor(() => {
      expect(screen.queryByText('✓ Read')).toBeNull()
      expect(screen.queryByText('★ Quiz Passed')).toBeNull()
    })
  })
})
