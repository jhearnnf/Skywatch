import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Admin from '../Admin'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'admin1', isAdmin: true, subscriptionTier: 'gold' },
    loading: false,
    API: '',
    apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('../../context/UnsolvedReportsContext', () => ({
  useUnsolvedReports: () => ({ unsolvedCount: 0, unresolvedSystemLogs: 0, refresh: vi.fn() }),
}))

// Mutable so a test can flip slim mode — the Stats tab greys out the stats that measure
// surfaces CBAT-only mode removes.
const mockAppSettings = vi.hoisted(() => ({ value: {} }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({
    settings: mockAppSettings.value, levels: [], levelThresholds: [], loading: false, refreshSettings: vi.fn(),
  }),
}))

vi.mock('../../context/NewCategoryUnlockContext', () => ({
  useNewCategoryUnlock: () => ({ pending: null, clear: vi.fn() }),
}))

vi.mock('../../components/RankBadge', () => ({ default: () => null }))
vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('../../context/AppTutorialContext', () => ({
  TUTORIAL_STEPS: {},
  TUTORIAL_KEYS: {},
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: () => true }),
}))

vi.mock('../../utils/sound', () => ({
  invalidateSoundSettings: vi.fn(), previewTypingSound: vi.fn(), previewGridRevealTone: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, ...r }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled, ...r }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_STATS = {
  users: {
    totalUsers: 10, onlineUsers: 3, freeUsers: 5, trialUsers: 2, subscribedUsers: 3,
    easyPlayers: 6, mediumPlayers: 4, combinedStreaks: 20,
    androidAppUsers: 4,
    emailsSent: 42, emailsFailed: 7,
    questionnaire: { sent: 20, started: 8, completed: 5 },
    donation: {
      seen: 40, clicked: 6,
      card:   { seen: 34, clicked: 4 },
      survey: { seen: 8,  clicked: 2 },
      page:   { visits: 25, checkouts: 5 },
      received: { donors: 3, totalPence: 4250 },
    },
  },
  games: {
    totalGamesPlayed: 50, totalGamesCompleted: 40, totalGamesWon: 30,
    totalPerfectScores: 5, totalGamesLost: 10, totalGamesAbandoned: 10,
    totalAirstarsEarned: 5000, quizTotalSeconds: 3600,
    boo:          { total: 5, won: 3, defeated: 1, abandoned: 1, totalSeconds: 600 },
    wta:          { total: 4, won: 2, abandoned: 1, round1Correct: 3, round2Correct: 2, totalSeconds: 300 },
    flashcard:    { sessions: 8, totalCards: 40, recalled: 30, abandoned: 2, totalSeconds: 200 },
    aptitudeSync: { total: 3, completed: 2, abandoned: 1, airstarsEarned: 120 },
  },
  briefs: { totalBrifsRead: 80, totalBrifsOpened: 120, totalReadSeconds: 10000 },
  tutorials: { viewed: 5, skipped: 2 },
  server: { serverUptimeSeconds: 3600, totalLoadingMs: 50000 },
}

const MOCK_OPENROUTER = {
  status: 'success',
  data: {
    main:      { today: 0.5,  todayCalls: 10, lifetime: 12.34 },
    aptitude:  { today: 0.1,  todayCalls: 3,  lifetime: 1.23  },
    socials:   { today: 0.05, todayCalls: 2,  lifetime: 0.75  },
    casefiles: { today: 0.07, todayCalls: 4,  lifetime: 5.67  },
  },
}

const MOCK_FUNNEL = [
  { _id: 'u1', agentNumber: 101, displayName: 'Maverick', email: 'mav@example.com', impressionCount: 2, clickCount: 1, dismissCount: 0, lastShownAt: '2026-08-01T10:00:00.000Z', surveyAsked: false, surveyClicked: false, surveyAskedAt: null, pageVisited: true, pageCheckout: true, pageVisitedAt: '2026-08-01T10:05:00.000Z' },
  { _id: 'u2', agentNumber: 102, displayName: 'Goose',    email: 'goose@example.com', impressionCount: 3, clickCount: 0, dismissCount: 2, lastShownAt: '2026-07-30T10:00:00.000Z', surveyAsked: true, surveyClicked: false, surveyAskedAt: '2026-07-31T10:00:00.000Z', pageVisited: false, pageCheckout: false, pageVisitedAt: null },
]

function setupFetch() {
  return vi.fn().mockImplementation((url) => {
    // Ahead of the /api/admin/stats branch below — the drill-down URL is a prefix match on it.
    if (url.includes('/api/admin/stats/donation-funnel')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: MOCK_FUNNEL } }) })
    }
    if (url.includes('/api/admin/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: MOCK_STATS }) })
    }
    if (url.includes('/api/admin/openrouter/summary')) {
      return Promise.resolve({ ok: true, json: async () => MOCK_OPENROUTER })
    }
    if (url.includes('/api/admin/problems/count')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { unsolvedCount: 0 } }) })
    }
    if (url.includes('/api/admin/email-logs')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { logs: [], total: 0, totalPages: 1 } }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Admin — Stats tab: donation funnel', () => {
  beforeEach(() => { global.fetch = setupFetch(); mockAppSettings.value = {} })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows clicked-through over asked, with the rate', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Donation Asks')).toBeInTheDocument())
    expect(screen.getByText('6 / 40')).toBeInTheDocument()
    expect(screen.getByText(/15% of those asked clicked through/)).toBeInTheDocument()
  })

  // The one figure here that is money rather than intent, and the reason the row exists:
  // every other count stops at a click, and a started Checkout session is not a payment.
  it('leads with what was actually received', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Donations Received')).toBeInTheDocument())
    expect(screen.getByText('£43')).toBeInTheDocument()
    expect(screen.getByText(/from 3 donors/)).toBeInTheDocument()
  })

  // Four ratio tiles in a row meant reading "6 / 40" and then working out for yourself that it
  // was the UNION of the two beneath it, not the sum. The split is still there, one click down.
  it('keeps the per-surface split out of the row, and in the drill-down', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Donation Asks')).toBeInTheDocument())
    expect(screen.queryByText('Post-game note')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Donation Asks'))

    await waitFor(() => expect(screen.getByText('Where the asks landed')).toBeInTheDocument())
    expect(screen.getByText('Post-game note')).toBeInTheDocument()
    expect(screen.getByText(/12% clicked/)).toBeInTheDocument()
    expect(screen.getByText('Questionnaire')).toBeInTheDocument()
    expect(screen.getByText(/25% clicked/)).toBeInTheDocument()
    expect(screen.getByText('Donate page')).toBeInTheDocument()
    expect(screen.getByText(/20% reached Stripe/)).toBeInTheDocument()
  })

  // A zero denominator must read as "nobody has been asked" rather than dividing by zero into NaN%.
  it('says so plainly before anyone has been asked', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/admin/stats')) {
        return Promise.resolve({ ok: true, json: async () => ({
          status: 'success',
          data: { ...MOCK_STATS, users: { ...MOCK_STATS.users, donation: undefined } },
        }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<Admin />)
    await waitFor(() => expect(screen.getByText('Donation Asks')).toBeInTheDocument())
    expect(screen.getByText(/nobody has been asked yet/)).toBeInTheDocument()
    expect(screen.getByText('£0')).toBeInTheDocument()
    expect(screen.getByText(/nobody has donated yet/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Donation Asks'))

    await waitFor(() => expect(screen.getByText('Where the asks landed')).toBeInTheDocument())
    expect(screen.getByText(/no visits to .donate yet/)).toBeInTheDocument()
    expect(screen.getByText(/not shown yet/)).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })

  // The tile is a summary of people, so it has to be able to name them.
  it('opens the list of who saw and who clicked when the tile is clicked', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Donation Asks')).toBeInTheDocument())
    expect(screen.queryByText('Maverick')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Donation Asks'))

    await waitFor(() => expect(screen.getByText('Maverick')).toBeInTheDocument())
    expect(screen.getByText('Goose')).toBeInTheDocument()
    expect(screen.getByText('clicked')).toBeInTheDocument()
    // Each person's row names the asks that actually reached them.
    expect(screen.getByText(/post-game ×2 \(clicked ×1\) · donate page \(checkout\)/)).toBeInTheDocument()
    expect(screen.getByText(/post-game ×3 · dismissed ×2 · questionnaire/)).toBeInTheDocument()
    // Someone who was only ever asked must not read as a click-through.
    expect(screen.getByText('asked only')).toBeInTheDocument()
  })

  it('closes the list again on a second click', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Donation Asks')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Donation Asks'))
    await waitFor(() => expect(screen.getByText('Maverick')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Donation Asks'))
    await waitFor(() => expect(screen.queryByText('Maverick')).not.toBeInTheDocument())
  })
})

