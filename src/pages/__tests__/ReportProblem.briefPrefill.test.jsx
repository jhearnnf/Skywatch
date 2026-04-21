import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import ReportProblem from '../ReportProblem'

// ── Mocks ─────────────────────────────────────────────────────────────────

let searchParamsState = new URLSearchParams('')
const setSearchParamsMock = vi.fn((next) => {
  searchParamsState = typeof next === 'function' ? next(searchParamsState) : next
})
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

const apiFetchMock = vi.fn()

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'u1', email: 't@t.com' },
    API: '',
    apiFetch: (...args) => apiFetchMock(...args),
  }),
}))

vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
}))

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ReportProblem — briefId prefill', () => {
  beforeEach(() => {
    searchParamsState = new URLSearchParams('')
    setSearchParamsMock.mockClear()
    navigateMock.mockClear()
    apiFetchMock.mockReset()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('does not show a brief banner when briefId is absent', async () => {
    render(<ReportProblem />)
    expect(screen.queryByText(/reporting on brief/i)).toBeNull()
  })

  it('shows a brief banner with the fetched title when briefId is in the query', async () => {
    searchParamsState = new URLSearchParams('briefId=brief123')
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { brief: { _id: 'brief123', title: 'Eurofighter Typhoon' } } }),
    })
    render(<ReportProblem />)
    await screen.findByText(/reporting on brief/i)
    await screen.findByText('Eurofighter Typhoon')
  })

  it('falls back to the briefId when the title fetch fails', async () => {
    searchParamsState = new URLSearchParams('briefId=brief999')
    apiFetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<ReportProblem />)
    await screen.findByText(/reporting on brief/i)
    expect(screen.getByText('brief999')).toBeInTheDocument()
  })

  it('POSTs briefId and brief-style pageReported when submitting', async () => {
    searchParamsState = new URLSearchParams('briefId=brief123')
    apiFetchMock.mockImplementation((url, opts) => {
      if (url.includes('/api/briefs/brief123')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { brief: { _id: 'brief123', title: 'Target' } } }) })
      }
      if (url.includes('/api/users/report-problem')) {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { report: { _id: 'r1' } } }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<ReportProblem />)
    await screen.findByText('Target')

    fireEvent.change(screen.getByPlaceholderText(/what happened/i), {
      target: { value: 'Section 2 has a typo' },
    })
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }))

    await waitFor(() => {
      const postCall = apiFetchMock.mock.calls.find(([url]) => url.includes('/api/users/report-problem'))
      expect(postCall).toBeDefined()
      const body = JSON.parse(postCall[1].body)
      expect(body.briefId).toBe('brief123')
      expect(body.pageReported).toBe('/brief/brief123')
      expect(body.description).toBe('Section 2 has a typo')
    })
  })

  it('omits briefId from the POST body when no briefId is set', async () => {
    apiFetchMock.mockImplementation((url) => {
      if (url.includes('/api/users/report-problem')) {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { report: { _id: 'r1' } } }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<ReportProblem />)

    fireEvent.change(screen.getByPlaceholderText(/what happened/i), {
      target: { value: 'General bug' },
    })
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }))

    await waitFor(() => {
      const postCall = apiFetchMock.mock.calls.find(([url]) => url.includes('/api/users/report-problem'))
      expect(postCall).toBeDefined()
      const body = JSON.parse(postCall[1].body)
      expect(body.briefId).toBeUndefined()
    })
  })

  it('clears the brief association when × is clicked', async () => {
    searchParamsState = new URLSearchParams('briefId=brief123')
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { brief: { _id: 'brief123', title: 'Target' } } }),
    })
    render(<ReportProblem />)
    await screen.findByText('Target')

    fireEvent.click(screen.getByLabelText(/remove brief association/i))

    expect(setSearchParamsMock).toHaveBeenCalled()
  })
})
