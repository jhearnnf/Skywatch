import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Home from '../Home'

const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())
const mockNavigate    = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
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
vi.mock('../../components/FlashcardGameModal', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, onClick }) => <div className={className} style={style} onClick={onClick}>{children}</div>,
    svg:    ({ children, className, style }) => <svg className={className} style={style}>{children}</svg>,
    h2:     ({ children, className, style }) => <h2 className={className} style={style}>{children}</h2>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => false,
  useScroll:        () => ({ scrollY: 0 }),
  useTransform:     () => 0,
}))

const SETTINGS = { guestCategories: ['News'], freeCategories: ['News'], silverCategories: ['News'] }

const LOGGED_IN_USER = {
  _id: 'u1',
  displayName: 'Agent Test',
  subscriptionTier: 'gold',
  cycleAirstars: 0,
  loginStreak: 0,
  lastStreakDate: null,
}

function makeFetch({ availableCount, nextPathway }) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/games/flashcard-recall/available-briefs')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { count: availableCount } }) })
    }
    if (url.includes('/api/briefs/next-pathway-brief')) {
      return Promise.resolve({
        ok: nextPathway !== null,
        json: async () => nextPathway === null
          ? { status: 'error', message: 'No briefs available.' }
          : { status: 'success', data: nextPathway },
      })
    }
    if (url.includes('/api/briefs/random-in-progress')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: null }) })
    }
    if (url.includes('/api/briefs')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { briefs: [] } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('Home — Flashcard Round locked card', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: LOGGED_IN_USER, API: '', apiFetch: (...args) => fetch(...args) })
    mockUseSettings.mockReturnValue({ settings: SETTINGS })
    mockNavigate.mockReset()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders "Read →" CTA and "Complete N more briefs" subtitle when locked', async () => {
    global.fetch = makeFetch({ availableCount: 2, nextPathway: { briefId: 'next-id', category: 'News' } })
    render(<Home />)

    // Subtitle tells the user why it's locked
    await waitFor(() => expect(screen.getByText('Complete 3 more briefs to unlock')).toBeDefined())
    // Forward-path CTA replaces the old "Locked" dead-end chip
    expect(screen.getByText('Read →')).toBeDefined()
    expect(screen.queryByText('Locked')).toBeNull()
  })

  it('uses singular "brief" when exactly one more is needed', async () => {
    global.fetch = makeFetch({ availableCount: 4, nextPathway: { briefId: 'next-id', category: 'News' } })
    render(<Home />)
    await waitFor(() => expect(screen.getByText('Complete 1 more brief to unlock')).toBeDefined())
  })

  it('clicking the locked card navigates to the brief returned by /next-pathway-brief', async () => {
    global.fetch = makeFetch({ availableCount: 0, nextPathway: { briefId: 'next-brief-id', category: 'News' } })
    render(<Home />)

    const btn = await screen.findByTestId('home-flashcard-btn')
    fireEvent.click(btn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/briefs/next-pathway-brief'), expect.any(Object))
      expect(mockNavigate).toHaveBeenCalledWith('/brief/next-brief-id')
    })
  })

  it('falls back to /learn-priority when the endpoint has no brief to return', async () => {
    global.fetch = makeFetch({ availableCount: 0, nextPathway: null })
    render(<Home />)

    const btn = await screen.findByTestId('home-flashcard-btn')
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/learn-priority')
    })
  })

  it('renders "Play →" when unlocked (>=5 completed briefs)', async () => {
    global.fetch = makeFetch({ availableCount: 5, nextPathway: null })
    render(<Home />)

    await waitFor(() => expect(screen.getByText('Play →')).toBeDefined())
    expect(screen.queryByText('Read →')).toBeNull()
    expect(screen.queryByText(/to unlock/)).toBeNull()
  })
})