describe('Admin — Stats tab: Android app users', () => {
  beforeEach(() => { global.fetch = setupFetch(); mockAppSettings.value = {} })
  afterEach(() => { vi.restoreAllMocks(); mockAppSettings.value = {} })

  it('shows how many accounts have ever used the app, as a share of everyone', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Android App Users')).toBeInTheDocument())
    const card = screen.getByText('Android App Users').closest('div')
    expect(within(card).getByText('4')).toBeInTheDocument()
    expect(within(card).getByText(/40% of all accounts/)).toBeInTheDocument()
  })

  // It sits beside Users Online — same question, who is actually here and on what — which
  // means the same grid row, not just somewhere on the page.
  it('sits in the same row as Users Online', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    const row = (label) => screen.getByText(label).closest('.grid')
    expect(row('Android App Users')).toBe(row('Users Online'))
  })

  // Drawn, not typed: 🤖 is a generic grey robot on Windows rather than the Android mascot.
  // It is the card's background — absolutely positioned and clipped, so however big it gets
  // the card keeps the standard size, and the text stays above it.
  it('carries the Android glyph as a background without changing the card size', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Android App Users')).toBeInTheDocument())
    const card = screen.getByText('Android App Users').closest('[class*="rounded-2xl"]')
    expect(card.className).toContain('min-h-[5.75rem]')
    expect(card.className).toContain('overflow-hidden')

    const glyph = card.querySelector('svg').closest('span')
    expect(glyph.className).toContain('absolute')
    expect(glyph.className).toContain('pointer-events-none')

    // Exactly half of it shows: the layer starts at the card's right edge and moves out by
    // half its own width, so the card clips the right half and the cut lands on the border.
    // A translate rather than a per-size negative offset, so it stays half at every size.
    expect(glyph.className).toContain('right-0')
    expect(glyph.className).toContain('translate-x-1/2')
    expect(glyph.className).toContain('bottom-0')

    // Text sits on its own stacking context above the watermark, not behind it.
    expect(screen.getByText('Android App Users').className).toContain('relative')
  })

  // The app is the CBAT-only experience, so this one keeps counting when the rest of the
  // row greys out — and a backend that predates the field must show an honest zero.
  it('stays live in CBAT-only mode and survives a payload without the field', async () => {
    mockAppSettings.value = { slimModeEnabled: true }
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/admin/stats')) {
        return Promise.resolve({ ok: true, json: async () => ({
          status: 'success',
          data: { ...MOCK_STATS, users: { ...MOCK_STATS.users, androidAppUsers: undefined } },
        }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Android App Users')).toBeInTheDocument())
    expect(screen.getByText('Android App Users').closest('[aria-disabled="true"]')).toBeNull()
    expect(screen.getByText(/0% of all accounts/)).toBeInTheDocument()
  })
})

describe('Admin — Stats tab: current time', () => {
  beforeEach(() => { global.fetch = setupFetch(); mockAppSettings.value = {} })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows a 24-hour wall clock with seconds', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Current Time')).toBeInTheDocument())
    // Seconds are the point — a clock without them looks broken rather than idle.
    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeInTheDocument()
  })

  it('advances on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<Admin />)
      await waitFor(() => expect(screen.getByText('Current Time')).toBeInTheDocument())
      const first = screen.getByText(/^\d{2}:\d{2}:\d{2}$/).textContent

      await vi.advanceTimersByTimeAsync(2500)
      expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/).textContent).not.toBe(first)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Admin — Stats tab: CBAT-only mode', () => {
  beforeEach(() => { global.fetch = setupFetch(); mockAppSettings.value = {} })
  afterEach(() => { vi.restoreAllMocks(); mockAppSettings.value = {} })

  const SLIM_HIDDEN = ['Free', 'Trial', 'Paying Subscribers', 'Easy Mode', 'Medium Mode', 'Combined Streaks']

  it('shows the full-site stats normally', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    for (const label of SLIM_HIDDEN) {
      expect(screen.getByText(label).closest('[aria-disabled]')).toBeNull()
    }
    expect(screen.queryByText(/not used in CBAT-only mode/)).not.toBeInTheDocument()
  })

  // Frozen-looking cards with no explanation read as "we have zero paying users", which is a very
  // different message from "this cannot move while the site is CBAT-only".
  it('greys out the stats whose surfaces slim mode removes, and says why', async () => {
    mockAppSettings.value = { slimModeEnabled: true }
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    for (const label of SLIM_HIDDEN) {
      expect(screen.getByText(label).closest('[aria-disabled="true"]')).not.toBeNull()
    }
    expect(screen.getAllByText(/not used in CBAT-only mode/)).toHaveLength(SLIM_HIDDEN.length)
  })

  // Users Online and the donation funnel both still move in CBAT-only mode.
  it('leaves the CBAT-relevant stats alone', async () => {
    mockAppSettings.value = { slimModeEnabled: true }
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    expect(screen.getByText('Users Online').closest('[aria-disabled="true"]')).toBeNull()
    expect(screen.getByText('Donation Asks').closest('[aria-disabled="true"]')).toBeNull()
  })
})

