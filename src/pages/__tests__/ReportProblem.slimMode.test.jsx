import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import ReportProblem from '../ReportProblem'

// ── Mocks ─────────────────────────────────────────────────────────────────

// Force slim ("CBAT-only") mode for this whole file.
vi.mock('../../hooks/useSlimMode', () => ({ useSlimMode: () => true }))

let searchParamsState = new URLSearchParams('')
const setSearchParamsMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [searchParamsState, setSearchParamsMock],
    Link: ({ children, ...props }) => <a {...props}>{children}</a>,
  }
})

const apiFetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'u1', email: 't@t.com' },
    API: '',
    apiFetch: (...args) => apiFetchMock(...args),
  }),
}))

vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className }) => <div className={className}>{children}</div> },
}))

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ReportProblem — slim (native) mode', () => {
  beforeEach(() => {
    searchParamsState = new URLSearchParams('')
    navigateMock.mockClear()
    apiFetchMock.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('hides the live-chat option (no /chat entry point in slim)', () => {
    render(<ReportProblem />)
    expect(screen.queryByText(/Start a chat/i)).toBeNull()
    expect(screen.queryByText(/Talk to a real person/i)).toBeNull()
    // The "or" divider between the two cards is gone too.
    expect(screen.queryByText('or')).toBeNull()
  })

  it('still offers the written report path', () => {
    render(<ReportProblem />)
    expect(screen.getByText(/Send a written report/i)).toBeDefined()
    expect(screen.getByPlaceholderText(/what happened/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /submit report/i })).toBeDefined()
  })
})
