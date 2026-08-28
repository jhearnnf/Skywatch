import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import ReportProblem from '../ReportProblem'

// This page is reached from a link in the last row of the CBAT grid, which is
// itself tuned to fit one phone screen — so a form that scrolls undoes the point
// of it. Laid out as the desktop page is, it is about 760px of content against
// roughly 370px of usable height on a small handset, so it does not tighten into
// place: at phone width every box except the textarea is fixed height, the page
// is pinned to the viewport, and the textarea takes the remainder.
//
// That only works while the flex chain from the page container down to the
// textarea is unbroken. Drop `flex-1` or `min-h-0` from any single link and the
// textarea silently stops absorbing, the page grows past the viewport, and it
// scrolls again — with nothing on screen to say why. These tests pin the chain.

vi.mock('../../hooks/useSlimMode', () => ({ useSlimMode: () => false }))

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

describe('ReportProblem — fitting the phone viewport', () => {
  beforeEach(() => {
    searchParamsState = new URLSearchParams('')
    navigateMock.mockClear()
  })
  afterEach(() => document.body.classList.remove('phone-tight'))

  it('pins the page to the viewport with a floor to scroll past', () => {
    render(<ReportProblem />)
    const page = screen.getByTestId('report-page')
    expect(page.className).toContain('max-sm:flex-col')
    // 10rem is topbar 3.5 + the tightened 0.75 above and below + BottomNav 5.
    expect(page.className).toContain('max-sm:h-[calc(100dvh-10rem-env(safe-area-inset-bottom))]')
    // Below this the textarea would be squeezed past usefulness, so the page
    // stops shrinking and scrolls instead.
    expect(page.className).toContain('max-sm:min-h-[23rem]')
  })

  it('claims the tightened shell padding the height calculation assumes', () => {
    render(<ReportProblem />)
    // Without this the shell still spends 48px on py-6 and the 10rem above is
    // 24px short, which is a line and a half of typing room.
    expect(document.body.classList.contains('phone-tight')).toBe(true)
  })

  it('leaves an unbroken flex chain from the page down to the textarea', () => {
    render(<ReportProblem />)
    const page = screen.getByTestId('report-page')
    const textarea = screen.getByLabelText(/describe the problem/i)

    // The textarea is the one element allowed to stretch; everything between it
    // and the page has to both stretch and be allowed to shrink.
    expect(textarea.className).toContain('max-sm:flex-1')
    expect(textarea.className).toContain('max-sm:min-h-[4.5rem]')

    let node = textarea.parentElement
    let links = 0
    while (node && node !== page) {
      expect(node.className).toContain('max-sm:flex-1')
      expect(node.className).toContain('max-sm:min-h-0')
      // Every link is itself a column, or the next flex-1 down has no axis.
      // The form is a column at both widths; the rest only need to be one on a
      // phone, so either spelling counts.
      expect(node.className).toMatch(/(?:^|\s)(?:max-sm:)?flex-col(?:\s|$)/)
      links++
      node = node.parentElement
    }
    // Guards the walk itself: if the markup flattened, an empty loop would pass.
    expect(node).toBe(page)
    expect(links).toBeGreaterThanOrEqual(3)
  })

  it('keeps both ways to reach us, as equally weighted cards', () => {
    render(<ReportProblem />)
    // The height came out of blurbs and step numbers, never out of an option.
    expect(screen.getByRole('button', { name: /start a chat/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit report/i })).toBeInTheDocument()
    // Exact strings: the page subtitle also ends "or send a written report."
    expect(screen.getByText('Talk to a real person')).toBeInTheDocument()
    expect(screen.getByText('Send a written report')).toBeInTheDocument()
  })

  it('drops the step numbers on a phone, which contradict the "or" between the cards', () => {
    const { container } = render(<ReportProblem />)
    for (const step of ['1', '2']) {
      const badge = [...container.querySelectorAll('span')].find(s => s.textContent === step)
      expect(badge.className).toContain('hidden')
      expect(badge.className).toContain('sm:flex')
    }
  })
})