describe('Admin — Stats tab: card sizing', () => {
  beforeEach(() => { global.fetch = setupFetch(); mockAppSettings.value = {} })
  afterEach(() => { vi.restoreAllMocks() })

  const card = (label) => screen.getByText(label).closest('[class*="rounded-2xl"]')

  // Cards are one standard size whether or not they carry a sub line. min-h sets that size;
  // h-full lets a card grow with its row when a neighbour needs more. Without min-h, a card
  // with no sub was a line shorter than one with, and since each row of the page is its own
  // grid container, nothing equalised them.
  it('gives every card the same size floor, sub line or not', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    for (const label of ['Free', 'Android App Users', 'Emails Sent', 'Questionnaires']) {
      expect(card(label).className).toContain('min-h-[5.75rem]')
      expect(card(label).className).toContain('h-full')
    }
  })

  // A card inside a clickable wrapper has to stretch with it. The button is the grid item and
  // stretches to the row; without these the card inside stayed at its own content height and
  // sat visibly short next to an unwrapped one.
  it('stretches the cards that sit inside a button', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    for (const label of ['Users Online', 'Emails Sent', 'Emails Failed', 'Donation Asks']) {
      const button = card(label).closest('button')
      expect(button.className).toContain('flex w-full')
      expect(button.className).toContain('[&>div]:flex-1')
    }
  })
})

