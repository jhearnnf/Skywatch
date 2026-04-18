import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import LoginPage from '../Login'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockSetUser     = vi.hoisted(() => vi.fn())
const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseLocation = vi.hoisted(() => vi.fn(() => ({ search: '' })))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockUseLocation(),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupAuth() {
  mockUseAuth.mockReturnValue({ setUser: mockSetUser, awardAirstars: vi.fn(), API: '', apiFetch: (...args) => fetch(...args) })
}

function makePendingResponse(email = 'agent@raf.mod.uk') {
  return {
    ok: true,
    json: async () => ({ status: 'pending', email }),
  }
}

function makeVerifyResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      data: { user: { _id: 'u1', email: 'agent@raf.mod.uk' }, isNew: true, ...overrides },
    }),
  }
}

function makeCompleteResponse() {
  return {
    ok: true,
    json: async () => ({
      data: {
        airstarsEarned: 10, dailyCoinsEarned: 0,
        loginStreak: 1, newTotalAirstars: 10, newCycleAirstars: 10, rankPromotion: null,
      },
    }),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Login — email verification CRO flow', () => {
  beforeEach(() => {
    setupAuth()
    mockNavigate.mockClear()
    mockSetUser.mockClear()
    mockUseLocation.mockReturnValue({ search: '?tab=register' })
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  // ── URL param belt-and-suspenders ────────────────────────────────────────

  it('writes pendingBrief URL param to localStorage on mount', async () => {
    mockUseLocation.mockReturnValue({ search: '?tab=register&pendingBrief=brief123' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })

    render(<LoginPage />)

    await waitFor(() => {
      expect(localStorage.getItem('sw_pending_brief')).toBe('brief123')
    })
  })

  it('does not write to localStorage when no pendingBrief param in URL', async () => {
    mockUseLocation.mockReturnValue({ search: '?tab=register' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })

    render(<LoginPage />)

    // Wait a tick then assert storage is still empty
    await waitFor(() => expect(screen.getByText('Join SkyWatch')).toBeInTheDocument())
    expect(localStorage.getItem('sw_pending_brief')).toBeNull()
  })

  // ── Register → VERIFY screen ─────────────────────────────────────────────

  it('shows VERIFY screen after successful register submission', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makePendingResponse())

    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'agent@raf.mod.uk' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Confirm Email' })).toBeInTheDocument()
  })

  it('pre-fills the sent-to email on the VERIFY screen', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makePendingResponse('agent@raf.mod.uk'))

    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'agent@raf.mod.uk' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())
    expect(screen.getByText('agent@raf.mod.uk')).toBeInTheDocument()
  })

  // ── VERIFY → navigate to brief ───────────────────────────────────────────

  it('navigates to /brief/:id after code verification when localStorage has a pending brief', async () => {
    localStorage.setItem('sw_pending_brief', 'brief123')

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makePendingResponse())    // POST /register
      .mockResolvedValueOnce(makeVerifyResponse())     // POST /verify-email
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // PATCH /difficulty
      .mockResolvedValueOnce(makeCompleteResponse())   // POST /briefs/:id/complete

    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'agent@raf.mod.uk' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => screen.getByText('Check your email'))

    const codeInput = screen.getByPlaceholderText('000000')
    fireEvent.change(codeInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Email' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/brief/brief123'))
  })

  it('navigates to /brief/:id when pending brief comes from URL param (not pre-existing localStorage)', async () => {
    // URL param is the only source — localStorage is empty on mount
    mockUseLocation.mockReturnValue({ search: '?tab=register&pendingBrief=brief456' })

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makePendingResponse())
      .mockResolvedValueOnce(makeVerifyResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce(makeCompleteResponse())

    render(<LoginPage />)

    // URL param effect writes to localStorage
    await waitFor(() => expect(localStorage.getItem('sw_pending_brief')).toBe('brief456'))

    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'agent@raf.mod.uk' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => screen.getByText('Check your email'))

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Email' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/brief/brief456'))
  })

  it('navigates to /home when no pending brief exists after code verification', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makePendingResponse())
      .mockResolvedValueOnce(makeVerifyResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'agent@raf.mod.uk' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => screen.getByText('Check your email'))

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '111111' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Email' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/home'))
  })

  it('calls POST /complete for the pending brief during verification', async () => {
    localStorage.setItem('sw_pending_brief', 'brief123')

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makePendingResponse())
      .mockResolvedValueOnce(makeVerifyResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce(makeCompleteResponse())

    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'agent@raf.mod.uk' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => screen.getByText('Check your email'))
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Email' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const completeCalled = global.fetch.mock.calls.some(([url]) => url.includes('/complete'))
    expect(completeCalled).toBe(true)
  })

  it('clears sw_pending_brief from localStorage after verification consumes it', async () => {
    localStorage.setItem('sw_pending_brief', 'brief123')

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makePendingResponse())
      .mockResolvedValueOnce(makeVerifyResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce(makeCompleteResponse())

    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'),    { target: { value: 'agent@raf.mod.uk' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => screen.getByText('Check your email'))
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Email' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(localStorage.getItem('sw_pending_brief')).toBeNull()
    expect(sessionStorage.getItem('sw_brief_just_completed')).toBe('brief123')
  })

  // ── tab=verify direct URL (email link click) ─────────────────────────────

  it('tab=verify: renders VERIFY screen immediately without registration step', () => {
    mockUseLocation.mockReturnValue({ search: '?tab=verify&email=agent@raf.mod.uk' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })

    render(<LoginPage />)

    expect(screen.getByText('Check your email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Email' })).toBeInTheDocument()
  })

  it('tab=verify: pre-fills the email from the URL param', () => {
    mockUseLocation.mockReturnValue({ search: '?tab=verify&email=agent@raf.mod.uk' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })

    render(<LoginPage />)

    expect(screen.getByText('agent@raf.mod.uk')).toBeInTheDocument()
  })

  it('tab=verify: submitting code with pending brief in localStorage navigates to brief', async () => {
    mockUseLocation.mockReturnValue({ search: '?tab=verify&email=agent@raf.mod.uk' })
    localStorage.setItem('sw_pending_brief', 'brief999')

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeVerifyResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce(makeCompleteResponse())

    render(<LoginPage />)

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '999888' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Email' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/brief/brief999'))
  })
})
