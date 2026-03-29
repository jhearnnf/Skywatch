import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const mockAwardAircoins = vi.hoisted(() => vi.fn())
const mockSetUser       = vi.hoisted(() => vi.fn())
const mockUseAuth       = vi.hoisted(() => vi.fn())
const mockNavigate      = vi.hoisted(() => vi.fn())

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => mockNavigate,
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { aircoinsPerBriefRead: 5 } }),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../../components/UpgradePrompt',          () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, onClick, style }) => <div className={className} onClick={onClick} style={style}>{children}</div>,
    button: ({ children, className, onClick })        => <button className={className} onClick={onClick}>{children}</button>,
    p:      ({ children, className })                 => <p className={className}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SINGLE_SECTION_BRIEF = {
  _id:                 'brief123',
  title:               'RAF Typhoon',
  subtitle:            'Air superiority fighter',
  category:            'Aircrafts',
  descriptionSections: ['The Typhoon is a swing-role combat aircraft.'],
  keywords:            [],
  sources:             [],
  media:               [],
}

const MULTI_SECTION_BRIEF = {
  ...SINGLE_SECTION_BRIEF,
  descriptionSections: [
    'Section one content.',
    'Section two content.',
    'Section three content.',
  ],
}

// readRecord: null  → guest (no auth, no record)
// readRecord: { coinsAwarded: false } → logged-in, first read (shows "Collect Aircoins" button)
// readRecord: { coinsAwarded: true }  → logged-in, already completed (shows plain "Complete Brief")
function makeGetResponse(brief, readRecord = null) {
  return { ok: true, json: async () => ({ data: { brief, readRecord, ammoMax: 3 } }) }
}
const FRESH_READ_RECORD     = { _id: 'rr1', coinsAwarded: false, completed: false }
const COMPLETED_READ_RECORD = { _id: 'rr1', coinsAwarded: true,  completed: true  }

function makeCompleteResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      status: 'success',
      data: {
        aircoinsEarned:   5,
        dailyCoinsEarned: 5,
        loginStreak:      1,
        newTotalAircoins: 10,
        newCycleAircoins: 10,
        rankPromotion:    null,
        ...overrides,
      },
    }),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

function setupLoggedIn() {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1', loginStreak: 0 },
    API:           '',
    awardAircoins: mockAwardAircoins,
    setUser:       mockSetUser,
  })
}

function setupGuest() {
  mockUseAuth.mockReturnValue({
    user:          null,
    API:           '',
    awardAircoins: mockAwardAircoins,
    setUser:       mockSetUser,
  })
}