describe('Admin — Stats tab: email card glyphs', () => {
  beforeEach(() => { global.fetch = setupFetch(); mockAppSettings.value = {} })
  afterEach(() => { vi.restoreAllMocks() })

  const card = (label) => screen.getByText(label).closest('[class*="rounded-2xl"]')

  it('watermarks both email cards with an envelope, tinted to each card', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Emails Sent')).toBeInTheDocument())
    // The light end of each card's own hue: the text colours they would otherwise inherit
    // are dark and vanish at watermark opacity.
    expect(card('Emails Sent').querySelector('rect').getAttribute('fill')).toBe('#82c4ff')
    expect(card('Emails Failed').querySelector('rect').getAttribute('fill')).toBe('#f87171')
  })

  // The questionnaire is a survey stat that happens to arrive by email, not an email stat —
  // giving it the envelope too would say the row is three of the same thing.
  it('leaves the questionnaire card unmarked', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Questionnaires')).toBeInTheDocument())
    expect(card('Questionnaires').querySelector('svg')).toBeNull()
  })
})

describe('Admin — Stats tab: outreach questionnaire', () => {
  beforeEach(() => { global.fetch = setupFetch(); mockAppSettings.value = {} })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows completed questionnaires over invites sent, with the response rate', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Questionnaires')).toBeInTheDocument())
    expect(screen.getByText('5 / 20')).toBeInTheDocument()
    expect(screen.getByText('25% filled in')).toBeInTheDocument()
  })

  // The card is content-height and sits beside two others in a 4-up grid, so a label or sub
  // that wraps to a second line makes it visibly taller than its neighbours. Both stay short.
  it('keeps the label and sub to one line each', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Questionnaires')).toBeInTheDocument())
    expect(screen.getByText('Questionnaires').textContent.length).toBeLessThanOrEqual(16)
    expect(screen.getByText('25% filled in').textContent.length).toBeLessThanOrEqual(20)
  })

  it('says nobody has been emailed rather than showing a rate out of zero', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/admin/stats/donation-funnel')) {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [] } }) })
      }
      if (url.includes('/api/admin/stats')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            data: { ...MOCK_STATS, users: { ...MOCK_STATS.users, questionnaire: { sent: 0, started: 0, completed: 0 } } },
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Questionnaires')).toBeInTheDocument())
    expect(screen.getByText('nobody emailed yet')).toBeInTheDocument()
  })

  // A backend that has not shipped the block yet must show honest zeroes, not crash the tab.
  it('survives a stats payload with no questionnaire block', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/admin/stats/donation-funnel')) {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: { users: [] } }) })
      }
      if (url.includes('/api/admin/stats')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            data: { ...MOCK_STATS, users: { ...MOCK_STATS.users, questionnaire: undefined } },
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Questionnaires')).toBeInTheDocument())
    expect(screen.getByText('0 / 0')).toBeInTheDocument()
  })
})

