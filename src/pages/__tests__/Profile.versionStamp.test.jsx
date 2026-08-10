import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Profile from '../Profile'

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockGetClientInfo = vi.hoisted(() => vi.fn())
const mockForceUpdate   = vi.hoisted(() => vi.fn())

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

// isNativeUpdateAvailable is left real — it is a pure comparison and the point
// of these tests is that Profile feeds it the right two values. Only the
// side-effecting refresh is stubbed, since it ends by replacing the document.
vi.mock('../../utils/appUpdate', async (importOriginal) => ({
  ...(await importOriginal()),
  forceUpdateWebApp: mockForceUpdate,
}))

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

// `latest` is what GET /api/users/latest-release answers; every other call the
// page makes gets an empty payload. Routing by URL rather than by call order
// keeps these tests from breaking when Profile adds an unrelated fetch.
function mountWith(user, { latest = null } = {}) {
  const apiFetch = vi.fn((url) => Promise.resolve({
    ok: true,
    json: async () => (String(url).includes('/latest-release') ? { data: { latest } } : { data: {} }),
  }))
  mockUseAuth.mockReturnValue({ user, setUser: vi.fn(), API: '', apiFetch, logout: vi.fn() })
  return apiFetch
}

describe('Profile — version stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockForceUpdate.mockResolvedValue(undefined)
  })

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

describe('Profile — update control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockForceUpdate.mockResolvedValue(undefined)
  })

  const WEB     = { platform: 'web',     version: '1.2.23', build: 'a1b2c3d' }
  const ANDROID = { platform: 'android', version: '1.2.20', build: '25' }

  it('offers the force-refresh on web', async () => {
    mockGetClientInfo.mockResolvedValue(WEB)
    mountWith(BASE_USER)
    render(<Profile />)

    const btn = await screen.findByRole('button', { name: /get the latest version/i })
    await userEvent.click(btn)

    expect(mockForceUpdate).toHaveBeenCalled()
    // Busy state, so a second press cannot start a second teardown.
    expect(await screen.findByRole('button', { name: /getting latest version/i })).toBeDisabled()
  })

  it('never asks the server for a native release on web', async () => {
    // A commit sha cannot be compared to anything, so the request would be
    // wasted on every profile visit.
    mockGetClientInfo.mockResolvedValue(WEB)
    const apiFetch = mountWith(BASE_USER)
    render(<Profile />)

    await screen.findByText('v1.2.23')
    expect(apiFetch.mock.calls.some(([url]) => String(url).includes('/latest-release'))).toBe(false)
  })

  it('links to Google Play when the store has a newer Android build', async () => {
    mockGetClientInfo.mockResolvedValue(ANDROID)
    mountWith(BASE_USER, { latest: { android: { version: '1.2.23', build: '28' }, ios: null } })
    render(<Profile />)

    const link = await screen.findByRole('link', { name: /update app/i })
    expect(link).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=academy.skywatch.app')
    // The web escape hatch would do nothing in a packaged app — there is no
    // service worker there — so it must not appear.
    expect(screen.queryByRole('button', { name: /get the latest version/i })).not.toBeInTheDocument()
  })

  it('stays quiet when the Android build is already the newest', async () => {
    mockGetClientInfo.mockResolvedValue({ ...ANDROID, build: '28' })
    mountWith(BASE_USER, { latest: { android: { version: '1.2.23', build: '28' }, ios: null } })
    render(<Profile />)

    await screen.findByText('v1.2.20')
    await waitFor(() => expect(screen.queryByRole('link', { name: /update app/i })).not.toBeInTheDocument())
  })

  it('stays quiet when the release lookup fails', async () => {
    // Offline, or the endpoint is down. Better to say nothing than to guess.
    mockGetClientInfo.mockResolvedValue(ANDROID)
    mockUseAuth.mockReturnValue({
      user: BASE_USER,
      setUser: vi.fn(),
      API: '',
      apiFetch: vi.fn().mockRejectedValue(new Error('offline')),
      logout: vi.fn(),
    })
    render(<Profile />)

    await screen.findByText('v1.2.20')
    expect(screen.queryByRole('link', { name: /update app/i })).not.toBeInTheDocument()
  })
})
