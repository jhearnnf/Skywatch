import { render, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import LockedCategoryModal from '../../components/LockedCategoryModal'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockSetUser     = vi.hoisted(() => vi.fn())
const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseSettings,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: mockUseSettings,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, style, onClick }) => <div className={className} style={style} onClick={onClick}>{children}</div>,
    button: ({ children, className, onClick })        => <button className={className} onClick={onClick}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

let googleCallback = null

function setupGoogleMock() {
  googleCallback = null
  window.google = {
    accounts: {
      id: {
        initialize:   vi.fn(({ callback }) => { googleCallback = callback }),
        renderButton: vi.fn(),
      },
    },
  }
  // Provide a fake client ID so the useEffect runs
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'fake-client-id')
}

function setupAuth() {
  mockUseAuth.mockReturnValue({ setUser: mockSetUser, API: '', apiFetch: (...args) => fetch(...args) })
  mockUseSettings.mockReturnValue({ settings: { freeCategories: ['News'] } })
}

function makeGoogleAuthResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({ data: { user: { _id: 'u1', email: 'g@b.com' }, ...overrides } }),
  }
}

function makeCompleteResponse() {
  return {
    ok: true,
    json: async () => ({
      data: {
        aircoinsEarned:   5,
        dailyCoinsEarned: 5,
        loginStreak:      1,
        newTotalAircoins: 10,
        newCycleAircoins: 10,
        rankPromotion:    null,
      },
    }),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LockedCategoryModal — Google sign-in awards pending brief coins', () => {
  beforeEach(() => {
    setupAuth()
    setupGoogleMock()
    mockNavigate.mockClear()
    mockSetUser.mockClear()
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    delete window.google
  })

  it('calls /complete and navigates to brief when sw_pending_brief is set', async () => {
    localStorage.setItem('sw_pending_brief', 'brief42')

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGoogleAuthResponse()) // /api/auth/google
      .mockResolvedValueOnce(makeCompleteResponse())   // /api/briefs/brief42/complete

    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={vi.fn()} />)

    // Simulate Google GIS firing the callback
    await googleCallback?.({ credential: 'fake-token' })

    await waitFor(() => {
      const completeCalled = global.fetch.mock.calls.some(([url]) => url.includes('/complete'))
      expect(completeCalled).toBe(true)
    })
    expect(mockNavigate).toHaveBeenCalledWith('/brief/brief42')
    expect(sessionStorage.getItem('sw_brief_coins')).not.toBeNull()
    expect(sessionStorage.getItem('sw_brief_just_completed')).toBe('brief42')
  })

  it('does NOT call /complete and does NOT navigate when no pending brief', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGoogleAuthResponse())

    const onClose = vi.fn()
    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={onClose} />)

    await googleCallback?.({ credential: 'fake-token' })

    await waitFor(() => expect(mockSetUser).toHaveBeenCalled())
    const completeCalled = global.fetch.mock.calls.some(([url]) => url.includes('/complete'))
    expect(completeCalled).toBe(false)
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/brief/'))
  })

  it('clears sw_pending_brief from localStorage after consuming it', async () => {
    localStorage.setItem('sw_pending_brief', 'brief42')

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGoogleAuthResponse())
      .mockResolvedValueOnce(makeCompleteResponse())

    render(<LockedCategoryModal category="Aircrafts" tier="silver" user={null} onClose={vi.fn()} />)

    await googleCallback?.({ credential: 'fake-token' })

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/brief/brief42'))
    expect(localStorage.getItem('sw_pending_brief')).toBeNull()
  })
})
