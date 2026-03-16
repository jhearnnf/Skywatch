import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import LoginPage from '../Login'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate     = vi.hoisted(() => vi.fn())
const mockSetUser      = vi.hoisted(() => vi.fn())
const mockUseAuth      = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

const NEW_USER = { _id: 'u1', email: 'new@test.com', difficultySetting: 'easy' }

function setupAuth() {
  mockUseAuth.mockReturnValue({ setUser: mockSetUser, awardAircoins: vi.fn(), API: '' })
}

function makeRegisterResponse() {
  return { ok: true, json: async () => ({ data: { user: NEW_USER, isNew: true } }) }
}

function makeDifficultyResponse() {
  return { ok: true, json: async () => ({ data: { user: { ...NEW_USER, difficultySetting: 'easy' } } }) }
}

function setupFetch({ difficultyOk = true } = {}) {
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) }) // settings
    .mockResolvedValueOnce(makeRegisterResponse())                            // register
    .mockResolvedValue(difficultyOk ? makeDifficultyResponse() : { ok: false, json: async () => ({}) })
}

async function registerNewUser() {
  fireEvent.click(screen.getByText('Create Account'))
  fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'new@test.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Login — difficulty selection screen', () => {
  beforeEach(() => {
    setupAuth()
    mockNavigate.mockClear()
    mockSetUser.mockClear()
    sessionStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('shows the difficulty screen after a new account is created', async () => {
    global.fetch = setupFetch()
    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => expect(screen.getByText('Standard')).toBeDefined())
    expect(screen.getByText('Advanced')).toBeDefined()
  })

  it('does NOT call setUser before difficulty is selected', async () => {
    global.fetch = setupFetch()
    render(<LoginPage />)
    await registerNewUser()

    // Difficulty screen must be visible
    await waitFor(() => screen.getByText('Standard'))

    // setUser must not have been called yet
    expect(mockSetUser).not.toHaveBeenCalled()
  })

  it('calls setUser exactly once after difficulty is selected', async () => {
    global.fetch = setupFetch()
    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => screen.getByText('Standard'))
    fireEvent.click(screen.getByText('Standard'))

    await waitFor(() => expect(mockSetUser).toHaveBeenCalledTimes(1))
  })

  it('calls setUser with the PATCH response user after difficulty selection', async () => {
    const patchedUser = { ...NEW_USER, difficultySetting: 'easy' }
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
      .mockResolvedValueOnce(makeRegisterResponse())
      .mockResolvedValue({ ok: true, json: async () => ({ data: { user: patchedUser } }) })

    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => screen.getByText('Standard'))
    fireEvent.click(screen.getByText('Standard'))

    await waitFor(() => expect(mockSetUser).toHaveBeenCalledWith(patchedUser))
  })

  it('falls back to the registration user if the difficulty PATCH fails', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
      .mockResolvedValueOnce(makeRegisterResponse())
      .mockResolvedValue({ ok: false, json: async () => ({}) }) // PATCH fails

    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => screen.getByText('Standard'))
    fireEvent.click(screen.getByText('Standard'))

    // Falls back to the user captured from the register response
    await waitFor(() => expect(mockSetUser).toHaveBeenCalledWith(NEW_USER))
  })

  it('navigates to /home after selecting easy difficulty with no pending brief', async () => {
    global.fetch = setupFetch()
    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => screen.getByText('Standard'))
    fireEvent.click(screen.getByText('Standard'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/home'))
  })

  it('navigates to /home after selecting medium difficulty with no pending brief', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
      .mockResolvedValueOnce(makeRegisterResponse())
      .mockResolvedValue({ ok: true, json: async () => ({ data: { user: { ...NEW_USER, difficultySetting: 'medium' } } }) })

    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => screen.getByText('Advanced'))
    fireEvent.click(screen.getByText('Advanced'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/home'))
  })

  it('does NOT navigate before difficulty is selected', async () => {
    global.fetch = setupFetch()
    render(<LoginPage />)
    await registerNewUser()

    await waitFor(() => screen.getByText('Standard'))
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('new user via Google: shows difficulty screen and defers setUser', async () => {
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) }) // settings
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: NEW_USER, isNew: true } }) }) // google auth
      .mockResolvedValue(makeDifficultyResponse())

    render(<LoginPage />)

    // initialize is called in the useEffect — callback is now captured
    await waitFor(() => expect(googleCallback).toBeDefined())
    await googleCallback({ credential: 'fake-token' })

    await waitFor(() => expect(screen.getByText('Standard')).toBeDefined())
    expect(mockSetUser).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Standard'))
    await waitFor(() => expect(mockSetUser).toHaveBeenCalledTimes(1))

    delete window.google
    vi.unstubAllEnvs()
  })
})