describe('BriefReader — complete brief coin awarding', () => {
  beforeEach(() => {
    setupLoggedIn()
    mockAwardAircoins.mockClear()
    mockSetUser.mockClear()
    sessionStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('does NOT call awardAircoins on mount (coins deferred to complete)', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    expect(mockAwardAircoins).not.toHaveBeenCalled()
  })

  it('GET /api/briefs/:id is called on mount without calling /complete', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    const calls = global.fetch.mock.calls.map(c => c[0])
    expect(calls.some(u => u.includes('/api/briefs/brief123') && !u.includes('/complete'))).toBe(true)
    expect(calls.some(u => u.includes('/complete'))).toBe(false)
  })

  it('calls POST /api/briefs/:id/complete when "Complete Brief" is clicked', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) }) // wta-spawn
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue({ ok: true, json: async () => ({}) })

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
      const completeCall = calls.find(([url]) => url.includes('/complete'))
      expect(completeCall).toBeDefined()
      expect(completeCall[1].method).toBe('POST')
    })
  })

  it('calls awardAircoins with combined coins after completing', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValue(makeCompleteResponse({ aircoinsEarned: 5, dailyCoinsEarned: 5 }))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => {
      expect(mockAwardAircoins).toHaveBeenCalledWith(
        10,              // briefCoins(5) + dailyCoins(5)
        'Daily Brief',   // label when dailyCoins > 0
        expect.objectContaining({ cycleAfter: 10, totalAfter: 10 })
      )
    })
  })

  it('uses "Brief read" label when only brief-read coins (no daily coins)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValue(makeCompleteResponse({ aircoinsEarned: 5, dailyCoinsEarned: 0 }))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => {
      expect(mockAwardAircoins).toHaveBeenCalledWith(
        5,
        'Brief read',
        expect.anything()
      )
    })
  })

  it('does NOT call awardAircoins when complete returns 0 coins (idempotent re-complete)', async () => {
    // coinsAwarded:true but completed:false → reading screen, not AlreadyReadScreen
    const coinsAwardedRecord = { _id: 'rr1', coinsAwarded: true, completed: false }
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF, coinsAwardedRecord))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) }) // wta-spawn
      .mockResolvedValueOnce(makeCompleteResponse({ aircoinsEarned: 0, dailyCoinsEarned: 0 }))
      .mockResolvedValue({ ok: true, json: async () => ({}) })

    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))

    await waitFor(() => {
      // fetch was called but awardAircoins should NOT be called for 0 total
      expect(mockAwardAircoins).not.toHaveBeenCalled()
    })
  })

  it('updates loginStreak on user via setUser after complete', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValue(makeCompleteResponse({ loginStreak: 3 }))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => {
      expect(mockSetUser).toHaveBeenCalled()
      // The updater fn sets loginStreak: 3
      const updater = mockSetUser.mock.calls[0][0]
      const result  = updater({ _id: 'user1', loginStreak: 0 })
      expect(result.loginStreak).toBe(3)
    })
  })

  // ── Button text variants ─────────────────────────────────────────────────

  it('logged-in user with coins not yet awarded sees "⭐ Complete Brief & Collect Aircoins"', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF, FRESH_READ_RECORD))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
  })

  it('logged-in user who already collected coins sees plain "✓ Complete Brief"', async () => {
    // coinsAwarded:true but completed:false → reading screen shows plain Complete button
    const coinsAwardedRecord = { _id: 'rr1', coinsAwarded: true, completed: false }
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF, coinsAwardedRecord))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    expect(screen.queryByText('⭐ Complete Brief & Collect Aircoins')).toBeNull()
  })

  it('guest user sees plain "✓ Complete Brief" (no aircoins to collect)', async () => {
    setupGuest()
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    expect(screen.queryByText('⭐ Complete Brief & Collect Aircoins')).toBeNull()
  })

  it('clicking "Continue →" on a non-last section does NOT call /complete', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(MULTI_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('Continue →'))

    fireEvent.click(screen.getByText('Continue →'))

    // Only the initial GET should have been called — no /complete
    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => c[0])
      expect(calls.some(u => u.includes('/complete'))).toBe(false)
    })
    expect(mockAwardAircoins).not.toHaveBeenCalled()
  })

  it('shows completion screen after clicking "Complete Brief"', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) }) // wta-spawn
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue({ ok: true, json: async () => ({}) })

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => expect(screen.getByText('Brief Complete!')).toBeDefined())
  })
})

// ── Guest sign-in prompt ──────────────────────────────────────────────────────

