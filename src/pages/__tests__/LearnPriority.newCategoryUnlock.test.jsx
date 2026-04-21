import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ── Mocks (must be declared before importing the page) ────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/learn-priority', search: '', hash: '' }),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), visible: false, hasSeen: () => true }),
}))

vi.mock('../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: vi.fn(),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

// FlyingNewBadge stub — fires onArrived synchronously on mount so the
// orchestrator advances through the queue without waiting on real animation.
vi.mock('../../components/FlyingNewBadge', () => ({
  default: ({ onArrived, label }) => {
    React.useEffect(() => { onArrived?.() }, [onArrived])
    return <div data-testid="flying-badge">{label}</div>
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
import { useNewCategoryUnlock } from '../../context/NewCategoryUnlockContext'

// ── Test helpers ──────────────────────────────────────────────────────────

const markSeenSpy = vi.fn()

function mockSettingsFetch() {
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/api/settings')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          // All levelRequired: 1 so every pathway is "unlocked" for the test user
          pathwayUnlocks: [
            { category: 'News',      levelRequired: 1, rankRequired: 1 },
            { category: 'Bases',     levelRequired: 1, rankRequired: 1 },
            { category: 'Aircrafts', levelRequired: 1, rankRequired: 1 },
          ],
          freeCategories:   [],
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
    if (url.includes('/api/briefs/pathway/')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { briefs: [] } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

beforeEach(() => {
  markSeenSpy.mockReset()
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
  mockSettingsFetch()

  // The orchestrator measures against this element for the fly-from coordinate
  const nav = document.createElement('div')
  nav.setAttribute('data-nav', 'learn')
  nav.id = '__test_learn_nav__'
  document.body.appendChild(nav)
})

afterEach(() => {
  document.getElementById('__test_learn_nav__')?.remove()
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('LearnPriority — new category unlock sequence', () => {
  it('single unlock: swipes to new category, fires markSeen, shows persistent pill', async () => {
    useNewCategoryUnlock.mockReturnValue({
      newCategories:    new Set(['Bases']),
      hasAnyNew:        true,
      firstNewCategory: 'Bases',
      markSeen:         markSeenSpy,
      markAllSeen:      vi.fn(),
      applyUnlocks:     vi.fn(),
    })

    render(<LearnPriority />)

    // Bases should become the active pathway (orchestrator swipes there on mount)
    await waitFor(() => {
      expect(screen.getByTestId('category-card-Bases')).toBeDefined()
    }, { timeout: 2000 })

    // Fly step runs after 250ms; FlyingNewBadge stub calls onArrived synchronously
    // → handleBadgeArrived → markSeen('Bases')
    await waitFor(() => {
      expect(markSeenSpy).toHaveBeenCalledWith('Bases')
    }, { timeout: 2000 })

    expect(markSeenSpy).toHaveBeenCalledTimes(1)

    // Persistent "NEW" pill should now be visible on the Bases card
    await waitFor(() => {
      const card = screen.getByTestId('category-card-Bases')
      expect(card.textContent).toMatch(/NEW/)
    })
  })

  it('multi unlock: plays sequence in pathway order and calls markSeen for each', async () => {
    useNewCategoryUnlock.mockReturnValue({
      newCategories:    new Set(['Bases', 'Aircrafts']),
      hasAnyNew:        true,
      firstNewCategory: 'Bases',
      markSeen:         markSeenSpy,
      markAllSeen:      vi.fn(),
      applyUnlocks:     vi.fn(),
    })

    render(<LearnPriority />)

    // First category (Bases — earlier in pathway list) animates first
    await waitFor(() => {
      expect(markSeenSpy).toHaveBeenCalledWith('Bases')
    }, { timeout: 2000 })

    // After 1200ms pause the sequence advances to Aircrafts and fires markSeen
    await waitFor(() => {
      expect(markSeenSpy).toHaveBeenCalledWith('Aircrafts')
    }, { timeout: 4000 })

    // Pathway order preserved: Bases first, Aircrafts second
    const calls = markSeenSpy.mock.calls.map(c => c[0])
    expect(calls.indexOf('Bases')).toBeLessThan(calls.indexOf('Aircrafts'))
    expect(markSeenSpy).toHaveBeenCalledTimes(2)
  })

  it('no unlocks: does not call markSeen and does not render flying badge', async () => {
    useNewCategoryUnlock.mockReturnValue({
      newCategories:    new Set(),
      hasAnyNew:        false,
      firstNewCategory: null,
      markSeen:         markSeenSpy,
      markAllSeen:      vi.fn(),
      applyUnlocks:     vi.fn(),
    })

    render(<LearnPriority />)

    // Wait for settings to settle and the default active pathway to render
    await waitFor(() => {
      // One of the categories should be active — doesn't matter which
      expect(
        screen.queryByTestId('category-card-News') ||
        screen.queryByTestId('category-card-Bases') ||
        screen.queryByTestId('category-card-Aircrafts')
      ).toBeTruthy()
    }, { timeout: 2000 })

    // Give the fly-step timeout (250ms) a chance — it should not fire
    await new Promise(resolve => setTimeout(resolve, 400))

    expect(markSeenSpy).not.toHaveBeenCalled()
    expect(screen.queryByTestId('flying-badge')).toBeNull()
  })
})
