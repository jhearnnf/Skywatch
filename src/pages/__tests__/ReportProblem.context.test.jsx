import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import ReportProblem from '../ReportProblem'
import { recordPath, __resetRouteTrail } from '../../utils/routeTrail'

// A report used to carry document.referrer as "the page reported", which is
// where the browser was before it loaded the site — empty inside the app, so
// every Android report recorded "unknown" and no version at all. These cover
// what it sends instead.

// ── Mocks ─────────────────────────────────────────────────────────────────

let searchParamsState = new URLSearchParams('')
const navigateMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [searchParamsState, vi.fn()],
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

let clientInfo = { platform: 'android', version: '1.2.34', build: '39' }
vi.mock('../../utils/appVersion', () => ({
  getClientInfo:  () => Promise.resolve(clientInfo),
  peekClientInfo: () => clientInfo,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

function okPost() {
  apiFetchMock.mockImplementation((url) => {
    if (url.includes('/api/users/report-problem')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { report: { _id: 'r1' } } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function submit(text) {
  fireEvent.change(screen.getByPlaceholderText(/what happened/i), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: /submit report/i }))
}

async function postedBody() {
  let body
  await waitFor(() => {
    const call = apiFetchMock.mock.calls.find(([url]) => url.includes('/api/users/report-problem'))
    expect(call).toBeDefined()
    body = JSON.parse(call[1].body)
  })
  return body
}

function postWasMade() {
  return apiFetchMock.mock.calls.some(([url]) => url.includes('/api/users/report-problem'))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ReportProblem — context sent with a report', () => {
  beforeEach(() => {
    searchParamsState = new URLSearchParams('')
    navigateMock.mockClear()
    apiFetchMock.mockReset()
    __resetRouteTrail()
    clientInfo = { platform: 'android', version: '1.2.34', build: '39' }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('reports the page they came from, not the referrer', async () => {
    recordPath('/cbat')
    recordPath('/cbat/sma')
    okPost()
    render(<ReportProblem />)
    submit('The dot never stops drifting')

    expect((await postedBody()).pageReported).toBe('/cbat/sma')
  })

  it('sends the pages leading up to the report, oldest first', async () => {
    recordPath('/cbat')
    recordPath('/cbat/sma')
    okPost()
    render(<ReportProblem />)
    submit('The dot never stops drifting')

    expect((await postedBody()).routeTrail).toEqual(['/cbat', '/cbat/sma'])
  })

  // Otherwise it is the last entry of every report ever filed.
  it('leaves the report page itself out of the trail', async () => {
    recordPath('/cbat')
    recordPath('/report')
    okPost()
    render(<ReportProblem />)
    submit('Something went wrong here')

    const body = await postedBody()
    expect(body.routeTrail).toEqual(['/cbat'])
    expect(body.pageReported).toBe('/cbat')
  })

  it('falls back to unknown when there is no trail at all', async () => {
    okPost()
    render(<ReportProblem />)
    submit('Opened the app straight here')

    const body = await postedBody()
    expect(body.pageReported).toBe('unknown')
    expect(body.routeTrail).toBeUndefined()
  })

  it('attaches the client platform, version and build', async () => {
    okPost()
    render(<ReportProblem />)
    submit('The screen goes blank on launch')

    expect((await postedBody()).client).toEqual({ platform: 'android', version: '1.2.34', build: '39' })
  })

  it('still submits when the client cannot name its build', async () => {
    clientInfo = null
    okPost()
    render(<ReportProblem />)
    submit('The screen goes blank on launch')

    const body = await postedBody()
    expect(body.client).toBeUndefined()
    expect(body.description).toBe('The screen goes blank on launch')
  })

  it('keeps the brief association ahead of the trail', async () => {
    searchParamsState = new URLSearchParams('briefId=brief123')
    recordPath('/cbat')
    okPost()
    render(<ReportProblem />)
    submit('Section 2 contradicts section 1')

    expect((await postedBody()).pageReported).toBe('/brief/brief123')
  })
})

describe('ReportProblem — what counts as a report', () => {
  beforeEach(() => {
    searchParamsState = new URLSearchParams('')
    apiFetchMock.mockReset()
    __resetRouteTrail()
    clientInfo = null
  })
  afterEach(() => { vi.restoreAllMocks() })

  // The report that prompted all of this read, in full, an email address.
  it('refuses a report that is only an email address', async () => {
    okPost()
    render(<ReportProblem />)
    submit('jameshearn1995@hotmail.co.uk')

    await screen.findByText(/just an email address/i)
    expect(postWasMade()).toBe(false)
  })

  it('refuses a one-word report and says what is missing', async () => {
    okPost()
    render(<ReportProblem />)
    submit('broken')

    await screen.findByText(/add a bit more detail/i)
    expect(postWasMade()).toBe(false)
  })

  it('accepts a short but real report', async () => {
    okPost()
    render(<ReportProblem />)
    submit('the sound never plays')

    expect((await postedBody()).description).toBe('the sound never plays')
  })

  it('accepts a report that merely mentions an email address', async () => {
    okPost()
    render(<ReportProblem />)
    submit('No sign-in email ever arrives at me@test.com')

    expect((await postedBody()).description).toBe('No sign-in email ever arrives at me@test.com')
  })
})
