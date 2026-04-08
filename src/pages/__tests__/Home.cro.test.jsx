import { render, screen, waitFor } from '@testing-library/react'
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
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup() {
  mockUseAuth.mockReturnValue({ user: { _id: 'u1', displayName: 'Agent', totalAircoins: 0, cycleAircoins: 0 }, API: '', apiFetch: (...args) => fetch(...args) })
  mockUseSettings.mockReturnValue({ settings: { freeCategories: ['News'], silverCategories: [], goldCategories: [], guestCategories: ['News'] } })
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: { counts: {}, stats: {}, briefs: [] } }) })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Home — CRO onboarding flow', () => {
  beforeEach(() => {
    setup()
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('renders WelcomeAgentFlow when sw_pending_onboarding is set', async () => {
    sessionStorage.setItem('sw_pending_onboarding', '1')
    render(<Home />)
    await waitFor(() => expect(screen.getByTestId('welcome-agent-flow')).toBeInTheDocument())
  })

  it('clears sw_pending_onboarding from sessionStorage after rendering', async () => {
    sessionStorage.setItem('sw_pending_onboarding', '1')
    render(<Home />)
    await waitFor(() => expect(screen.getByTestId('welcome-agent-flow')).toBeInTheDocument())
    expect(sessionStorage.getItem('sw_pending_onboarding')).toBeNull()
  })

  it('does NOT render WelcomeAgentFlow when sw_pending_onboarding is absent', async () => {
    render(<Home />)
    await waitFor(() => expect(screen.queryByTestId('welcome-agent-flow')).not.toBeInTheDocument())
  })
})
