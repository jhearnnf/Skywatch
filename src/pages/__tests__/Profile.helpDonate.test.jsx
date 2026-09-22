import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Profile from '../Profile'

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())
const mockSlimApp  = vi.hoisted(() => ({ value: false }))

// ── Mocks ────────────────────────────────────────────────────────────────────

// The Help tab's donation link is gated on the NATIVE build (SLIM_APP), not on
// slim mode: the website in slim mode still shows it, the Play Store app never
// does. Hold useSlimMode at false throughout so the two gates stay separable.
vi.mock('../../utils/appMode', () => ({
  get SLIM_APP() { return mockSlimApp.value },
}))
vi.mock('../../hooks/useSlimMode', () => ({ useSlimMode: () => false }))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to, ...rest }) => <a href={to} data-testid={rest['data-testid']}>{children}</a>,
}))

vi.mock('../../utils/sound', () => ({
  getMasterVolume: () => 1,
  setMasterVolume: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), replay: vi.fn(), resetAll: vi.fn() }),
}))

vi.mock('../../utils/subscription', () => ({
  displayTier: () => 'Free',
  isFreeUser: () => true,
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

vi.mock('../../data/mockData', () => ({ MOCK_LEADERBOARD: [] }))

const TEST_LEVELS = [
  { levelNumber: 1, cumulativeAirstars: 0,   airstarsToNextLevel: 100 },
  { levelNumber: 2, cumulativeAirstars: 100, airstarsToNextLevel: 150 },
]

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ levels: TEST_LEVELS, settings: {}, loading: false }),
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_USER = {
  _id: 'user1', email: 'agent@test.com', displayName: 'Agent Test',
  agentNumber: '1234567', totalAirstars: 1000, cycleAirstars: 250,
  loginStreak: 7, difficultySetting: 'easy',
  rank: { rankName: 'Corporal', rankAbbreviation: 'Cpl', rankNumber: 3 }, tutorials: {},
}

function setupAuth() {
  mockUseAuth.mockReturnValue({
    user: { ...BASE_USER },
    setUser: vi.fn(), API: '',
    apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }),
    logout: vi.fn(),
  })
}

// Share and Support sit at the foot of the Overview tab (the default), next
// to the social icons. Help holds Report a Problem and the tutorials only.
async function openOverview() {
  render(<Profile />)
  await waitFor(() => screen.getByText('📤 Share SkyWatch'))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Profile — Overview "Support SkyWatch" link', () => {
  beforeEach(() => {
    setupAuth()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    mockNavigate.mockClear()
    mockSlimApp.value = false
  })
  afterEach(() => vi.restoreAllMocks())

  it('links to /donate on the web, next to Share', async () => {
    await openOverview()
    const link = screen.getByTestId('profile-help-donate')
    expect(link.getAttribute('href')).toBe('/donate')
    expect(link.textContent).toContain('Support SkyWatch')

    const labels = [...link.parentElement.querySelectorAll('a')].map(a => a.textContent)
    expect(labels).toEqual(['📤 Share SkyWatch', '💙 Support SkyWatch'])
  })

  it('is absent in the native app', async () => {
    mockSlimApp.value = true
    await openOverview()
    expect(screen.queryByTestId('profile-help-donate')).toBeNull()
    expect(screen.queryByText(/Support SkyWatch/)).toBeNull()
    // The neighbouring link is unaffected.
    expect(screen.getByText('📤 Share SkyWatch')).toBeDefined()
  })

  it('keeps Report a Problem on the Help tab, without Share or Support', async () => {
    await openOverview()
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    await waitFor(() => screen.getByText('⚠️ Report a Problem'))
    expect(screen.queryByText('📤 Share SkyWatch')).toBeNull()
    expect(screen.queryByTestId('profile-help-donate')).toBeNull()
  })
})
