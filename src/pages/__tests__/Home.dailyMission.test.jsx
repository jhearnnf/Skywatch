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

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, onClick }) => <div className={className} style={style} onClick={onClick}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
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

  it('renders Jump Back In above Daily Mission when both are present', async () => {
    global.fetch = makeFetch({
      inProgress: { briefId: 'in-prog', title: 'Resume Me', category: 'News', currentSection: 2 },
      nextPathway: { briefId: 'next-id', category: 'News' },
    })
    render(<Home />)

    const jumpLabel = await screen.findByText('Jump Back In')
    const missionLabel = await screen.findByText('Daily mission available')

    // Compare document order — Jump Back In must come first in the DOM
    const pos = jumpLabel.compareDocumentPosition(missionLabel)
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
