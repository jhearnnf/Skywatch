import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Slim mode brings Learn back with only the slim categories open
// (backend/constants/slimLearn.json). The rest show as "coming soon", and a
// guest who taps a brief is sent to sign in instead.

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ state: null, pathname: '/learn-priority', search: '', hash: '' }),
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }))

// What AppSettingsContext provides in slim mode.
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { learnCategoriesOverride: ['Aircrafts'] } }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), visible: false, hasSeen: () => true }),
}))

vi.mock('../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: () => ({
    newCategories: new Set(), hasAnyNew: false, firstNewCategory: null,
    markSeen: vi.fn(), markAllSeen: vi.fn(), applyUnlocks: vi.fn(),
  }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/FlyingNewBadge', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, className, style, onClick }) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ) }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
  useAnimationControls: () => ({ start: vi.fn() }),
}))

import LearnPriority from '../LearnPriority'
import { useAuth } from '../../context/AuthContext'

const AIRCRAFT = [
  { _id: 'a1', title: 'Typhoon', category: 'Aircrafts', priorityNumber: 1, status: 'published', isRead: false, isInProgress: false },
]
let pathwayUrls = []

beforeEach(() => {
  navigate.mockReset()
  pathwayUrls = []
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url.includes('/api/settings')) {
      // The full-site rules would lock Aircrafts (Level 2, Silver) — slim must override them.
      return Promise.resolve({ ok: true, json: async () => ({
        pathwayUnlocks: [
          { category: 'News',      levelRequired: 1, rankRequired: 1 },
          { category: 'Aircrafts', levelRequired: 2, rankRequired: 1 },
          { category: 'Bases',     levelRequired: 1, rankRequired: 1 },
        ],
        freeCategories: ['News'], silverCategories: ['News', 'Aircrafts'],
      }) })
    }
    if (url.includes('/api/briefs/pathway/')) {
      pathwayUrls.push(url)
      return Promise.resolve({ ok: true, json: async () => ({ data: { briefs: AIRCRAFT } }) })
    }
    if (url.includes('/api/users/levels')) return Promise.resolve({ ok: true, json: async () => ({ data: { levels: [] } }) })
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) })
  })
})

function signedIn(user) {
  useAuth.mockReturnValue({ user, API: '', apiFetch: (...a) => fetch(...a) })
}

describe('LearnPriority — slim mode', () => {
  it('opens on the Aircrafts pathway for a free level-1 player', async () => {
    signedIn({ _id: 'u1', subscriptionTier: 'free', rank: { rankNumber: 1 }, cycleAirstars: 0 })
    render(<LearnPriority />)
    await screen.findByTestId('category-card-Aircrafts')
    await waitFor(() => expect(pathwayUrls.some(u => u.endsWith('/pathway/Aircrafts'))).toBe(true))
    expect(pathwayUrls.some(u => !u.endsWith('/pathway/Aircrafts'))).toBe(false)
  })

  it('shows the other pathways as coming soon, with nothing to unlock', async () => {
    signedIn({ _id: 'u1', subscriptionTier: 'gold', rank: { rankNumber: 1 }, cycleAirstars: 0 })
    render(<LearnPriority />)
    await screen.findByTestId('category-card-Aircrafts')
    fireEvent.click(await screen.findByText(/News →|Bases →/))
    expect(await screen.findByText(/Pathway Coming Soon/)).toBeDefined()
    expect(screen.queryByText('How to Unlock')).toBeNull()
  })

  it('sends a guest to sign in when they tap a brief', async () => {
    signedIn(null)
    render(<LearnPriority />)
    const title = await screen.findAllByText('Typhoon')
    const stone = title[0].closest('div').parentElement.querySelector('button')
    fireEvent.click(stone)
    expect(navigate).toHaveBeenCalledWith('/login?tab=signin&pendingBrief=a1')
  })
})
