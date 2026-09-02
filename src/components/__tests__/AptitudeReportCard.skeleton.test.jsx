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
  // never resolves is worse than no skeleton: it holds the card open for ever and
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
    // And no unit either. The card that lands is far more often counting runs toward a first
    // score than reporting a pass mark, so a placeholder naming a pass mark would lie twice.
    expect(container.textContent).not.toContain('pass mark')
    expect(container.textContent).toContain('Working out what to play next')
  })

  // Nothing in the held space may rest at, or animate towards, a width that
  // could be read as a share of the score.
  it('leaves the progress rail empty apart from one indeterminate pass', () => {
    const d = deferred()
    const { container } = renderWith(vi.fn().mockReturnValue(d.promise))
    const rail = container.querySelector('[data-testid="aptitude-card-rail"]')
    expect(rail.querySelectorAll('.aptitude-rail-scan')).toHaveLength(1)
    expect(rail.querySelector('.aptitude-rail-fill')).toBeNull()
  })

  // Height parity with the real card is the entire point, and the shapes vary by
  // breakpoint — a phone card is two or three text lines and a rail where the
  // desktop card is three — so pinning literal class strings would pin the wrong
  // thing and would go stale on the next tuning pass. What has to hold is that
  // the boxes setting the height are IDENTICAL between the two, at every width.
  // Rendering both and comparing them asserts exactly that, and keeps holding
  // whatever the classes become.
  //
  // The comparison is against the PROGRESS card, not the scored one. That is the
  // taller shape (it keeps its action line on a phone, where the scored card
  // drops its verdict) and the one almost everyone who sees a skeleton at all is
  // about to get: a user whose card is worth waiting for is by definition not yet
  // a returning player with a settled score. A scored card landing instead
  // settles the grid UPWARD by a line, which hides nothing.
  const HEIGHT_BOXES = ['stripe', 'body', 'eyebrow', 'score', 'action', 'rail']
  const SCORED_BOXES = HEIGHT_BOXES.filter(box => box !== 'action')

  function classesOf(container) {
    return Object.fromEntries(HEIGHT_BOXES.map(box => [
      box,
      container.querySelector(`[data-testid="aptitude-card-${box}"]`)?.className,
    ]))
  }

  const summary = (over) => ({
    ok: true,
    json: async () => ({ data: {
      targetBattery: 'pilot',
      batteries: [{ key: 'pilot', score: 72, cutoff: 85, status: 'fail' }],
      ...over,
    } }),
  })

  // Colour is allowed to differ and does — the stripe carries the pass/fail fill,
  // a real figure is slate-900 against the placeholder's slate-500 — and so is
  // `tabular-nums`, which only stops the dashes shifting. None of those change a
  // line box, so they are normalised out and everything else must match. Named
  // explicitly rather than by a catch-all pattern: `text-lg` is a colour class by
  // shape and a geometry class by effect, so a loose /text-\S+/ would quietly stop
  // this test checking the thing it exists to check.
  const NON_GEOMETRY = /\s*(?:text-(?:slate|brand|emerald|amber|sky)-\d+|bg-\[#[0-9a-f]{6}\]|tabular-nums)(?![\w-])/gi
  const geometry = s => s.replace(NON_GEOMETRY, '').trim()

  it('mirrors the progress card boxes that set its height, at every breakpoint', async () => {
    const d = deferred()
    const loadingRender = renderWith(vi.fn().mockReturnValue(d.promise))
    const skeletonBoxes = classesOf(loadingRender.container)
    loadingRender.unmount()

    const progress = renderWith(vi.fn().mockResolvedValue(summary({
      batteries: [{ key: 'pilot', score: null, cutoff: 85, status: 'unscored', coverage: 0 }],
      nearestUnlock: { gameKey: 'cut', runs: 2, runsNeeded: 1 },
      runsToCount: 3,
    })))
    await waitFor(() => expect(skeleton()).toBeNull())

    const progressBoxes = classesOf(progress.container)
    for (const box of HEIGHT_BOXES) {
      expect(geometry(progressBoxes[box])).toBe(geometry(skeletonBoxes[box]))
    }
  })

  // The scored card has no action line, so it is a line shorter on a phone. Every
  // box it does share with the skeleton still has to match, or the shrink would be
  // a jump rather than the one line the layout animation is there to cover.
  it('shares every box it has with the scored card too', async () => {
    const d = deferred()
    const loadingRender = renderWith(vi.fn().mockReturnValue(d.promise))
    const skeletonBoxes = classesOf(loadingRender.container)
    loadingRender.unmount()

    const scored = renderWith(vi.fn().mockResolvedValue(summary()))
    await waitFor(() => expect(skeleton()).toBeNull())

    const scoredBoxes = classesOf(scored.container)
    for (const box of SCORED_BOXES) {
      expect(geometry(scoredBoxes[box])).toBe(geometry(skeletonBoxes[box]))
    }
  })

  // One wrapper owns the outer spacing for every state, which is what lets the
  // size change between them animate instead of snapping. Both shapes therefore
  // sit inside the same box rather than each carrying their own margin.
  it('holds every state in one persistent wrapper', async () => {
    const d = deferred()
    const loading = renderWith(vi.fn().mockReturnValue(d.promise))
    expect(skeleton().closest('.mb-3.sm\\:mb-5')).toBeInTheDocument()
    loading.unmount()

    const scored = renderWith(vi.fn().mockResolvedValue(summary()))
    await waitFor(() => expect(skeleton()).toBeNull())
    expect(scored.container.querySelector('[data-testid="aptitude-card-stripe"]')
      .closest('.mb-3.sm\\:mb-5')).toBeInTheDocument()
  })

  // The app's one shimmer idiom, shared with Profile's StatCard.
  it('uses the shared skeleton shimmer', () => {
    const d = deferred()
    const { container } = renderWith(vi.fn().mockReturnValue(d.promise))
    expect(container.querySelector('.stat-skeleton-sweep')).toBeInTheDocument()
  })

  // The scored card only fits on a phone because the verdict moves out of its own
  // line and up beside the role name: one copy shown below `sm`, one from `sm` up,
  // each hidden at the other's width. That is what makes it a line shorter there,
  // and it is the only state that plays the trick.
  it('keeps the scored phone shape to two text lines', async () => {
    const scored = renderWith(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {
        targetBattery: 'pilot',
        batteries: [{ key: 'pilot', score: 72, cutoff: 85, status: 'fail' }],
      } }),
    }))
    await waitFor(() => expect(skeleton()).toBeNull())
    expect(scored.container.querySelector('.sm\\:hidden')).toBeInTheDocument()
    expect(scored.container.querySelector('.hidden.sm\\:block')).toBeInTheDocument()
  })

  // The skeleton does not, because it is holding space for a progress card, whose
  // action line is shown at every width. A hidden-on-mobile line in the skeleton
  // would hold a shorter box than the card that replaces it.
  it('shows the skeleton action line at every width', () => {
    const d = deferred()
    const { container } = renderWith(vi.fn().mockReturnValue(d.promise))
    const action = container.querySelector('[data-testid="aptitude-card-action"]')
    expect(action.className).not.toMatch(/hidden|sm:block/)
  })
})