describe('Admin — Stats tab: collapsible sections', () => {
  beforeEach(() => { global.fetch = setupFetch(); mockAppSettings.value = {} })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders the Users section open and OpenRouter Spend closed by default', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    expect(screen.getByText('OpenRouter Spend')).toBeInTheDocument()
    expect(screen.queryByText('$12.34')).not.toBeInTheDocument()     // OpenRouter lifetime main
  })

  it('expands OpenRouter Spend when its header is clicked', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    fireEvent.click(screen.getByText('OpenRouter Spend'))

    await waitFor(() => expect(screen.getByText('$12.34')).toBeInTheDocument())     // OpenRouter lifetime main
  })

  it('renders TODAY and LIFETIME tiles for the casefiles key', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users Online')).toBeInTheDocument())
    fireEvent.click(screen.getByText('OpenRouter Spend'))

    await waitFor(() => expect(screen.getByText('$5.67')).toBeInTheDocument())     // casefiles lifetime
    // Two casefiles tiles (TODAY + LIFETIME) — find them via the shared label
    const labels = screen.getAllByText('casefiles')
    expect(labels.length).toBe(2)
  })

  it('renders Intel Recall/BOO/WTA/Flashcard/Aptitude sections closed by default', async () => {
    render(<Admin />)

    // Wait for stats to load before asserting hidden content
    await waitFor(() => expect(screen.getByText('Users')).toBeInTheDocument())

    // Section headers are visible, but their unique body labels are not
    expect(screen.getByText('Intel Recall')).toBeInTheDocument()
    expect(screen.queryByText('Perfect Score')).not.toBeInTheDocument()  // Intel Recall-only label
    expect(screen.queryByText('Defeated')).not.toBeInTheDocument()       // BOO-only label
    expect(screen.queryByText('R1 Correct (ID)')).not.toBeInTheDocument()// WTA-only label
    expect(screen.queryByText('Cards Total')).not.toBeInTheDocument()    // Flashcard-only label
    expect(screen.queryByText('Airstars Earned')).not.toBeInTheDocument()// Aptitude Sync-only label
  })

  it('expands Intel Recall section when its header is clicked', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Users')).toBeInTheDocument())
    expect(screen.queryByText('Perfect Score')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Intel Recall'))
    expect(screen.getByText('Perfect Score')).toBeInTheDocument()
  })

  it('renders Emails Sent and Emails Failed cards with correct values', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Emails Sent')).toBeInTheDocument())
    expect(screen.getByText('Emails Failed')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument() // emailsSent
    expect(screen.getByText('7')).toBeInTheDocument()  // emailsFailed
  })

  it('clicking Emails Sent navigates to Intel → Email Logs with status=sent', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Emails Sent')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Emails Sent').closest('button'))

    // Intel tab → Email Logs sub is now active; status filter dropdown defaults to 'sent'
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Email Logs' })).toBeInTheDocument())
    const statusSelect = screen.getByDisplayValue('Sent')
    expect(statusSelect.value).toBe('sent')
  })

  it('clicking Emails Failed navigates to Intel → Email Logs with status=failed', async () => {
    render(<Admin />)

    await waitFor(() => expect(screen.getByText('Emails Failed')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Emails Failed').closest('button'))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Email Logs' })).toBeInTheDocument())
    const statusSelect = screen.getByDisplayValue('Failed')
    expect(statusSelect.value).toBe('failed')
  })
})
