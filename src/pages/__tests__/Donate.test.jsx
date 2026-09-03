import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Donate from '../Donate'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth  = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())
const mockParams   = vi.hoisted(() => ({ value: new URLSearchParams() }))
const mockSlimApp  = vi.hoisted(() => ({ value: false }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockParams.value, vi.fn()],
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../utils/appMode', () => ({
  get SLIM_APP() { return mockSlimApp.value },
}))
// Forwards everything except the motion-only props, so `data-testid` survives
// onto the DOM node — a mock that kept only className would silently hide the
// elements these tests query by test id.
vi.mock('framer-motion', () => {
  const MOTION_ONLY = new Set(['initial', 'animate', 'exit', 'transition', 'variants'])
  const strip = (props) => Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_ONLY.has(k)))
  return {
    motion: {
      div: ({ children, ...props }) => <div {...strip(props)}>{children}</div>,
    },
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────

let apiFetch

function renderPage({ user = null, query = '', ok = true, body = { url: 'https://checkout.stripe.com/x' } } = {}) {
  mockParams.value = new URLSearchParams(query)
  apiFetch = vi.fn().mockResolvedValue({ ok, json: async () => body })
  mockUseAuth.mockReturnValue({ user, API: '', apiFetch })
  return render(<Donate />)
}

const lastBody = () => JSON.parse(apiFetch.mock.calls.at(-1)[1].body)

// The page makes two kinds of call now: it reports its own arrival for the admin
// donation funnel, then opens Checkout when someone presses the button. Picked
// by URL rather than by position so a test about one is not broken by the other.
const callsTo = (path) => apiFetch.mock.calls.filter(c => String(c[0]).includes(path))
const bodyOf  = (call)  => JSON.parse(call[1].body)

beforeEach(() => {
  mockSlimApp.value = false
  mockNavigate.mockReset()
  // window.location.href is assigned on success; jsdom would navigate.
  delete window.location
  window.location = { href: '' }
})
afterEach(cleanup)

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Donate page', () => {
  // The single most important property of this page. The person likeliest to
  // give is often someone who has used the CBAT games for weeks without ever
  // making an account, and a sign-up wall in front of a gift is how you don't
  // receive it. Nothing here reads or writes anything that needs to know who
  // you are.
  it('is fully usable logged out, and says so', () => {
    renderPage({ user: null })

    expect(screen.getByTestId('donate-page')).toBeInTheDocument()
    expect(screen.getByTestId('donate-submit')).not.toBeDisabled()
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument()
    expect(screen.queryByText(/sign in required/i)).toBeNull()
  })

  it('offers £3, £5, £10 and £20, opening on the lowest', () => {
    renderPage()

    for (const n of [3, 5, 10, 20]) {
      expect(screen.getByTestId(`donate-preset-${n}`)).toHaveTextContent(`£${n}`)
    }
    // £3 is the amount the ask elsewhere on the site names, so landing here on
    // anything higher would read as a bait and switch.
    expect(screen.getByTestId('donate-preset-3').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('donate-submit')).toHaveTextContent('Donate £3')
  })

  it('sends the chosen preset to Stripe', async () => {
    renderPage()

    fireEvent.click(screen.getByTestId('donate-preset-10'))
    expect(screen.getByTestId('donate-submit')).toHaveTextContent('Donate £10')

    fireEvent.click(screen.getByTestId('donate-submit'))
    await waitFor(() => expect(callsTo('/api/stripe/create-donation-session')).toHaveLength(1))
    expect(lastBody().amount).toBe(10)
  })

  // The impression half of the donation funnel. The post-game note and the
  // questionnaire both record theirs against an account; this page is shown to
  // people who do not have one, so it has to report its own.
  it('tells the server someone reached the page', async () => {
    renderPage()

    await waitFor(() => expect(callsTo('/api/donation/visit')).toHaveLength(1))
    expect(bodyOf(callsTo('/api/donation/visit')[0]).visitKey).toEqual(expect.any(String))
  })

  // Pairing the arrival with the press-through is what makes the funnel a rate
  // rather than two unrelated totals.
  it('carries the same visit key into the Checkout request', async () => {
    renderPage()
    await waitFor(() => expect(callsTo('/api/donation/visit')).toHaveLength(1))

    fireEvent.click(screen.getByTestId('donate-submit'))
    await waitFor(() => expect(callsTo('/api/stripe/create-donation-session')).toHaveLength(1))

    expect(lastBody().visitKey).toBe(bodyOf(callsTo('/api/donation/visit')[0]).visitKey)
  })

  // A stat is never worth breaking the page for. Reported at mount, so the
  // failure has to be armed before the render rather than after it.
  it('still works when the arrival report fails', async () => {
    mockParams.value = new URLSearchParams()
    apiFetch = vi.fn((url) => String(url).includes('/api/donation/visit')
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/x' }) }))
    mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch })
    render(<Donate />)

    fireEvent.click(screen.getByTestId('donate-submit'))
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/x'))
    expect(screen.queryByTestId('donate-error')).toBeNull()
  })

  it('redirects to the Stripe Checkout URL it is handed', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId('donate-submit'))
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/x'))
  })

  // Two ways of answering one question, so exactly one is live at a time.
  // Holding both and picking a winner later is how you charge someone the
  // figure they were not looking at.
  it('lets a custom amount take over from the presets, and back again', async () => {
    renderPage()

    fireEvent.change(screen.getByTestId('donate-custom'), { target: { value: '42' } })
    expect(screen.getByTestId('donate-preset-3').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('donate-submit')).toHaveTextContent('Donate £42')

    fireEvent.click(screen.getByTestId('donate-preset-5'))
    expect(screen.getByTestId('donate-custom')).toHaveValue('')
    expect(screen.getByTestId('donate-submit')).toHaveTextContent('Donate £5')
  })

  it('accepts pence in a custom amount', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('donate-custom'), { target: { value: '7.50' } })
    expect(screen.getByTestId('donate-submit')).toHaveTextContent('Donate £7.50')
  })

  it('strips anything that is not a number from the amount box', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('donate-custom'), { target: { value: '1e2£.5.5abc' } })
    expect(screen.getByTestId('donate-custom')).toHaveValue('12.55')
  })

  // The client refuses before the round trip; the server refuses again. Both,
  // because the client bound is a courtesy and the server bound is the rule.
  it.each([['0.5'], ['501'], ['0']])('will not submit %s', (value) => {
    renderPage()
    fireEvent.change(screen.getByTestId('donate-custom'), { target: { value } })

    const submit = screen.getByTestId('donate-submit')
    expect(submit).toBeDisabled()
    expect(submit).toHaveTextContent('Choose an amount')
  })

  it('shows the server error rather than a silent no-op', async () => {
    renderPage({ ok: false, body: { error: 'Please choose an amount between £1 and £500.' } })

    fireEvent.click(screen.getByTestId('donate-submit'))
    await waitFor(() => expect(screen.getByTestId('donate-error')).toHaveTextContent(/between £1 and £500/))
    // Still usable — the failure must not strand them on a dead button.
    expect(screen.getByTestId('donate-submit')).not.toBeDisabled()
  })

  it('thanks the donor on the way back from Stripe', () => {
    renderPage({ query: 'donation=success' })
    expect(screen.getByTestId('donate-success')).toHaveTextContent(/thank you/i)
  })

  // Backing out is a normal thing to do and is not an error, so it is stated
  // plainly and the form is left exactly as it was.
  it('states plainly that nothing was taken when the donor backs out', () => {
    renderPage({ query: 'donation=cancelled' })
    expect(screen.getByTestId('donate-cancelled')).toHaveTextContent(/no payment was taken/i)
    expect(screen.getByTestId('donate-submit')).toBeInTheDocument()
  })

  // Google Play treats donations outside Play Billing as a carve-out for
  // registered charities, and SkyWatch is not one. Nothing in the app links
  // here; this is the guard for anything that gets here anyway.
  it('refuses to render in the native app', () => {
    mockSlimApp.value = true
    renderPage()

    expect(screen.getByTestId('donate-native-blocked')).toBeInTheDocument()
    expect(screen.queryByTestId('donate-submit')).toBeNull()
  })

  // Every one of these exists because someone could reasonably assume the
  // opposite, and finding out afterwards is what turns a donation into a
  // chargeback.
  it('says what a donation is not', () => {
    renderPage()
    const text = screen.getByTestId('donate-page').textContent
    expect(text).toMatch(/not a subscription/i)
    expect(text).toMatch(/does not unlock/i)
    expect(text).toMatch(/stripe/i)
  })

  // Manufactured jeopardy converts worse than gratitude, and this page is read
  // by people who owe us nothing.
  it('does not threaten the service to get the money', () => {
    renderPage()
    expect(screen.getByTestId('donate-page').textContent)
      .not.toMatch(/shut down|shutting|will close|at risk|lose your/i)
  })
})