describe('BriefReader — guest completion prompt', () => {
  beforeEach(() => {
    setupGuest()
    sessionStorage.clear()
    localStorage.clear()
    // Prevent "First Brief — Mission Complete!" heading for logged-in user tests in this block
    localStorage.setItem('skywatch_first_brief', '1')
    mockNavigate.mockClear()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    window.google = {
      accounts: { id: { initialize: vi.fn(), prompt: vi.fn(), renderButton: vi.fn() } },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    delete window.google
  })

  async function completeAsGuest() {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))
    await waitFor(() => screen.getByText('Brief Complete!'))
  }

  it('guest sees "Don\'t lose this progress" sign-up panel after completing a brief', async () => {
    await completeAsGuest()
    expect(screen.getByText('Don\'t lose this progress')).toBeDefined()
  })

  it('guest sees investment hook with coin reward', async () => {
    await completeAsGuest()
    expect(screen.getByText('5 Aircoins waiting to be claimed')).toBeDefined()
  })

  it('guest sees email input and Continue button', async () => {
    await completeAsGuest()
    expect(screen.getByPlaceholderText('your@email.com')).toBeDefined()
    expect(screen.getByText('Continue →')).toBeDefined()
  })

  it('guest does not see the quiz button', async () => {
    await completeAsGuest()
    expect(screen.queryByText(/Take the Quiz/)).toBeNull()
  })

  it('guest clicking Continue without email navigates to /login?tab=register with pendingBrief param', async () => {
    await completeAsGuest()
    fireEvent.click(screen.getByText('Continue →'))
    expect(mockNavigate).toHaveBeenCalledWith('/login?tab=register&pendingBrief=brief123')
  })

  it('guest clicking Continue with email pre-fills the URL', async () => {
    await completeAsGuest()
    const input = screen.getByPlaceholderText('your@email.com')
    fireEvent.change(input, { target: { value: 'agent@raf.mod.uk' } })
    fireEvent.click(screen.getByText('Continue →'))
    expect(mockNavigate).toHaveBeenCalledWith(
      '/login?tab=register&pendingBrief=brief123&email=agent%40raf.mod.uk'
    )
  })

  it('saves pending brief to localStorage', async () => {
    await completeAsGuest()
    fireEvent.click(screen.getByText('Continue →'))
    expect(localStorage.getItem('sw_pending_brief')).toBe('brief123')
  })

  it('saves pending brief to localStorage and navigates to /login?tab=signin with pendingBrief param', async () => {
    await completeAsGuest()
    fireEvent.click(screen.getByText('Sign in'))
    expect(localStorage.getItem('sw_pending_brief')).toBe('brief123')
    expect(mockNavigate).toHaveBeenCalledWith('/login?tab=signin&pendingBrief=brief123')
  })

  it('Google One Tap prompt is called on mount for guests', async () => {
    await completeAsGuest()
    expect(window.google.accounts.id.prompt).toHaveBeenCalled()
  })

  // For logged-in user tests: SINGLE_SECTION_BRIEF has category 'Aircrafts', which triggers
  // a wta-spawn fetch after the brief loads. Fetch order: brief → wta-spawn → /complete → ...
  const SAFE_EMPTY = { ok: true, json: async () => ({ data: {} }) }

  it('Google One Tap is NOT called for logged-in users', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(SAFE_EMPTY)           // wta-spawn
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(SAFE_EMPTY)               // boo-options, quiz-status, spawn-check
    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    await waitFor(() => screen.getByText('Brief Complete!'))
    expect(window.google.accounts.id.prompt).not.toHaveBeenCalled()
  })

  it('logged-in user does NOT see the sign-up panel', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(SAFE_EMPTY)           // wta-spawn
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(SAFE_EMPTY)               // boo-options, quiz-status, spawn-check
    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    await waitFor(() => screen.getByText('Brief Complete!'))
    expect(screen.queryByText('Don\'t lose this progress')).toBeNull()
  })

  it('logged-in user sees the quiz button', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(SAFE_EMPTY)           // wta-spawn
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(SAFE_EMPTY)               // boo-options, quiz-status, spawn-check
    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    await waitFor(() => expect(screen.getByText(/Take the Quiz/)).toBeDefined())
  })
})

// ── First-brief heading ───────────────────────────────────────────────────────

describe('BriefReader — first brief detection', () => {
  beforeEach(() => {
    setupLoggedIn()
    mockAwardAircoins.mockClear()
    sessionStorage.clear()
    localStorage.removeItem('skywatch_first_brief')
  })

  afterEach(() => { vi.restoreAllMocks() })

  // Fetch order for Aircrafts-category briefs with logged-in user:
  //   brief → wta-spawn → /complete → boo-options + quiz-status (concurrent) → spawn-check
  const WTA_SPAWN_EMPTY = { ok: true, json: async () => ({ data: null }) }
  const CATCH_ALL       = { ok: true, json: async () => ({}) }

  it('shows "Mission Complete" heading on first ever brief completion', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(WTA_SPAWN_EMPTY)
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(CATCH_ALL)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => expect(screen.getByText('🎖️ First Brief — Mission Complete!')).toBeDefined())
  })

  it('shows standard "Brief Complete!" heading when not the first brief', async () => {
    localStorage.setItem('skywatch_first_brief', '1')
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(WTA_SPAWN_EMPTY)
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(CATCH_ALL)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => expect(screen.getByText('Brief Complete!')).toBeDefined())
    expect(screen.queryByText('🎖️ First Brief — Mission Complete!')).toBeNull()
  })

  it('sets skywatch_first_brief in localStorage after first completion', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(WTA_SPAWN_EMPTY)
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(CATCH_ALL)

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => screen.getByText('🎖️ First Brief — Mission Complete!'))
    expect(localStorage.getItem('skywatch_first_brief')).toBe('1')
  })
})

// ── Post-login brief completion ───────────────────────────────────────────────

