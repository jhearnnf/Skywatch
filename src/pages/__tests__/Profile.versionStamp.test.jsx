import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Profile from '../Profile'

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockGetClientInfo = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../utils/sound', () => ({
  getMasterVolume: () => 50,
  setMasterVolume: vi.fn(),
  playSound: vi.fn(),
}))

vi.mock('../../utils/appVersion', () => ({ getClientInfo: mockGetClientInfo }))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), replay: vi.fn(), resetAll: vi.fn() }),
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

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    levels: [{ levelNumber: 1, cumulativeAirstars: 0, airstarsToNextLevel: 100 }],
    settings: {},
    loading: false,
  }),
}))

const BASE_USER = {
  _id: 'u1',
  email: 'a@test.com',
  agentNumber: '1234567',
  totalAirstars: 0,
  cycleAirstars: 0,
  loginStreak: 0,
  difficultySetting: 'easy',
  subscriptionTier: 'free',
  rank: { rankName: 'Airman', rankAbbreviation: 'AC' },
}

function mountWith(user) {
  mockUseAuth.mockReturnValue({
    user,
    setUser: vi.fn(),
    API: '',
    apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }),
    logout: vi.fn(),
  })
}

describe('Profile — version stamp', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows the resolved version, with full build details in the tooltip', async () => {
    mockGetClientInfo.mockResolvedValue({ platform: 'web', version: '1.2.5', build: 'a1b2c3d' })
    mountWith(BASE_USER)
    render(<Profile />)

    const stamp = await screen.findByText('v1.2.5')
    expect(stamp).toBeInTheDocument()
    expect(stamp).toHaveAttribute('title', 'web · v1.2.5 · a1b2c3d')
  })

  it('renders for logged-out visitors too', async () => {
    mockGetClientInfo.mockResolvedValue({ platform: 'web', version: '1.2.5', build: 'a1b2c3d' })
    mountWith(null)
    render(<Profile />)

    expect(await screen.findByText('v1.2.5')).toBeInTheDocument()
  })

  it('omits the build separator when the platform reports no build', async () => {
    mockGetClientInfo.mockResolvedValue({ platform: 'android', version: '1.2.5', build: null })
    mountWith(BASE_USER)
    render(<Profile />)

    const stamp = await screen.findByText('v1.2.5')
    expect(stamp).toHaveAttribute('title', 'android · v1.2.5')
  })

  it('renders nothing when the client info never resolves', async () => {
    mockGetClientInfo.mockResolvedValue(null)
    mountWith(BASE_USER)
    render(<Profile />)

    // The footer actions are present, but no version line is added.
    await waitFor(() => expect(mockGetClientInfo).toHaveBeenCalled())
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument()
  })
})
