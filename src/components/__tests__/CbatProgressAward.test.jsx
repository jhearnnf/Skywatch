import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatProgressAward, { CbatDonationNote } from '../CbatProgressAward'
import CbatGameOver from '../CbatGameOver'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockChrome = vi.hoisted(() => ({ enterGameOver: vi.fn(), exitGameOver: vi.fn() }))

// SLIM_APP is a module-level const resolved from Capacitor at import time, so the platform has to
// be decided per test file rather than per test. Default: web.
const mockSlimApp = vi.hoisted(() => ({ value: false }))
vi.mock('../../utils/appMode', () => ({
  get SLIM_APP() { return mockSlimApp.value },
}))

const mockCapture = vi.hoisted(() => vi.fn())
vi.mock('../../lib/posthog', () => ({ captureEvent: mockCapture }))

vi.mock('../../lib/net', () => ({ isOnline: () => true, onNetworkChange: () => () => {} }))
vi.mock('../../lib/apiHealth', () => ({ getApiHealth: () => ({ status: 'ok' }), onApiHealthChange: () => () => {} }))
vi.mock('../../lib/cbatOutbox', () => ({ pendingCount: async () => 0, onOutboxChange: () => () => {} }))
vi.mock('react-router-dom', () => ({ Link: ({ children, to }) => <a href={to}>{children}</a> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({ useGameChrome: () => mockChrome }))
// Forwards everything except the motion-only props, so `data-testid` survives onto the DOM node.
// A mock that keeps only className would silently hide the elements these tests query by test id.
vi.mock('framer-motion', () => {
  const MOTION_ONLY = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap', 'layout'])
  const strip = (props) => Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_ONLY.has(k)))
  return {
    AnimatePresence: ({ children }) => <>{children}</>,
    motion: {
      div: (props) => <div {...strip(props)} />,
      span: (props) => <span {...strip(props)} />,
      circle: (props) => <circle {...strip(props)} />,
    },
  }
})

// Run the count-up straight to its final frame so assertions can read the settled percentage
// rather than whatever value the tween happened to be passing through.
beforeEach(() => {
  let t = 0
  vi.stubGlobal('requestAnimationFrame', (cb) => { t += 2000; cb(t); return t })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.clearAllMocks()
})
afterEach(() => vi.unstubAllGlobals())

const awardProps = {
  tier: 30, pct: 34, attempts: 12, gameTitle: 'Symbols', gameEmoji: '🔣', onDismiss: vi.fn(),
}

