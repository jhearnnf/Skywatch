import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The two rules this file exists to pin down:
//   1. Chat is a permanent nav entry for signed-in users — it no longer waits
//      for an open support conversation to exist.
//   2. It is hidden inside the native app, and that gate is NATIVE_APP, not
//      slim mode. Slim mode keeps chat.
const mockNative      = vi.hoisted(() => ({ value: false }))
const mockSlim        = vi.hoisted(() => ({ value: false }))
const mockChat        = vi.hoisted(() => ({ hasUnread: false }))
const mockChatEnabled = vi.hoisted(() => ({ value: true }))
const mockUseAuth     = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
  Link: ({ children, className, to, onClick, ...rest }) => (
    <a href={to} className={className} onClick={onClick} {...rest}>{children}</a>
  ),
}))

vi.mock('../../../utils/appMode', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    get NATIVE_APP() { return mockNative.value },
  }
})

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../../context/NewGameUnlockContext', () => ({ useNewGameUnlock: () => ({ hasAnyNew: false }) }))
vi.mock('../../../context/NewCategoryUnlockContext', () => ({ useNewCategoryUnlock: () => ({ hasAnyNew: false, firstNewCategory: null }) }))
vi.mock('../../../context/UnsolvedReportsContext', () => ({ useUnsolvedReports: () => ({ unsolvedCount: 0 }) }))
vi.mock('../../../context/ChatUnreadContext', () => ({ useChatUnread: () => mockChat }))
vi.mock('../../../hooks/useSlimMode', () => ({ useSlimMode: () => mockSlim.value }))
vi.mock('../../world3d/state/useWorld3dEnabled', () => ({ useWorld3dNavVisible: () => false }))
vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    levels: [{ levelNumber: 1, cumulativeAirstars: 0, airstarsToNextLevel: 100 }],
    settings: { slimModeEnabled: mockSlim.value, chatEnabled: mockChatEnabled.value },
  }),
}))

import Sidebar from '../Sidebar'
import { clearChatCache, syncChatCacheOwner, getCachedOverview } from '../../../utils/chatCache'

const chatLink = () => document.querySelector('[data-nav="chat"]')
const navLabels = () =>
  [...document.querySelectorAll('nav a')].map(a => a.textContent.replace(/[^\w ]/g, '').trim())

function setupUser(overrides = {}, apiFetch = vi.fn()) {
  mockUseAuth.mockReturnValue({
    user: {
      _id: 'u1',
      displayName: 'Agent',
      cycleAirstars: 0,
      totalAirstars: 0,
      rank: { rankNumber: 1, rankAbbreviation: 'AC' },
      ...overrides,
    },
    logout: vi.fn(),
    API: '',
    apiFetch,
  })
}

describe('Sidebar — chat nav entry', () => {
  beforeEach(() => {
    mockNative.value = false
    mockSlim.value = false
    mockChatEnabled.value = true
    mockChat.hasUnread = false
    mockUseAuth.mockReset()
    syncChatCacheOwner(null)
    clearChatCache()
  })

  it('shows chat with no open conversation', () => {
    setupUser()
    render(<Sidebar />)
    expect(chatLink()).not.toBeNull()
  })

  it('places Community directly above Profile', () => {
    setupUser()
    render(<Sidebar />)
    // textContent includes the leading emoji — strip to the word label.
    const labels = navLabels()
    expect(labels.indexOf('Community')).toBe(labels.indexOf('Profile') - 1)
  })

  it('places Community above Profile in slim mode too', () => {
    mockSlim.value = true
    setupUser()
    render(<Sidebar />)
    // textContent includes the leading emoji — strip to the word label.
    const labels = navLabels()
    expect(labels).toEqual(['CBAT', 'Community', 'Profile'])
  })

  it('shows chat in slim (CBAT-only) mode', () => {
    mockSlim.value = true
    setupUser()
    render(<Sidebar />)
    expect(chatLink()).not.toBeNull()
  })

  it('hides chat inside the native app', () => {
    // The store-policy gate. Slim mode is deliberately left off here to prove
    // the two are independent.
    mockNative.value = true
    setupUser()
    render(<Sidebar />)
    expect(chatLink()).toBeNull()
  })

  it('hides chat when the feature flag is off', () => {
    mockChatEnabled.value = false
    setupUser()
    render(<Sidebar />)
    expect(chatLink()).toBeNull()
  })

  it('hides chat for signed-out visitors', () => {
    mockUseAuth.mockReturnValue({ user: null, logout: vi.fn() })
    render(<Sidebar />)
    expect(chatLink()).toBeNull()
  })

  // Community's rail cannot start loading until you navigate, which is most of
  // why it felt slow. Hovering the entry is a good enough signal of intent to
  // start it early — and a bad enough one to spend a request on every visitor,
  // hence "on intent" rather than "on app boot".
  describe('prefetch on intent', () => {
    const okOverview = () => vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: { channels: [{ _id: 'c1' }] } }),
    })

    it('warms the rail when the pointer reaches Community', async () => {
      const apiFetch = okOverview()
      setupUser({}, apiFetch)
      render(<Sidebar />)

      expect(apiFetch).not.toHaveBeenCalled()
      fireEvent.mouseEnter(chatLink())

      expect(apiFetch.mock.calls[0][0]).toMatch(/\/api\/chat\/overview$/)
      await vi.waitFor(() => expect(getCachedOverview()).toBeTruthy())
    })

    it('does not warm it from any other nav entry', () => {
      const apiFetch = okOverview()
      setupUser({}, apiFetch)
      render(<Sidebar />)

      fireEvent.mouseEnter(screen.getByText('Home'))
      fireEvent.mouseEnter(screen.getByText('Play'))
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('fires once as the pointer crosses back and forth', () => {
      const apiFetch = okOverview()
      setupUser({}, apiFetch)
      render(<Sidebar />)

      fireEvent.mouseEnter(chatLink())
      fireEvent.mouseEnter(chatLink())
      fireEvent.focus(chatLink())
      expect(apiFetch).toHaveBeenCalledTimes(1)
    })
  })

  it('shows the unread dot only when there is unread traffic', () => {
    setupUser()
    const { unmount } = render(<Sidebar />)
    expect(screen.queryByLabelText('New message')).toBeNull()
    unmount()

    mockChat.hasUnread = true
    setupUser()
    render(<Sidebar />)
    expect(screen.getByLabelText('New message')).toBeTruthy()
  })
})
