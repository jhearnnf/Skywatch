import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Home from '../Home'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(), useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseSettings,
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('../../components/LockedCategoryModal', () => ({
  default: () => null,
}))

vi.mock('../../components/onboarding/WelcomeAgentFlow', () => ({
  default: ({ onClose }) => <div data-testid="welcome-agent-flow"><button onClick={onClose}>Close</button></div>,
  ONBOARDING_KEY: 'skywatch_onboarded',
  markOnboarded: vi.fn(),
}))

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup({ lastStreakDate = null } = {}) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', displayName: 'Agent', totalAirstars: 0, cycleAirstars: 0, lastStreakDate, loginStreak: lastStreakDate ? 1 : 0 },
    API:  '',
    apiFetch: (...args) => fetch(...args),
  })
  mockUseSettings.mockReturnValue({ settings: { freeCategories: ['News'], silverCategories: [], goldCategories: [], guestCategories: ['News'] } })
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: { counts: {}, stats: {}, briefs: [] } }) })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Home — CRO onboarding flow', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('signed-in zero-read user sees the first-mission card copy', async () => {
    setup({ lastStreakDate: null })
    render(<Home />)
    await waitFor(() => expect(screen.getByText(/Choose your first mission area/i)).toBeInTheDocument())
  })

  it('does NOT render WelcomeAgentFlow until the first-mission card is tapped', async () => {
    setup({ lastStreakDate: null })
    render(<Home />)
    await waitFor(() => expect(screen.getByText(/Choose your first mission area/i)).toBeInTheDocument())
    expect(screen.queryByTestId('welcome-agent-flow')).not.toBeInTheDocument()
  })

  it('tapping the first-mission card opens WelcomeAgentFlow', async () => {
    setup({ lastStreakDate: null })
    render(<Home />)
    const headline = await screen.findByText(/Choose your first mission area/i)
    // Click the card container (the headline sits inside it)
    fireEvent.click(headline.closest('div'))
    await waitFor(() => expect(screen.getByTestId('welcome-agent-flow')).toBeInTheDocument())
  })

  it('user who has already read a brief sees the daily mission card, not the first-mission card', async () => {
    setup({ lastStreakDate: new Date('2026-04-20').toISOString() })
    render(<Home />)
    await waitFor(() => expect(screen.getByText(/Daily mission available/i)).toBeInTheDocument())
    expect(screen.queryByText(/Choose your first mission area/i)).not.toBeInTheDocument()
  })

  it('legacy sw_pending_onboarding session flag is cleared but does not trigger the modal', async () => {
    sessionStorage.setItem('sw_pending_onboarding', '1')
    setup({ lastStreakDate: null })
    render(<Home />)
    await waitFor(() => expect(sessionStorage.getItem('sw_pending_onboarding')).toBeNull())
    // Modal stays closed until the user taps the card
    expect(screen.queryByTestId('welcome-agent-flow')).not.toBeInTheDocument()
  })
})