describe('CbatProgressAward — the celebration', () => {
  it('states the tier, the measured improvement and the sample it came from', () => {
    render(<CbatProgressAward {...awardProps} />)

    expect(screen.getByText('Big improvement')).toBeDefined()
    expect(screen.getByText('+34%')).toBeDefined()
    expect(screen.getByText(/last 5 runs at Symbols are 34% better than your first 5/i)).toBeDefined()
    expect(screen.getByText(/across 12 attempts/i)).toBeDefined()
  })

  // The claim is about scores, never about aptitude — these games can't measure the latter, and
  // saying so would also imply we are the real CBAT.
  it('claims only that the scores improved, not the player', () => {
    render(<CbatProgressAward {...awardProps} />)
    const body = document.body.textContent
    expect(body).not.toMatch(/aptitude|spatial reasoning|IQ/i)
  })

  // The celebration must be able to stand entirely alone — no ask inside it, ever.
  it('contains no donation ask', () => {
    render(<CbatProgressAward {...awardProps} />)
    expect(screen.queryByTestId('cbat-donation-note')).toBeNull()
    expect(document.body.textContent).not.toMatch(/donat|support|£/i)
  })

  it('dismisses on Continue', () => {
    const onDismiss = vi.fn()
    render(<CbatProgressAward {...awardProps} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('CbatDonationNote — the ask', () => {
  it('names a concrete amount and says the site is free and ad-free', () => {
    render(<CbatDonationNote url="https://ko-fi.com/x" onRecord={vi.fn()} />)
    expect(screen.getByText(/free and has no ads/i)).toBeDefined()
    expect(screen.getByText(/£3/)).toBeDefined()
  })

  // Manufactured jeopardy converts worse than gratitude, and is a bad thing to do to someone who
  // has just been congratulated.
  it('does not threaten the service or the player\'s progress', () => {
    render(<CbatDonationNote url="https://ko-fi.com/x" onRecord={vi.fn()} />)
    expect(document.body.textContent).not.toMatch(/shut down|close|lose your|will end|at risk/i)
  })

  it('renders nothing without a URL, so the ask can never point nowhere', () => {
    const { container } = render(<CbatDonationNote url="" onRecord={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('opens the link in a new tab and records the click', () => {
    const onRecord = vi.fn()
    render(<CbatDonationNote url="https://ko-fi.com/x" onRecord={onRecord} />)

    const link = screen.getByRole('link', { name: /support skywatch/i })
    expect(link.getAttribute('href')).toBe('https://ko-fi.com/x')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')

    fireEvent.click(link)
    expect(onRecord).toHaveBeenCalledWith('clicked')
  })

  // Two controls, not three. The results screen already carries Play Again and both leaderboard
  // links, so a second way to say no would be a fourth thing competing for the same glance.
  // Regression guard: an earlier version shipped "Not now" AND "Already supported".
  it('offers exactly one call to action and one dismiss', () => {
    render(<CbatDonationNote url="https://ko-fi.com/x" onRecord={vi.fn()} />)

    expect(screen.getAllByRole('link')).toHaveLength(1)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('aria-label')).toBe('Dismiss')
    expect(screen.queryByRole('button', { name: /already supported|not now/i })).toBeNull()
  })

  // The denominator of the admin funnel stat. Reported on render rather than inferred from the
  // server offering the note, because the server decides that while the award overlay is still
  // covering the screen — a player who leaves there never saw the card.
  it('reports an impression once, on render', () => {
    const onRecord = vi.fn()
    const { rerender } = render(<CbatDonationNote url="https://ko-fi.com/x" onRecord={onRecord} />)
    expect(onRecord).toHaveBeenCalledWith('shown')

    // A re-render must not inflate the count.
    rerender(<CbatDonationNote url="https://ko-fi.com/x" onRecord={onRecord} />)
    expect(onRecord.mock.calls.filter(([a]) => a === 'shown')).toHaveLength(1)
  })

  it('reports no impression when there is no URL to show', () => {
    const onRecord = vi.fn()
    render(<CbatDonationNote url="" onRecord={onRecord} />)
    expect(onRecord).not.toHaveBeenCalled()
  })

  it('records a dismissal and disappears when waved away', () => {
    const onRecord = vi.fn()
    render(<CbatDonationNote url="https://ko-fi.com/x" onRecord={onRecord} />)

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onRecord).toHaveBeenCalledWith('dismissed')
    expect(screen.queryByTestId('cbat-donation-note')).toBeNull()
  })
})

// ── The sequencing, which is the actual design decision ──────────────────────────────────────
describe('CbatGameOver — award then, separately, the ask', () => {
  const claimUrl = '/progress-award/claim'

  function setup({ award = null, donate = null } = {}) {
    const apiFetch = vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u.includes(claimUrl)) return Promise.resolve({ ok: true, json: async () => ({ data: { award, donate } }) })
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) })
    })
    mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
    return apiFetch
  }

  const props = {
    gameKey: 'symbols', score: 14, scoreSaved: true, queued: false,
    personalBest: { bestScore: 15, attempts: 12 }, onPlayAgain: vi.fn(),
  }

  it('shows nothing extra when the server awards no milestone', async () => {
    setup()
    render(<CbatGameOver {...props}><div /></CbatGameOver>)
    await waitFor(() => expect(screen.queryByTestId('cbat-progress-award')).toBeNull())
    expect(screen.queryByTestId('cbat-donation-note')).toBeNull()
  })

  it('holds the ask back until the celebration has been dismissed', async () => {
    setup({ award: { tier: 30, pct: 34, attempts: 12 }, donate: { url: 'https://ko-fi.com/x' } })
    render(<CbatGameOver {...props}><div /></CbatGameOver>)

    // Celebration first, and alone — this ordering is the whole point of the two components.
    await waitFor(() => expect(screen.getByTestId('cbat-progress-award')).toBeDefined())
    expect(screen.queryByTestId('cbat-donation-note')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.queryByTestId('cbat-progress-award')).toBeNull()
    expect(screen.getByTestId('cbat-donation-note')).toBeDefined()
  })

  it('shows the award with no ask when the donation note is withheld', async () => {
    setup({ award: { tier: 15, pct: 18, attempts: 9 }, donate: null })
    render(<CbatGameOver {...props}><div /></CbatGameOver>)

    await waitFor(() => expect(screen.getByTestId('cbat-progress-award')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.queryByTestId('cbat-donation-note')).toBeNull()
  })

  // An offline run isn't in the server's series yet, so the improvement would be judged without
  // the run just played — the same reason the progress sparkline is skipped when queued.
  it('does not claim a milestone for a run that only queued offline', async () => {
    const apiFetch = setup({ award: { tier: 50, pct: 60, attempts: 20 } })
    render(<CbatGameOver {...props} scoreSaved={false} queued><div /></CbatGameOver>)

    await waitFor(() => expect(screen.getByText(/score saved on this device/i)).toBeDefined())
    expect(apiFetch.mock.calls.filter(([u]) => String(u).includes(claimUrl))).toHaveLength(0)
    expect(screen.queryByTestId('cbat-progress-award')).toBeNull()
  })

  // Google Play / App Store treat in-app donation links from a non-charity as a policy risk, so
  // the ask is web-only. The milestone itself is unaffected — it carries no store exposure.
  it('withholds the ask inside the native app but still celebrates the milestone', async () => {
    mockSlimApp.value = true
    try {
      setup({ award: { tier: 30, pct: 34, attempts: 12 }, donate: { url: 'https://ko-fi.com/x' } })
      render(<CbatGameOver {...props}><div /></CbatGameOver>)

      await waitFor(() => expect(screen.getByTestId('cbat-progress-award')).toBeDefined())
      fireEvent.click(screen.getByRole('button', { name: /continue/i }))
      expect(screen.queryByTestId('cbat-donation-note')).toBeNull()
    } finally {
      mockSlimApp.value = false
    }
  })

  // The admin preview must never touch real state: no claim burned, no donation prompt recorded.
  it('renders a previewed award without calling the server', async () => {
    const apiFetch = setup()
    render(
      <CbatGameOver
        {...props}
        previewAward={{ award: { tier: 50, pct: 61, attempts: 22 }, donate: { url: 'https://ko-fi.com/x' } }}
      >
        <div />
      </CbatGameOver>
    )

    expect(screen.getByTestId('cbat-progress-award')).toBeDefined()
    expect(screen.getByText('Huge improvement')).toBeDefined()
    expect(apiFetch.mock.calls.filter(([u]) => String(u).includes('progress-award'))).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(apiFetch.mock.calls.filter(([u]) => String(u).includes('progress-award'))).toHaveLength(0)
  })
})

// ── PostHog: shown → clicked as a funnel ─────────────────────────────────────────────────────
//
// Three distinct event names rather than one event with an `action` property, because PostHog
// funnels are built from distinct events and shown → clicked is the funnel worth having.
describe('CbatGameOver — donation ask analytics', () => {
  const claimUrl = '/progress-award/claim'

  function setup({ award = null, donate = null } = {}) {
    const apiFetch = vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u.includes(claimUrl)) return Promise.resolve({ ok: true, json: async () => ({ data: { award, donate } }) })
      return Promise.resolve({ ok: true, json: async () => ({ data: null }) })
    })
    mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
    return apiFetch
  }

  const props = {
    gameKey: 'symbols', score: 14, scoreSaved: true, queued: false,
    personalBest: { bestScore: 15, attempts: 12 }, onPlayAgain: vi.fn(),
  }

  const donationEvents = () => mockCapture.mock.calls.filter(([n]) => n.startsWith('donation_note_'))

  it('fires donation_note_shown with the game and the milestone behind it', async () => {
    setup({ award: { tier: 30, pct: 34, attempts: 12 }, donate: { url: 'https://ko-fi.com/x' } })
    render(<CbatGameOver {...props}><div /></CbatGameOver>)

    await waitFor(() => expect(screen.getByTestId('cbat-progress-award')).toBeDefined())
    // Nothing yet — the note is still behind the celebration, so nobody has seen it.
    expect(donationEvents()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(mockCapture).toHaveBeenCalledWith('donation_note_shown', {
      gameKey: 'symbols', awardTier: 30, awardPct: 34, awardAttempts: 12, score: 14,
    })
  })

  it('fires donation_note_clicked on the click-through and _dismissed on the ✕', async () => {
    setup({ award: { tier: 30, pct: 34, attempts: 12 }, donate: { url: 'https://ko-fi.com/x' } })
    const { unmount } = render(<CbatGameOver {...props}><div /></CbatGameOver>)

    await waitFor(() => expect(screen.getByTestId('cbat-progress-award')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('link', { name: /support skywatch/i }))

    expect(donationEvents().map(([n]) => n)).toEqual(['donation_note_shown', 'donation_note_clicked'])
    unmount()

    mockCapture.mockClear()
    setup({ award: { tier: 30, pct: 34, attempts: 12 }, donate: { url: 'https://ko-fi.com/x' } })
    render(<CbatGameOver {...props}><div /></CbatGameOver>)
    await waitFor(() => expect(screen.getByTestId('cbat-progress-award')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(donationEvents().map(([n]) => n)).toEqual(['donation_note_shown', 'donation_note_dismissed'])
  })

  // An admin checking the copy must not land in the funnel they are trying to read.
  it('sends nothing from the admin preview', async () => {
    setup()
    render(
      <CbatGameOver
        {...props}
        previewAward={{ award: { tier: 50, pct: 61, attempts: 22 }, donate: { url: 'https://ko-fi.com/x' } }}
      >
        <div />
      </CbatGameOver>
    )

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('link', { name: /support skywatch/i }))
    expect(donationEvents()).toHaveLength(0)
  })
})
