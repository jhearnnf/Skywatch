import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Home from '../Home'

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(), useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseSettings,
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    svg:    ({ children, className, style }) => <svg className={className} style={style}>{children}</svg>,
    h2:     ({ children, className, style }) => <h2 className={className} style={style}>{children}</h2>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => false,
  useScroll:        () => ({ scrollY: 0 }),
  useTransform:     () => 0,
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SETTINGS = {
  guestCategories:  ['News'],
  freeCategories:   ['News'],
  silverCategories: ['News'],
}

const LOGGED_IN_USER = {
  _id: 'u1',
  displayName: 'Agent Test',
  subscriptionTier: 'gold',
  cycleAirstars: 0,
  loginStreak: 0,
}

// Brief as returned to a logged-in user who has read it
const READ_BRIEF = {
  _id: 'b1',
  title: 'Eurofighter Typhoon',
  category: 'Aircrafts',
  isRead: true,
  isStarted: true,
  isLocked: false,
}

// Same brief as returned to a guest — no read state
const UNREAD_BRIEF = {
  _id: 'b1',
  title: 'Eurofighter Typhoon',
  category: 'Aircrafts',
  isRead: false,
  isStarted: false,
  isLocked: false,
}

function makeFetch({ briefs }) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/category-counts')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { counts: { Aircrafts: 1 } } }) })
    }
    if (url.includes('/api/briefs/category-stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { stats: {} } }) })
    }
    if (url.includes('/api/briefs')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { briefs } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Home — stale brief read-state cleared on logout', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('shows brief in latest strip when logged in', async () => {
    global.fetch = makeFetch({ briefs: [READ_BRIEF] })
    mockUseAuth.mockReturnValue({ user: LOGGED_IN_USER, API: '', apiFetch: (...args) => fetch(...args) })
    mockUseSettings.mockReturnValue({ settings: SETTINGS })

    render(<Home />)

    await waitFor(() => expect(screen.getByText('Eurofighter Typhoon')).toBeDefined())
  })

  it('re-fetches brief strip after logout so isRead state resets', async () => {
    // Logged-in fetch returns brief with isRead: true
    global.fetch = makeFetch({ briefs: [READ_BRIEF] })
    mockUseAuth.mockReturnValue({ user: LOGGED_IN_USER, API: '', apiFetch: (...args) => fetch(...args) })
    mockUseSettings.mockReturnValue({ settings: SETTINGS })

    const { rerender } = render(<Home />)
    await waitFor(() => expect(screen.getByText('Eurofighter Typhoon')).toBeDefined())

    // Read state surfaces as a "Read" meta line under the title
    expect(screen.getByText('Read')).toBeDefined()

    // Simulate logout — guest fetch returns same brief but isRead: false
    global.fetch = makeFetch({ briefs: [UNREAD_BRIEF] })
    mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch: (...args) => fetch(...args) })
    rerender(<Home />)

    // After re-fetch, brief is still shown but no longer carries the read marker
    await waitFor(() => {
      expect(screen.queryByText('Read')).toBeNull()
      expect(screen.getByText('Eurofighter Typhoon')).toBeDefined()
    })
  })

  it('brief strip still visible to guests (not hidden on logout)', async () => {
    global.fetch = makeFetch({ briefs: [UNREAD_BRIEF] })
    mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch: (...args) => fetch(...args) })
    mockUseSettings.mockReturnValue({ settings: SETTINGS })

    render(<Home />)

    // Guests should still see the briefs strip
    await waitFor(() => expect(screen.getByText('Eurofighter Typhoon')).toBeDefined())
  })
})
