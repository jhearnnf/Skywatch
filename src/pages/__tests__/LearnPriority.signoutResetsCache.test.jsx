import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ── Mocks (must be declared before importing the page) ────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/learn-priority', search: '', hash: '' }),
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), visible: false, hasSeen: () => true }),
}))

vi.mock('../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: () => ({
    newCategories:    new Set(),
    hasAnyNew:        false,
    firstNewCategory: null,
    markSeen:         vi.fn(),
    markAllSeen:      vi.fn(),
    applyUnlocks:     vi.fn(),
  }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('../../components/FlyingNewBadge', () => ({
  default: ({ onArrived }) => {
    React.useEffect(() => { onArrived?.() }, [onArrived])
    return null
  },
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style }) => (
      <div className={className} style={style}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }) => <>{children}</>,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
  useAnimationControls: () => ({ start: vi.fn() }),
}))

import LearnPriority from '../LearnPriority'
import { useAuth } from '../../context/AuthContext'

// ── Test helpers ──────────────────────────────────────────────────────────

const READ_BRIEFS = [
  { _id: 'b1', category: 'News', priorityNumber: 1, status: 'live', isRead: true,  isInProgress: false },
  { _id: 'b2', category: 'News', priorityNumber: 2, status: 'live', isRead: true,  isInProgress: false },
  { _id: 'b3', category: 'News', priorityNumber: 3, status: 'live', isRead: false, isInProgress: false },
]

const UNREAD_BRIEFS = [
  { _id: 'b1', category: 'News', priorityNumber: 1, status: 'live', isRead: false, isInProgress: false },
  { _id: 'b2', category: 'News', priorityNumber: 2, status: 'live', isRead: false, isInProgress: false },
  { _id: 'b3', category: 'News', priorityNumber: 3, status: 'live', isRead: false, isInProgress: false },
]

let pathwayFetchCount = 0
let currentPathwayBriefs = READ_BRIEFS

function installFetchMock() {
  pathwayFetchCount = 0
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/api/settings')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          pathwayUnlocks: [
            { category: 'News', levelRequired: 1, rankRequired: 1 },
          ],
          freeCategories:   ['News'],
          silverCategories: [],
        }),
      })
    }
    if (url.includes('/api/users/levels')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { levels: [] } }) })
    }
    if (url.includes('/api/games/quiz/completed-brief-ids')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { ids: [] } }) })
    }
    if (url.includes('/api/briefs/pathway-counts')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) })
    }
    if (url.includes('/api/briefs/pathway/')) {
      pathwayFetchCount += 1
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { briefs: currentPathwayBriefs } }),
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

beforeEach(() => {
  installFetchMock()
  currentPathwayBriefs = READ_BRIEFS
  useAuth.mockReturnValue({
    user: {
      _id:               'u1',
      subscriptionTier:  'gold',
      rank:              { rankNumber: 5 },
      cycleAirstars:     5000,
    },
    API:      '',
    apiFetch: (...args) => fetch(...args),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('LearnPriority — sign-out invalidates cached briefs', () => {
  it('refetches the active pathway when the logged-in user changes', async () => {
    const { rerender } = render(<LearnPriority />)

    // Initial render: pathway briefs fetched once for user u1
    await waitFor(() => {
      expect(pathwayFetchCount).toBeGreaterThanOrEqual(1)
    }, { timeout: 2000 })
    const initialCount = pathwayFetchCount

    // Sign out: useAuth now returns null user. Backend would return briefs
    // with isRead: false for an anonymous request.
    currentPathwayBriefs = UNREAD_BRIEFS
    useAuth.mockReturnValue({
      user:     null,
      API:      '',
      apiFetch: (...args) => fetch(...args),
    })

    rerender(<LearnPriority />)

    // The cached briefs (from the authenticated session) must be dropped and
    // refetched so stale isRead flags don't leak across the sign-out boundary.
    await waitFor(() => {
      expect(pathwayFetchCount).toBeGreaterThan(initialCount)
    }, { timeout: 2000 })
  })

  it('does NOT refetch when other auth-context values change but user._id stays the same', async () => {
    const { rerender } = render(<LearnPriority />)

    await waitFor(() => {
      expect(pathwayFetchCount).toBeGreaterThanOrEqual(1)
    }, { timeout: 2000 })
    const initialCount = pathwayFetchCount

    // Same user._id, same identity — should be a no-op for the cache.
    useAuth.mockReturnValue({
      user: {
        _id:               'u1',
        subscriptionTier:  'gold',
        rank:              { rankNumber: 5 },
        cycleAirstars:     5001, // cosmetic change
      },
      API:      '',
      apiFetch: (...args) => fetch(...args),
    })

    rerender(<LearnPriority />)

    // Give any spurious effect a chance to fire
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(pathwayFetchCount).toBe(initialCount)
  })
})
