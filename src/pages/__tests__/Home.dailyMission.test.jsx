import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Home from '../Home'
import { lastSeenStreakKey } from '../../utils/storageKeys'

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

function makeFetch({ inProgress, nextPathway }) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/random-in-progress')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: inProgress }) })
    }
    if (url.includes('/api/briefs/next-pathway-brief')) {
      return Promise.resolve({ ok: nextPathway !== null, json: async () => nextPathway === null
        ? { status: 'error', message: 'No briefs available.' }
        : { status: 'success', data: nextPathway } })
    }
    if (url.includes('/api/briefs')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { briefs: [] } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('Home — Daily Mission card', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: LOGGED_IN_USER, API: '', apiFetch: (...args) => fetch(...args) })
    mockUseSettings.mockReturnValue({ settings: SETTINGS })
    mockNavigate.mockReset()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('navigates to the brief returned by /api/briefs/next-pathway-brief', async () => {
    global.fetch = makeFetch({ inProgress: null, nextPathway: { briefId: 'next-brief-id', category: 'News' } })
    render(<Home />)

    const card = await screen.findByText('Daily mission available')
    fireEvent.click(card.closest('div'))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/briefs/next-pathway-brief'), expect.any(Object))
      expect(mockNavigate).toHaveBeenCalledWith('/brief/next-brief-id')
    })
  })

  it('falls back to /learn-priority when the endpoint returns 404', async () => {
    global.fetch = makeFetch({ inProgress: null, nextPathway: null })
    render(<Home />)

    const card = await screen.findByText('Daily mission available')
    fireEvent.click(card.closest('div'))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/learn-priority')
    })
  })

  it('renders Daily Mission above the Resume Quick Action when both are present', async () => {
    global.fetch = makeFetch({
      inProgress: { briefId: 'in-prog', title: 'Resume Me', category: 'News', currentSection: 2 },
      nextPathway: { briefId: 'next-id', category: 'News' },
    })
    render(<Home />)

    const missionLabel = await screen.findByText('Daily mission available')
    const resumeLabel = await screen.findByText('Resume Me')

    // Compare document order — Daily Mission must come first in the DOM,
    // with the Resume button now grouped under Quick Actions below it.
    const pos = missionLabel.compareDocumentPosition(resumeLabel)
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('Home — Streak-bump drawer animation', () => {
  const completedUser = {
    _id: 'u1',
    displayName: 'Agent Test',
    subscriptionTier: 'gold',
    cycleAirstars: 0,
    loginStreak: 4,
    lastStreakDate: new Date().toISOString(),  // today — missionDone === true
  }

  const LEVELS = [
    { levelNumber: 1, cumulativeAirstars: 0,   airstarsToNextLevel: 100 },
    { levelNumber: 2, cumulativeAirstars: 100, airstarsToNextLevel: 150 },
  ]

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()
    mockUseAuth.mockReturnValue({ user: completedUser, API: '', apiFetch: (...args) => fetch(...args) })
    mockUseSettings.mockReturnValue({ settings: SETTINGS, levels: LEVELS })
    mockNavigate.mockReset()
    global.fetch = makeFetch({ inProgress: null, nextPathway: null })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('shows "Mission complete!" then retracts, ticks streak up, and persists lastSeen', async () => {
    // User has stored lastSeen=3; real streak is 4 (just bumped).
    localStorage.setItem(lastSeenStreakKey('u1'), '3')
    render(<Home />)

    // Complete card visible, streak shows old value (3) until card retracts.
    expect(await screen.findByText('Mission complete!')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    // Advance past present+exit windows (2000 + 520 = 2520ms).
    await act(async () => { await vi.advanceTimersByTimeAsync(2700) })

    // Card is gone; streak ticked up; localStorage persisted.
    expect(screen.queryByText('Mission complete!')).not.toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(localStorage.getItem(lastSeenStreakKey('u1'))).toBe('4')
  })

  it('starts in hidden state when lastSeen already matches current streak', async () => {
    localStorage.setItem(lastSeenStreakKey('u1'), '4')
    render(<Home />)

    // Drawer should never appear; streak displays current value immediately.
    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument())
    expect(screen.queryByText('Mission complete!')).not.toBeInTheDocument()
    expect(screen.queryByText('Daily mission available')).not.toBeInTheDocument()
  })

  it('animates once on first visit (no stored key) then hides on subsequent renders', async () => {
    // No localStorage entry — assume lastSeen = currentStreak - 1, so animate.
    render(<Home />)

    expect(await screen.findByText('Mission complete!')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(2700) })
    expect(screen.queryByText('Mission complete!')).not.toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(localStorage.getItem(lastSeenStreakKey('u1'))).toBe('4')
  })

  it('fires the animation on the first brief after a progress reset', async () => {
    // Stored lastSeen is ahead of the current streak — the user's progress
    // was reset server-side but localStorage still reflects the old high.
    localStorage.setItem(lastSeenStreakKey('u1'), '7')
    // completedUser has loginStreak: 4 (new post-reset + one completion).
    render(<Home />)

    // Animation should still fire; completion treated as a fresh bump (0 → 1
    // conceptually, since the resync sets lastSeen to currentStreak - 1 = 3).
    expect(await screen.findByText('Mission complete!')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(2700) })
    expect(screen.queryByText('Mission complete!')).not.toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(localStorage.getItem(lastSeenStreakKey('u1'))).toBe('4')
  })

  it('waits for the notification queue to drain before starting the retract', async () => {
    localStorage.setItem(lastSeenStreakKey('u1'), '3')
    // One notification is pending — retract should not fire until the queue is empty.
    mockUseAuth.mockReturnValue({
      user: completedUser,
      API: '',
      apiFetch: (...args) => fetch(...args),
      notifQueue: [{ id: 'n1', type: 'airstar', amount: 10 }],
    })

    const { rerender } = render(<Home />)

    expect(await screen.findByText('Mission complete!')).toBeInTheDocument()

    // Advance well past the normal retract window — card should still be visible
    // because the notification queue is not empty.
    await act(async () => { await vi.advanceTimersByTimeAsync(3500) })
    expect(screen.getByText('Mission complete!')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    // Drain the queue and re-render; retract should now fire.
    mockUseAuth.mockReturnValue({
      user: completedUser,
      API: '',
      apiFetch: (...args) => fetch(...args),
      notifQueue: [],
    })
    rerender(<Home />)

    await act(async () => { await vi.advanceTimersByTimeAsync(2700) })
    expect(screen.queryByText('Mission complete!')).not.toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})
