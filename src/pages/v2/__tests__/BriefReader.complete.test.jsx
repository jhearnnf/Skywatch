import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const mockAwardAircoins = vi.hoisted(() => vi.fn())
const mockSetUser       = vi.hoisted(() => vi.fn())
const mockUseAuth       = vi.hoisted(() => vi.fn())

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
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
      .mockResolvedValueOnce(makeCompleteResponse())

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
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF, COMPLETED_READ_RECORD))
      .mockResolvedValueOnce(makeCompleteResponse({ aircoinsEarned: 0, dailyCoinsEarned: 0 }))

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
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF, COMPLETED_READ_RECORD))
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
      .mockResolvedValueOnce(makeCompleteResponse())

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
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('guest sees sign-in prompt after completing a brief', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))

    await waitFor(() => expect(screen.getByText('💾 Save your progress')).toBeDefined())
  })

  it('guest sees Sign In and Create Account links', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))

    await waitFor(() => {
      expect(screen.getByText('Sign In')).toBeDefined()
      expect(screen.getByText('Create Account')).toBeDefined()
    })
  })

  it('guest does not see the quiz button', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))

    await waitFor(() => screen.getByText('Brief Complete!'))
    expect(screen.queryByText(/Take the Quiz/)).toBeNull()
  })

  it('logged-in user does NOT see the sign-in prompt', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(makeCompleteResponse())

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => screen.getByText('Brief Complete!'))
    expect(screen.queryByText('💾 Save your progress')).toBeNull()
  })

  it('clicking "Play Knowledge Check" saves briefId to sessionStorage', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))

    const btn = await waitFor(() => screen.getByText('🎮 Play Knowledge Check'))
    fireEvent.click(btn)

    expect(sessionStorage.getItem('sw_pending_brief')).toBe('brief123')
  })

  it('clicking "Sign In" in the amber card saves briefId to sessionStorage', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))

    await waitFor(() => screen.getByText('Sign In'))
    fireEvent.click(screen.getByText('Sign In'))

    expect(sessionStorage.getItem('sw_pending_brief')).toBe('brief123')
  })

  it('guest sees "Play Knowledge Check" button', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))

    await waitFor(() => expect(screen.getByText('🎮 Play Knowledge Check')).toBeDefined())
  })

  it('hovering "Play Knowledge Check" swaps text to "Sign In to Play", mouse-out reverts', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(SINGLE_SECTION_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('✓ Complete Brief'))
    fireEvent.click(screen.getByText('✓ Complete Brief'))

    const btn = await waitFor(() => screen.getByText('🎮 Play Knowledge Check'))
    fireEvent.mouseEnter(btn)
    expect(screen.getByText('🔒 Sign In to Play')).toBeDefined()

    fireEvent.mouseLeave(btn)
    expect(screen.getByText('🎮 Play Knowledge Check')).toBeDefined()
  })

  it('logged-in user sees the quiz button', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(makeCompleteResponse())

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => expect(screen.getByText(/Take the Quiz/)).toBeDefined())
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
  })
  afterEach(() => vi.restoreAllMocks())

  // BOO check fires AFTER done=true (on completion screen).
  // Fetch call order: brief (1) → /complete (2) → /options (3) → /quiz/status (4)
  it('shows active BOO button when BOO available and quiz passed', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValueOnce(makeBooResponse(true))
      .mockResolvedValueOnce(makeQuizStatusResponse(true))

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
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValueOnce(makeBooResponse(true))
      .mockResolvedValueOnce(makeQuizStatusResponse(false))

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
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValueOnce(makeBooResponse(false))
      .mockResolvedValueOnce(makeQuizStatusResponse(true))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('⭐ Complete Brief & Collect Aircoins'))
    fireEvent.click(screen.getByText('⭐ Complete Brief & Collect Aircoins'))

    await waitFor(() => screen.getByText('Brief Complete!'))
    expect(screen.queryByText(/battle order/i)).toBeNull()
  })
})
