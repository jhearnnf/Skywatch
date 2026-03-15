import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import LoginPage from '../Login'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockSetUser     = vi.hoisted(() => vi.fn())
const mockAwardAircoins = vi.hoisted(() => vi.fn())
const mockUseAuth     = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupAuth() {
  mockUseAuth.mockReturnValue({ setUser: mockSetUser, awardAircoins: mockAwardAircoins, API: '' })
}

function makeAuthResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      data: { user: { _id: 'u1', email: 'a@b.com' }, isNew: false, ...overrides },
    }),
  }
}

function makeCompleteResponse(overrides = {}) {
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
        ...overrides,
      },
    }),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Login — pending brief redirect', () => {
  beforeEach(() => {
    setupAuth()
    mockNavigate.mockClear()
    mockSetUser.mockClear()
    mockAwardAircoins.mockClear()
    sessionStorage.clear()
    // Stub settings fetch (non-critical)
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: null }) })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('navigates to /home when no pending brief after login', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) }) // settings
      .mockResolvedValueOnce(makeAuthResponse())                                 // login

    render(<LoginPage />)
    fireEvent.click(screen.getByText('Sign In with Email'))

    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/home'))
  })

  it('navigates to /brief/:id and calls /complete when a pending brief is set', async () => {
    sessionStorage.setItem('sw_pending_brief', 'brief123')

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
      .mockResolvedValueOnce(makeAuthResponse())
      .mockResolvedValueOnce(makeCompleteResponse())

    render(<LoginPage />)
    fireEvent.click(screen.getByText('Sign In with Email'))
    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/brief/brief123'))
    const completeCalled = global.fetch.mock.calls.some(([url]) => url.includes('/complete'))
    expect(completeCalled).toBe(true)
  })

  it('clears sw_pending_brief and writes sw_brief_just_completed after consuming it', async () => {
    sessionStorage.setItem('sw_pending_brief', 'brief123')

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
      .mockResolvedValueOnce(makeAuthResponse())
      .mockResolvedValueOnce(makeCompleteResponse())

    render(<LoginPage />)
    fireEvent.click(screen.getByText('Sign In with Email'))
    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(sessionStorage.getItem('sw_pending_brief')).toBeNull()
    expect(sessionStorage.getItem('sw_brief_just_completed')).toBe('brief123')
  })

  it('writes sw_brief_coins with the complete response data', async () => {
    sessionStorage.setItem('sw_pending_brief', 'brief123')

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
      .mockResolvedValueOnce(makeAuthResponse())
      .mockResolvedValueOnce(makeCompleteResponse({ aircoinsEarned: 5, dailyCoinsEarned: 5, newTotalAircoins: 10, newCycleAircoins: 10 }))

    render(<LoginPage />)
    fireEvent.click(screen.getByText('Sign In with Email'))
    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const coins = JSON.parse(sessionStorage.getItem('sw_brief_coins'))
    expect(coins.aircoinsEarned).toBe(5)
    expect(coins.dailyCoinsEarned).toBe(5)
    expect(coins.newTotalAircoins).toBe(10)
  })

  it('new user: navigates to /brief/:id after selecting difficulty (not before)', async () => {
    sessionStorage.setItem('sw_pending_brief', 'brief123')

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })          // settings
      .mockResolvedValueOnce(makeAuthResponse({ isNew: true }))                          // register
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { user: {} } }) }) // difficulty PATCH
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })                      // /complete

    render(<LoginPage />)
    fireEvent.click(screen.getByText('Create Account'))

    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'new@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    // Difficulty screen shown — navigate not yet called
    await waitFor(() => screen.getByText('Standard'))
    expect(mockNavigate).not.toHaveBeenCalled()

    // Pick difficulty
    fireEvent.click(screen.getByText('Standard'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/brief/brief123'))
  })
})
