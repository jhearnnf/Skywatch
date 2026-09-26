import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Profile from '../Profile'

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockGetClientInfo = vi.hoisted(() => vi.fn())
const mockForceUpdate   = vi.hoisted(() => vi.fn())
const mockFetchLiveWeb  = vi.hoisted(() => vi.fn())
const mockLocation      = vi.hoisted(() => ({ search: '' }))
// The admin "update screen for all users" switch; the cover tests turn it on.
const mockSettings      = vi.hoisted(() => ({ current: {} }))
const mockRefreshSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/profile', search: mockLocation.search, hash: '' }),
  Link: ({ children, to, onClick, className }) => <a href={to} onClick={onClick} className={className}>{children}</a>,
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
  fetchLiveWebVersion: mockFetchLiveWeb,
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
    settings: mockSettings.current,
    refreshSettings: mockRefreshSettings,
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
    mockFetchLiveWeb.mockResolvedValue(null)
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
    mockLocation.search = ''
    mockSettings.current = { updateCoverEnabled: true }
    sessionStorage.clear()
    mockForceUpdate.mockResolvedValue(undefined)
    mockFetchLiveWeb.mockResolvedValue(null)
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

  it('covers the profile with the web refresh when a newer deploy is live', async () => {
    mockGetClientInfo.mockResolvedValue(WEB)
    mockFetchLiveWeb.mockResolvedValue({ version: '1.2.23', build: 'fffffff' })
    mountWith(BASE_USER)
    render(<Profile />)

    expect(await screen.findByRole('heading', { name: /update available/i })).toBeInTheDocument()
    // Same version number, so the builds tell the two deploys apart.
    expect(screen.getByText(/your version: v1\.2\.23 \(a1b2c3d\)/i)).toBeInTheDocument()
    expect(screen.getByText(/latest: v1\.2\.23 \(fffffff\)/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /update app/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/admin preview/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /get the latest version/i }))
    expect(mockForceUpdate).toHaveBeenCalled()
  })

  it('stays quiet on web when the running bundle is the live deploy', async () => {
    mockGetClientInfo.mockResolvedValue(WEB)
    mockFetchLiveWeb.mockResolvedValue({ version: '1.2.23', build: 'a1b2c3d' })
    mountWith(BASE_USER)
    render(<Profile />)

    await screen.findByText('v1.2.23')
    await waitFor(() => expect(mockFetchLiveWeb).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: /update available/i })).not.toBeInTheDocument()
  })

  it('"Not now" on web leaves the refresh button in the footer', async () => {
    mockGetClientInfo.mockResolvedValue(WEB)
    mockFetchLiveWeb.mockResolvedValue({ version: '1.2.23', build: 'fffffff' })
    mountWith(BASE_USER)
    render(<Profile />)

    await userEvent.click(await screen.findByRole('button', { name: /not now/i }))
    expect(screen.getByText('v1.2.23')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /get the latest version/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /update app/i })).not.toBeInTheDocument()
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

  it('covers the whole profile with a Google Play link when the store has a newer Android build', async () => {
    mockGetClientInfo.mockResolvedValue(ANDROID)
    mountWith(BASE_USER, { latest: { android: { version: '1.2.23', build: '28' }, ios: null } })
    render(<Profile />)

    const link = await screen.findByRole('link', { name: /update app/i })
    expect(link).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=academy.skywatch.app')
    expect(screen.getByRole('heading', { name: /update available/i })).toBeInTheDocument()
    expect(screen.getByText(/your version: v1\.2\.20/i)).toBeInTheDocument()
    expect(screen.getByText(/latest: v1\.2\.23/i)).toBeInTheDocument()
    // The profile itself is gone, not merely overlaid: no tabs, no footer stamp.
    expect(screen.queryByText('v1.2.20')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /overview/i })).not.toBeInTheDocument()
    // A real outdated build is not a preview.
    expect(screen.queryByText(/admin preview/i)).not.toBeInTheDocument()
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

  it('previews the web cover with ?previewUpdate=web', async () => {
    mockLocation.search = '?previewUpdate=web'
    mockGetClientInfo.mockResolvedValue(WEB)
    mountWith({ ...BASE_USER, isAdmin: true })
    render(<Profile />)

    expect(await screen.findByRole('heading', { name: /update available/i })).toBeInTheDocument()
    expect(screen.getByText(/admin preview/i)).toBeInTheDocument()

    // On web the cover refreshes the web app; it never points at Google Play.
    expect(screen.queryByRole('link', { name: /update app/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /get the latest version/i }))
    expect(mockForceUpdate).toHaveBeenCalled()

    // In the preview, "Not now" just leaves the preview.
    await userEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/profile')
  })

  it('previews the Android cover with ?previewUpdate=android, even on web', async () => {
    mockLocation.search = '?previewUpdate=android'
    mockGetClientInfo.mockResolvedValue(WEB)
    mountWith({ ...BASE_USER, isAdmin: true })
    render(<Profile />)

    expect(await screen.findByRole('link', { name: /update app/i }))
      .toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=academy.skywatch.app')
    expect(screen.getByText(/admin preview of the android version/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /get the latest version/i })).not.toBeInTheDocument()
    // This device's web version is the wrong kind of number for an Android cover.
    expect(screen.queryByText(/your version/i)).not.toBeInTheDocument()
  })

  it('"Not now" reveals the profile, with the Play link kept in the footer', async () => {
    mockGetClientInfo.mockResolvedValue(ANDROID)
    mountWith(BASE_USER, { latest: { android: { version: '1.2.23', build: '28' }, ios: null } })
    render(<Profile />)

    await userEvent.click(await screen.findByRole('button', { name: /not now/i }))

    expect(screen.queryByRole('heading', { name: /update available/i })).not.toBeInTheDocument()
    expect(screen.getByText('v1.2.20')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /update app/i }))
      .toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=academy.skywatch.app')
  })

  it('remembers "Not now" for the session, until a newer release appears', async () => {
    mockGetClientInfo.mockResolvedValue(ANDROID)
    sessionStorage.setItem('skywatch:updateCoverDismissed', '28')

    mountWith(BASE_USER, { latest: { android: { version: '1.2.23', build: '28' }, ios: null } })
    const { unmount } = render(<Profile />)
    await screen.findByText('v1.2.20')
    await screen.findByRole('link', { name: /update app/i })
    expect(screen.queryByRole('heading', { name: /update available/i })).not.toBeInTheDocument()
    unmount()

    // Build 29 was never dismissed, so the cover comes back.
    mountWith(BASE_USER, { latest: { android: { version: '1.2.24', build: '29' }, ios: null } })
    render(<Profile />)
    expect(await screen.findByRole('heading', { name: /update available/i })).toBeInTheDocument()
  })

  it('gives admins a link to the preview, and nobody else', async () => {
    mockGetClientInfo.mockResolvedValue(WEB)
    mountWith({ ...BASE_USER, isAdmin: true })
    const { unmount } = render(<Profile />)

    expect(await screen.findByRole('link', { name: /preview update for web/i }))
      .toHaveAttribute('href', '/profile?previewUpdate=web')
    expect(screen.getByRole('link', { name: /preview update for android/i }))
      .toHaveAttribute('href', '/profile?previewUpdate=android')
    unmount()

    mountWith(BASE_USER)
    render(<Profile />)
    await screen.findByText('v1.2.23')
    expect(screen.queryByRole('link', { name: /preview update for/i })).not.toBeInTheDocument()
  })

  it('ignores ?previewUpdate for non-admins', async () => {
    mockLocation.search = '?previewUpdate=web'
    mockGetClientInfo.mockResolvedValue(WEB)
    mountWith(BASE_USER)
    render(<Profile />)

    await screen.findByText('v1.2.23')
    expect(screen.queryByRole('heading', { name: /update available/i })).not.toBeInTheDocument()
  })

  it('shows no cover while the admin switch is off, just the footer link', async () => {
    mockSettings.current = { updateCoverEnabled: false }
    mockGetClientInfo.mockResolvedValue(ANDROID)
    mountWith(BASE_USER, { latest: { android: { version: '1.2.23', build: '28' }, ios: null } })
    render(<Profile />)

    await screen.findByRole('link', { name: /update app/i })
    expect(screen.getByText('v1.2.20')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /update available/i })).not.toBeInTheDocument()
  })

  it('does not preview while the switch is off, and pulses the switch instead', async () => {
    mockSettings.current = { updateCoverEnabled: false }
    mockLocation.search = '?previewUpdate=web'
    mockGetClientInfo.mockResolvedValue(WEB)
    mountWith({ ...BASE_USER, isAdmin: true })
    render(<Profile />)

    const link = await screen.findByRole('link', { name: /preview update for android/i })
    expect(screen.queryByRole('heading', { name: /update available/i })).not.toBeInTheDocument()

    const toggle = screen.getByRole('switch', { name: /show update screen to all users/i })
    await userEvent.click(link)
    await waitFor(() => expect(toggle.className).toMatch(/flashcard-ring-active/))
    expect(screen.queryByRole('heading', { name: /update available/i })).not.toBeInTheDocument()
  })

  it('lets an admin flip the switch for everyone', async () => {
    mockSettings.current = { updateCoverEnabled: false }
    mockGetClientInfo.mockResolvedValue(WEB)
    const apiFetch = mountWith({ ...BASE_USER, isAdmin: true })
    render(<Profile />)

    const toggle = await screen.findByRole('switch', { name: /show update screen to all users/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(toggle)

    const call = apiFetch.mock.calls.find(([url]) => String(url).includes('/api/admin/settings'))
    expect(call[1].method).toBe('PATCH')
    expect(JSON.parse(call[1].body)).toMatchObject({ updateCoverEnabled: true, reason: expect.any(String) })
    await waitFor(() => expect(mockRefreshSettings).toHaveBeenCalled())
  })

  it('hides the switch from non-admins', async () => {
    mockGetClientInfo.mockResolvedValue(WEB)
    mountWith(BASE_USER)
    render(<Profile />)

    await screen.findByText('v1.2.23')
    expect(screen.queryByRole('switch', { name: /show update screen/i })).not.toBeInTheDocument()
  })

  it('keeps the admin tools in the floating panel, including over the update cover', async () => {
    mockLocation.search = '?previewUpdate=web'
    mockGetClientInfo.mockResolvedValue(WEB)
    mountWith({ ...BASE_USER, isAdmin: true })
    render(<Profile />)

    await screen.findByRole('heading', { name: /update available/i })
    const panel = screen.getByRole('region', { name: /admin tools: profile/i })
    expect(within(panel).getByRole('switch', { name: /show update screen to all users/i })).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /preview update for web/i })).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /preview update for android/i })).toBeInTheDocument()
  })
})
