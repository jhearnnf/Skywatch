import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import LoginPage from '../Login'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockSetUser  = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())
const mockCalls    = vi.hoisted(() => [])
const mockInit     = vi.hoisted(() => vi.fn())
const mockSignIn   = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ search: '' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
  storeNativeToken: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// Native mode — renders the "Continue with Google" button instead of the GIS button
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))

// Stand-in for the Android plugin. The real one only builds its GoogleSignInClient
// inside initialize(); signIn() on a null client crashes the process, so the mock
// records call order and makes signIn() reject if it was not initialized first.
vi.mock('@codetrix-studio/capacitor-google-auth', () => ({
  GoogleAuth: {
    initialize: mockInit,
    signIn: mockSignIn,
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupAuth() {
  mockUseAuth.mockReturnValue({
    setUser: mockSetUser,
    awardAirstars: vi.fn(),
    API: '',
    apiFetch: (...args) => fetch(...args),
  })
}

function clickContinueWithGoogle() {
  render(<LoginPage />)
  fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Login — native Google sign-in', () => {
  beforeEach(() => {
    setupAuth()
    mockCalls.length = 0
    mockNavigate.mockClear()
    mockSetUser.mockClear()
    sessionStorage.clear()
    localStorage.clear()

    mockInit.mockReset().mockImplementation(async () => { mockCalls.push('initialize') })
    mockSignIn.mockReset().mockImplementation(async () => {
      mockCalls.push('signIn')
      if (!mockCalls.includes('initialize')) throw new Error('NullPointerException: googleSignInClient')
      return { authentication: { idToken: 'id-token-123' } }
    })

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { user: { _id: 'u1', email: 'new@b.com' }, isNew: false } }),
      })
      .mockResolvedValue({ ok: true, json: async () => ({}) })
  })

  afterEach(() => { vi.restoreAllMocks() })

  // Regression: signIn() used to be called directly. On Android that dereferences a
  // null client and the Capacitor bridge rethrows the NPE as an uncaught
  // RuntimeException — the app dies before any JS catch can run.
  it('initializes the plugin before calling signIn', async () => {
    clickContinueWithGoogle()
    await waitFor(() => expect(mockSignIn).toHaveBeenCalled())
    expect(mockCalls).toEqual(['initialize', 'signIn'])
  })

  it('posts the idToken from the native plugin to /api/auth/google', async () => {
    clickContinueWithGoogle()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/auth/google')
    expect(JSON.parse(opts.body)).toEqual({ credential: 'id-token-123' })
    await waitFor(() => expect(mockSetUser).toHaveBeenCalled())
  })

  it('surfaces an error instead of hanging when the plugin rejects', async () => {
    mockSignIn.mockRejectedValueOnce(new Error('The user canceled the sign-in flow.'))
    clickContinueWithGoogle()
    await screen.findByText(/Google sign-in failed/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
