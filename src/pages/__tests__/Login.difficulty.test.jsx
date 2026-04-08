import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import LoginPage from '../Login'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate = vi.hoisted(() => vi.fn())
const mockSetUser  = vi.hoisted(() => vi.fn())
const mockUseAuth  = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ search: '' }),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

const NEW_USER = { _id: 'u1', email: 'new@test.com', difficultySetting: 'easy' }

function setupAuth() {
  mockUseAuth.mockReturnValue({ setUser: mockSetUser, awardAircoins: vi.fn(), API: '', apiFetch: (...args) => fetch(...args) })
}

// register returns isNew:true; PATCH difficulty always succeeds
function setupFetch() {
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: NEW_USER, isNew: true } }) }) // register
    .mockResolvedValue({ ok: true, json: async () => ({ data: { user: NEW_USER } }) })                  // difficulty PATCH
}

async function registerNewUser() {
  fireEvent.click(screen.getByText('Create Account'))
  fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'new@test.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Login — new user auto-standard difficulty', () => {
  beforeEach(() => {
    setupAuth()
    mockNavigate.mockClear()
    mockSetUser.mockClear()
    sessionStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('does NOT show a difficulty selection screen after registration', async () => {
    global.fetch = setupFetch()
    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())

    expect(screen.queryByText('Standard')).toBeNull()
    expect(screen.queryByText('Advanced')).toBeNull()
  })

  it('silently PATCHes difficulty to easy after registration', async () => {
    const mockFetch = setupFetch()
    global.fetch = mockFetch
    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())

    const difficultyCall = mockFetch.mock.calls.find(([url, opts]) =>
      url.includes('/difficulty') && opts?.method === 'PATCH'
    )
    expect(difficultyCall).toBeDefined()
    expect(JSON.parse(difficultyCall[1].body)).toEqual({ difficulty: 'easy' })
  })

  it('calls setUser immediately (not deferred) after registration', async () => {
    global.fetch = setupFetch()
    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => expect(mockSetUser).toHaveBeenCalledTimes(1))
  })

  it('navigates to /home after registration with no pending brief', async () => {
    global.fetch = setupFetch()
    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/home'))
  })

  it('navigates to /brief/:id after registration when a pending brief exists', async () => {
    localStorage.setItem('sw_pending_brief', 'brief99')
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: NEW_USER, isNew: true } }) }) // register
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: NEW_USER } }) })              // difficulty PATCH
      .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })                                  // brief complete

    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/brief/brief99'))
  })

  it('new user via Google: auto-sets standard and navigates without showing difficulty screen', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')

    let googleCallback
    window.google = {
      accounts: {
        id: {
          initialize: vi.fn((opts) => { googleCallback = opts.callback }),
          renderButton: vi.fn(),
        },
      },
    }

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: NEW_USER, isNew: true } }) }) // google auth
      .mockResolvedValue({ ok: true, json: async () => ({ data: { user: NEW_USER } }) })                  // difficulty PATCH

    render(<LoginPage />)

    await waitFor(() => expect(googleCallback).toBeDefined())
    await googleCallback({ credential: 'fake-token' })

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/home'))
    expect(screen.queryByText('Standard')).toBeNull()

    delete window.google
    vi.unstubAllEnvs()
  })
})