describe('BriefReader — post-login brief completion', () => {
  beforeEach(() => {
    setupLoggedIn()
    mockAwardAircoins.mockClear()
    mockSetUser.mockClear()
    sessionStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('shows completion screen immediately when sw_brief_just_completed matches briefId', async () => {
    sessionStorage.setItem('sw_brief_just_completed', 'brief123')
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)

    await waitFor(() => expect(screen.getByText('Brief Complete!')).toBeDefined())
    // Should NOT show the reading UI (neither button text variant)
    expect(screen.queryByText(/Complete Brief/)).toBeNull()
  })

  it('calls awardAircoins with coin data from sw_brief_coins on mount', async () => {
    sessionStorage.setItem('sw_brief_just_completed', 'brief123')
    sessionStorage.setItem('sw_brief_coins', JSON.stringify({
      aircoinsEarned:   5,
      dailyCoinsEarned: 5,
      newTotalAircoins: 10,
      newCycleAircoins: 10,
      rankPromotion:    null,
    }))
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)

    await waitFor(() => {
      expect(mockAwardAircoins).toHaveBeenCalledWith(
        10,
        'Daily Brief',
        expect.objectContaining({ cycleAfter: 10, totalAfter: 10 })
      )
    })
  })

  it('clears sw_brief_coins after consuming it', async () => {
    sessionStorage.setItem('sw_brief_just_completed', 'brief123')
    sessionStorage.setItem('sw_brief_coins', JSON.stringify({
      aircoinsEarned: 5, dailyCoinsEarned: 0, newTotalAircoins: 5, newCycleAircoins: 5,
    }))
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)

    await waitFor(() => expect(mockAwardAircoins).toHaveBeenCalled())
    expect(sessionStorage.getItem('sw_brief_coins')).toBeNull()
  })

  it('does not show completion screen when sw_brief_just_completed is for a different brief', async () => {
    sessionStorage.setItem('sw_brief_just_completed', 'other-brief')
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)

    await waitFor(() => screen.getByText('RAF Typhoon'))
    expect(screen.queryByText('Brief Complete!')).toBeNull()
    expect(screen.getByText('⭐ Complete Brief & Collect Aircoins')).toBeDefined()
  })
})

// ── BriefReader — BOO button state on completion screen ───────────────────

describe('BriefReader — BOO button on completion screen', () => {
  function makeBooResponse(available) {
    return { ok: true, json: async () => ({ data: { available, options: [] } }) }
  }
  function makeQuizStatusResponse(hasCompleted) {
    return { ok: true, json: async () => ({ data: { hasCompleted } }) }
  }

  beforeEach(() => {
    setupLoggedIn()
    sessionStorage.clear()
    // Prevent "First Brief — Mission Complete!" heading — these tests check for 'Brief Complete!'
    localStorage.setItem('skywatch_first_brief', '1')
  })
  afterEach(() => vi.restoreAllMocks())

  // Actual fetch call order for Aircrafts-category briefs with logged-in user:
  //   brief (1) → wta-spawn (2) → /complete (3) → /quiz/status (4) → /boo-options (5) → spawn-check (6+)
  // check() calls quiz/status first, then options, then (if available) boo-status.
  // wta-spawn fires from useEffect when brief+user both resolve (Aircrafts category only).
  // spawn-check fires inside /complete's .then() chain — safe to leave unmocked (caught by .catch).
  const WTA_SPAWN_EMPTY = { ok: true, json: async () => ({ data: null }) }

  it('shows active BOO button when BOO available and quiz passed', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(WTA_SPAWN_EMPTY)
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValueOnce(makeQuizStatusResponse(true))             // quiz/status first
      .mockResolvedValueOnce(makeBooResponse(true))                    // then options
      .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }) // boo-status + spawn-check catch-all

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => screen.getByText('Brief Complete!'))
    await waitFor(() => {
      const btn = screen.getByText('🗺️ Battle Order → Earn Aircoins', { selector: 'button' })
      expect(btn).not.toBeDisabled()
    })
  })

  it('shows locked BOO button when BOO available but quiz not yet passed', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(WTA_SPAWN_EMPTY)
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValueOnce(makeQuizStatusResponse(false))            // quiz/status first
      .mockResolvedValueOnce(makeBooResponse(true))                    // then options (available:true to exercise locked-quiz path)
      .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => screen.getByText('Brief Complete!'))
    await waitFor(() => {
      expect(screen.getByText('🔒 Pass the quiz first')).toBeDefined()
      const lockedBtn = screen.getByText('🔒 Pass the quiz first').closest('button')
      expect(lockedBtn).toBeDisabled()
    })
  })

  it('hides BOO button entirely when BOO not available for this category', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(WTA_SPAWN_EMPTY)
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValueOnce(makeBooResponse(false))
      .mockResolvedValueOnce(makeQuizStatusResponse(true))
      .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => screen.getByText('Brief Complete!'))
    expect(screen.queryByText(/battle order/i)).toBeNull()
  })
})
