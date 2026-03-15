import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Learn from '../Learn'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: null }),
}))

vi.mock('../../../utils/subscription', () => ({
  isCategoryLocked: () => false,
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
    div2: ({ children }) => <div>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LOGGED_IN_USER = { _id: 'u1', subscriptionTier: 'gold' }

// category-stats response: Aircrafts has 2 read out of 5
const STATS_RESPONSE = {
  ok: true,
  json: async () => ({
    data: { stats: { Aircrafts: { total: 5, done: 2 } } },
  }),
}

const COUNTS_RESPONSE = {
  ok: true,
  json: async () => ({
    data: { counts: { Aircrafts: 5 } },
  }),
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Learn — stale progress cleared on logout', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('category-stats')) return Promise.resolve(STATS_RESPONSE)
      return Promise.resolve(COUNTS_RESPONSE)
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('shows per-user read progress when logged in', async () => {
    mockUseAuth.mockReturnValue({ user: LOGGED_IN_USER, API: '' })
    render(<Learn />)

    // Progress counter "2/5 read" appears for logged-in user
    await waitFor(() => expect(screen.getByText('2/5 read')).toBeDefined())
  })

  it('clears progress and hides read counts when user logs out', async () => {
    mockUseAuth.mockReturnValue({ user: LOGGED_IN_USER, API: '' })
    const { rerender } = render(<Learn />)

    // Wait for progress to load
    await waitFor(() => expect(screen.getByText('2/5 read')).toBeDefined())

    // Simulate logout — user becomes null
    mockUseAuth.mockReturnValue({ user: null, API: '' })
    rerender(<Learn />)

    // Progress counter must no longer appear
    await waitFor(() => expect(screen.queryByText('2/5 read')).toBeNull())
  })
})
