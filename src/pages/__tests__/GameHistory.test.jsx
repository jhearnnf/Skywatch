import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import GameHistory from '../GameHistory'

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, ...rest }) => <div className={className} style={style}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE_USER = { _id: 'u1', email: 'a@test.com', displayName: 'Agent' }

function makeSession(overrides = {}) {
  return {
    _id:           `s-${Math.random()}`,
    type:          'quiz',
    date:          new Date().toISOString(),
    status:        'completed',
    briefTitle:    'Test Brief',
    difficulty:    'easy',
    correctAnswers: 5,
    totalQuestions: 5,
    percentageCorrect: 100,
    aircoinsEarned: 10,
    timeTakenSeconds: 60,
    canDrillDown:  false,
    resultCategory: 'perfect',
    ...overrides,
  }
}

function makeFetch(sessions = [], total = sessions.length) {
  return vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({ data: { sessions, total, page: 1, limit: 20 } }),
  })
}

function setup(fetchImpl) {
  mockUseAuth.mockReturnValue({ user: { ...BASE_USER }, API: '', apiFetch: (...args) => fetch(...args) })
  global.fetch = fetchImpl
  mockNavigate.mockClear()
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GameHistory — filter UI', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders type filter pills', async () => {
    setup(makeFetch([makeSession()]))
    render(<GameHistory />)
    await waitFor(() => screen.getByText('All Types'))
    expect(screen.getByText('🎯 Quiz')).toBeDefined()
    expect(screen.getByText('📋 Battle of Order')).toBeDefined()
    expect(screen.getByText("✈️ Where's That Aircraft")).toBeDefined()
    expect(screen.getByText('🃏 Flashcard')).toBeDefined()
  })

  it('renders result filter pills', async () => {
    setup(makeFetch([makeSession()]))
    render(<GameHistory />)
    await waitFor(() => screen.getByText('All Results'))
    expect(screen.getByText('⭐ Perfect')).toBeDefined()
    expect(screen.getByText('✓ Passed')).toBeDefined()
    expect(screen.getByText('✗ Failed')).toBeDefined()
    expect(screen.getByText('— Abandoned')).toBeDefined()
  })

  it('clicking a type filter sends ?type= param to the API', async () => {
    const mockFetch = makeFetch([makeSession()])
    setup(mockFetch)
    render(<GameHistory />)
    await waitFor(() => screen.getByText('🎯 Quiz'))

    fireEvent.click(screen.getByText('🎯 Quiz'))

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map(([url]) => url)
      expect(calls.some(url => url.includes('type=quiz'))).toBe(true)
    })
  })

  it('clicking a result filter sends ?result= param to the API', async () => {
    const mockFetch = makeFetch([makeSession()])
    setup(mockFetch)
    render(<GameHistory />)
    await waitFor(() => screen.getByText('⭐ Perfect'))

    fireEvent.click(screen.getByText('⭐ Perfect'))

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map(([url]) => url)
      expect(calls.some(url => url.includes('result=perfect'))).toBe(true)
    })
  })

  it('"All Types" does not add type param to URL', async () => {
    const mockFetch = makeFetch([makeSession()])
    setup(mockFetch)
    render(<GameHistory />)
    await waitFor(() => screen.getByText('🎯 Quiz'))

    // Switch to Quiz then back to All Types
    fireEvent.click(screen.getByText('🎯 Quiz'))
    fireEvent.click(screen.getByText('All Types'))

    await waitFor(() => {
      const lastCall = mockFetch.mock.calls.at(-1)[0]
      expect(lastCall).not.toMatch(/type=/)
    })
  })

  it('shows session count from API response', async () => {
    setup(makeFetch([makeSession(), makeSession()], 2))
    render(<GameHistory />)
    await waitFor(() => screen.getByText(/2 sessions on record/))
  })

  it('shows empty state when no sessions match filters', async () => {
    setup(makeFetch([], 0))
    render(<GameHistory />)
    await waitFor(() => screen.getByText(/No game sessions yet/))
  })
})
