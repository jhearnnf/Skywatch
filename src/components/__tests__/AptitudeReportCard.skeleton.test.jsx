import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import AptitudeReportCard from '../AptitudeReportCard'

// The card reserves its height while the summary is in flight. It sits directly
// above the /cbat game grid, which is tuned to put all 22 games on one phone
// screen — so a card that arrives late does not just pop in, it shoves the whole
// grid down and turns a page that fits into a page that scrolls. These tests pin
// the skeleton's presence and, just as importantly, that it always comes down.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
}))

const USER = { _id: '1' }

// A fetch that resolves only when the test says so, so the loading frame can be
// asserted rather than raced against.
function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

function renderWith(apiFetch, user = USER) {
  mockUseAuth.mockReturnValue({ user, API: '', apiFetch })
  return render(<AptitudeReportCard />)
}

const skeleton = () => screen.queryByTestId('aptitude-report-skeleton')

describe('AptitudeReportCard — loading skeleton', () => {
  beforeEach(() => mockUseAuth.mockReset())

  it('renders the skeleton on the very first paint, before any response', () => {
    const d = deferred()
    renderWith(vi.fn().mockReturnValue(d.promise))
    expect(skeleton()).toBeInTheDocument()
    expect(skeleton()).toHaveAttribute('aria-busy', 'true')
  })

  it('swaps the skeleton for the real card once the summary lands', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {
        targetBattery: 'pilot',
        batteries: [{ key: 'pilot', score: 72, cutoff: 85, status: 'fail' }],
      } }),
    })
    renderWith(apiFetch)
    await waitFor(() => expect(skeleton()).toBeNull())
    expect(screen.getByText(/pass mark 85/)).toBeInTheDocument()
  })

  // The failure modes all have to end with the skeleton gone. A skeleton that
  // never resolves is worse than no skeleton: it holds 116px open for ever and
  // permanently costs the grid the screen space this whole change bought.
  it('comes down when the request throws', async () => {
    renderWith(vi.fn().mockRejectedValue(new Error('offline')))
    await waitFor(() => expect(skeleton()).toBeNull())
  })

  it('comes down when the response is not ok', async () => {
    renderWith(vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    await waitFor(() => expect(skeleton()).toBeNull())
  })

  it('comes down when the payload has no batteries array', async () => {
    renderWith(vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }))
    await waitFor(() => expect(skeleton()).toBeNull())
  })

  // No user means the effect never fetches, so nothing would ever clear a
  // skeleton that started true.
  it('renders nothing at all when there is no signed-in user', async () => {
    const apiFetch = vi.fn()
    renderWith(apiFetch, null)
    await waitFor(() => expect(skeleton()).toBeNull())
    expect(apiFetch).not.toHaveBeenCalled()
  })

  // The skeleton must never show a figure. It used to roll a random number
  // through the score slot to look like it was calculating, which read as a
  // broken readout: the one number the card exists to report was visibly
  // jumping between values nothing had computed. Dashes only, in both slots.
  it('shows no digits at all while it is loading', () => {
    const d = deferred()
    const { container } = renderWith(vi.fn().mockReturnValue(d.promise))
    expect(container.textContent).not.toMatch(/\d/)
    expect(container.textContent).toContain('pass mark')
  })

  // Nothing in the held space may rest at, or animate towards, a width that
  // could be read as a share of the score.
  it('leaves the progress rail empty apart from one indeterminate pass', () => {
    const d = deferred()
    const { container } = renderWith(vi.fn().mockReturnValue(d.promise))
    const rail = container.querySelector('.mt-3.h-2')
    expect(rail.querySelectorAll('.aptitude-rail-scan')).toHaveLength(1)
    expect(rail.querySelector('.aptitude-rail-fill')).toBeNull()
  })

  // Height parity with the real card is the entire point, and it is achieved by
  // reusing the scored card's own boxes. A skeleton that stopped mirroring those
  // classes would silently reintroduce the shift, so the structure is pinned.
  it('mirrors the scored card boxes that set its height', () => {
    const d = deferred()
    const { container } = renderWith(vi.fn().mockReturnValue(d.promise))

    // Same outer spacing as the real card's wrapper.
    expect(skeleton().className).toContain('mb-5')
    // Status stripe, 16px padding body, and the progress rail.
    expect(container.querySelector('.w-2.shrink-0')).toBeInTheDocument()
    expect(container.querySelector('.p-4')).toBeInTheDocument()
    expect(container.querySelector('.mt-3.h-2')).toBeInTheDocument()
    // The three stacked lines whose line boxes carry the height.
    expect(container.querySelector('p.text-\\[10px\\]')).toBeInTheDocument()
    expect(container.querySelector('p.text-2xl.leading-tight')).toBeInTheDocument()
    expect(container.querySelector('p.text-\\[11px\\]')).toBeInTheDocument()
    // The app's one shimmer idiom, shared with Profile's StatCard.
    expect(container.querySelector('.stat-skeleton-sweep')).toBeInTheDocument()
  })
})
