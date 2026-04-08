import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const mockAwardAircoins = vi.hoisted(() => vi.fn())
const mockSetUser       = vi.hoisted(() => vi.fn())
const mockUseAuth       = vi.hoisted(() => vi.fn())
const mockNavigate      = vi.hoisted(() => vi.fn())

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/sound', () => ({ playSound: vi.fn(), stopAllSounds: vi.fn(), playGridRevealTone: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { aircoinsPerBriefRead: 5 } }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt',          () => ({ default: () => null }))

// SwipeCard uses useMotionValue, useTransform, useAnimationControls.
// motion.div with drag="x" gets swipe-left / swipe-right test buttons so tests
// can trigger handleContinue / handleGoBack without real pointer events.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, onClick, onDragEnd, drag }) => {
      if (drag === 'x' && onDragEnd) {
        return (
          <div className={className} style={style} onClick={onClick}>
            {children}
            <button
              data-testid="swipe-left"
              onClick={() => onDragEnd(null, { offset: { x: -150, y: 0 }, velocity: { x: 0, y: 0 } })}
            />
            <button
              data-testid="swipe-right"
              onClick={() => onDragEnd(null, { offset: { x: 150, y: 0 }, velocity: { x: 0, y: 0 } })}
            />
          </div>
        )
      }
      return <div className={className} style={style} onClick={onClick}>{children}</div>
    },
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
    p:      ({ children, className })          => <p className={className}>{children}</p>,
  },
  AnimatePresence:      ({ children }) => <>{children}</>,
  LayoutGroup:          ({ children }) => <>{children}</>,
  useMotionValue:       () => ({ set: vi.fn(), get: () => 0 }),
  useTransform:         () => 0,
  useAnimationControls: () => ({ start: vi.fn() }),
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

// Non-Aircrafts so wta-spawn fetch is not triggered — simplifies fetch ordering
const TRAINING_BRIEF = {
  ...SINGLE_SECTION_BRIEF,
  category: 'Training',
}

// Same as TRAINING_BRIEF but with enough easy quiz questions for quizAvailable=true
const QUIZ_BRIEF = {
  ...TRAINING_BRIEF,
  quizQuestionsEasy: ['q1', 'q2', 'q3', 'q4', 'q5'],
}

const MULTI_SECTION_BRIEF = {
  ...SINGLE_SECTION_BRIEF,
  category:            'Training',
  descriptionSections: [
    'Section one content.',
    'Section two content.',
    'Section three content.',
  ],
}

function makeGetResponse(brief, readRecord = null) {
  return { ok: true, json: async () => ({ data: { brief, readRecord, ammoMax: 3 } }) }
}
const FRESH_READ_RECORD = { _id: 'rr1', coinsAwarded: false, completed: false }

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

const SAFE_EMPTY = { ok: true, json: async () => ({ data: {} }) }

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupLoggedIn() {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1', loginStreak: 0 },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAircoins: mockAwardAircoins,
    setUser:       mockSetUser,
  })
}

function setupGuest() {
  mockUseAuth.mockReturnValue({
    user:          null,
    API: '', apiFetch: (...args) => fetch(...args),
    awardAircoins: mockAwardAircoins,
    setUser:       mockSetUser,
  })
}

// Swipe left on the SwipeCard to trigger handleContinue.
// For a single-section brief isLast=true on mount, so one swipe completes the brief.
async function swipeLeft() {
  const btn = await waitFor(() => screen.getByTestId('swipe-left'))
  fireEvent.click(btn)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BriefReader — complete brief coin awarding', () => {
  beforeEach(() => {
    setupLoggedIn()
    mockAwardAircoins.mockClear()
    mockSetUser.mockClear()
    sessionStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('does NOT call awardAircoins on mount (coins deferred to swipe-complete)', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(TRAINING_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    expect(mockAwardAircoins).not.toHaveBeenCalled()
  })

  it('GET /api/briefs/:id is called on mount without calling /complete', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(TRAINING_BRIEF))

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    const calls = global.fetch.mock.calls.map(c => c[0])
    expect(calls.some(u => u.includes('/api/briefs/brief123') && !u.includes('/complete'))).toBe(true)
    expect(calls.some(u => u.includes('/complete'))).toBe(false)
  })

  it('calls POST /api/briefs/:id/complete when swiping left on last section', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(TRAINING_BRIEF))
      .mockResolvedValue(makeCompleteResponse())

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
      const hit = calls.find(([url]) => url.includes('/complete'))
      expect(hit).toBeDefined()
      expect(hit[1].method).toBe('POST')
    })
  })

  it('calls awardAircoins with combined coins after completing', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(TRAINING_BRIEF))
      .mockResolvedValue(makeCompleteResponse({ aircoinsEarned: 5, dailyCoinsEarned: 5 }))

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => {
      expect(mockAwardAircoins).toHaveBeenCalledWith(
        10,
        'Daily Brief',
        expect.objectContaining({ cycleAfter: 10, totalAfter: 10 })
      )
    })
  })

  it('uses "Brief read" label when only brief-read coins (no daily coins)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(TRAINING_BRIEF))
      .mockResolvedValue(makeCompleteResponse({ aircoinsEarned: 5, dailyCoinsEarned: 0 }))

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => {
      expect(mockAwardAircoins).toHaveBeenCalledWith(5, 'Brief read', expect.anything())
    })
  })

  it('does NOT call awardAircoins when complete returns 0 coins (idempotent re-complete)', async () => {
    const coinsAwardedRecord = { _id: 'rr1', coinsAwarded: true, completed: false }
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(TRAINING_BRIEF, coinsAwardedRecord))
      .mockResolvedValue(makeCompleteResponse({ aircoinsEarned: 0, dailyCoinsEarned: 0 }))

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => c[0])
      expect(calls.some(u => u.includes('/complete'))).toBe(true)
    })
    expect(mockAwardAircoins).not.toHaveBeenCalled()
  })

  it('updates loginStreak on user via setUser after complete', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(TRAINING_BRIEF))
      .mockResolvedValue(makeCompleteResponse({ loginStreak: 3 }))

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => {
      expect(mockSetUser).toHaveBeenCalled()
      const updater = mockSetUser.mock.calls[0][0]
      const result  = updater({ _id: 'user1', loginStreak: 0 })
      expect(result.loginStreak).toBe(3)
    })
  })

  it('swiping left on a non-last section does NOT call /complete', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(MULTI_SECTION_BRIEF))

    render(<BriefReader />)
    await swipeLeft() // section 0 → 1 (not last for a 3-section brief)

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => c[0])
      expect(calls.some(u => u.includes('/complete'))).toBe(false)
    })
    expect(mockAwardAircoins).not.toHaveBeenCalled()
  })

  it('shows completion screen after swiping left on last section', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(TRAINING_BRIEF))
      .mockResolvedValue(makeCompleteResponse())

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => expect(screen.getByText('Brief Complete')).toBeDefined())
  })
})

// ── Guest sign-in prompt ──────────────────────────────────────────────────────

describe('BriefReader — guest completion prompt', () => {
  beforeEach(() => {
    setupGuest()
    sessionStorage.clear()
    localStorage.clear()
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
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(TRAINING_BRIEF))
    render(<BriefReader />)
    await swipeLeft()
    await waitFor(() => screen.getByText('Brief Complete'))
  }

  it('guest sees coin hook and email option after completing a brief', async () => {
    await completeAsGuest()
    expect(screen.getByText('5 Aircoins waiting to be claimed')).toBeDefined()
    expect(screen.getByText('Continue with email')).toBeDefined()
  })

  it('guest sees investment hook with coin reward', async () => {
    await completeAsGuest()
    expect(screen.getByText('5 Aircoins waiting to be claimed')).toBeDefined()
  })

  it('guest sees email input and Continue button after expanding email option', async () => {
    await completeAsGuest()
    fireEvent.click(screen.getByText('Continue with email'))
    expect(screen.getByPlaceholderText('your@email.com')).toBeDefined()
    expect(screen.getByText('Continue →')).toBeDefined()
  })

  it('guest does not see the quiz button', async () => {
    await completeAsGuest()
    expect(screen.queryByText(/Take the Quiz/)).toBeNull()
  })

  it('guest clicking Continue without email navigates to /login?tab=register with pendingBrief param', async () => {
    await completeAsGuest()
    fireEvent.click(screen.getByText('Continue with email'))
    fireEvent.click(screen.getByText('Continue →'))
    expect(mockNavigate).toHaveBeenCalledWith('/login?tab=register&pendingBrief=brief123')
  })

  it('guest clicking Continue with email pre-fills the URL', async () => {
    await completeAsGuest()
    fireEvent.click(screen.getByText('Continue with email'))
    const input = screen.getByPlaceholderText('your@email.com')
    fireEvent.change(input, { target: { value: 'agent@raf.mod.uk' } })
    fireEvent.click(screen.getByText('Continue →'))
    expect(mockNavigate).toHaveBeenCalledWith(
      '/login?tab=register&pendingBrief=brief123&email=agent%40raf.mod.uk'
    )
  })

  it('saves pending brief to localStorage', async () => {
    await completeAsGuest()
    fireEvent.click(screen.getByText('Continue with email'))
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

  it('Google One Tap is NOT called for logged-in users', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(SAFE_EMPTY)           // wta-spawn
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(SAFE_EMPTY)
    render(<BriefReader />)
    await swipeLeft()
    await waitFor(() => screen.getByText('Brief Complete'))
    expect(window.google.accounts.id.prompt).not.toHaveBeenCalled()
  })

  it('logged-in user does NOT see the sign-up panel', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(SAFE_EMPTY)           // wta-spawn
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(SAFE_EMPTY)
    render(<BriefReader />)
    await swipeLeft()
    await waitFor(() => screen.getByText('Brief Complete'))
    expect(screen.queryByText('Don\'t lose this progress')).toBeNull()
  })

  it('logged-in user sees the quiz button (when quiz questions available)', async () => {
    setupLoggedIn()
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(QUIZ_BRIEF))
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(SAFE_EMPTY)
    render(<BriefReader />)
    await swipeLeft()
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

  const WTA_SPAWN_EMPTY = { ok: true, json: async () => ({ data: null }) }
  const CATCH_ALL       = { ok: true, json: async () => ({}) }

  it('shows "Mission Complete" heading on first ever brief completion', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(WTA_SPAWN_EMPTY)
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(CATCH_ALL)

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => expect(screen.getByText('First Brief — Mission Complete')).toBeDefined())
  })

  it('shows standard "Brief Complete!" heading when not the first brief', async () => {
    localStorage.setItem('skywatch_first_brief', '1')
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(WTA_SPAWN_EMPTY)
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(CATCH_ALL)

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => expect(screen.getByText('Brief Complete')).toBeDefined())
    expect(screen.queryByText('First Brief — Mission Complete')).toBeNull()
  })

  it('sets skywatch_first_brief in localStorage after first completion', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(SINGLE_SECTION_BRIEF))
      .mockResolvedValueOnce(WTA_SPAWN_EMPTY)
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValue(CATCH_ALL)

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => screen.getByText('First Brief — Mission Complete'))
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
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(TRAINING_BRIEF))

    render(<BriefReader />)

    await waitFor(() => expect(screen.getByText('Brief Complete')).toBeDefined())
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
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(TRAINING_BRIEF))

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
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(TRAINING_BRIEF))

    render(<BriefReader />)

    await waitFor(() => expect(mockAwardAircoins).toHaveBeenCalled())
    expect(sessionStorage.getItem('sw_brief_coins')).toBeNull()
  })

  it('does not show completion screen when sw_brief_just_completed is for a different brief', async () => {
    sessionStorage.setItem('sw_brief_just_completed', 'other-brief')
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(TRAINING_BRIEF))

    render(<BriefReader />)

    await waitFor(() => screen.getByText('RAF Typhoon'))
    expect(screen.queryByText('Brief Complete')).toBeNull()
    expect(screen.getByTestId('swipe-left')).toBeDefined()
  })
})

// ── BriefReader — BOO button state on completion screen ───────────────────────

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
    localStorage.setItem('skywatch_first_brief', '1')
  })
  afterEach(() => vi.restoreAllMocks())

  const WTA_SPAWN_EMPTY = { ok: true, json: async () => ({ data: null }) }

  // QUIZ_BRIEF has 1 section so isLast=true on mount, which fires POST /reached-flashcard
  // before the swipe. That extra call must be mocked before the /complete response.
  const REACHED_FLASHCARD_EMPTY = { ok: true, json: async () => ({ status: 'success', wasNew: false }) }

  it('shows active BOO button when BOO available and quiz passed', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(QUIZ_BRIEF))
      .mockResolvedValueOnce(REACHED_FLASHCARD_EMPTY)  // reached-flashcard fires on mount
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValueOnce(makeQuizStatusResponse(true))
      .mockResolvedValueOnce(makeBooResponse(true))
      .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => screen.getByText('Brief Complete'))
    await waitFor(() => {
      const btn = screen.getByText('🗺️ Battle of Order — Earn Aircoins', { selector: 'button' })
      expect(btn).not.toBeDisabled()
    })
  })

  it('shows locked BOO indicator when BOO available but quiz not yet passed', async () => {
    // Uses QUIZ_BRIEF so quizAvailable=true — locked-quiz state shows "🔒 Pass the quiz first"
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(QUIZ_BRIEF))
      .mockResolvedValueOnce(REACHED_FLASHCARD_EMPTY)  // reached-flashcard fires on mount
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValueOnce(makeQuizStatusResponse(false))
      .mockResolvedValueOnce(makeBooResponse(true))
      .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => screen.getByText('Brief Complete'))
    // The locked BOO renders as a non-interactive div, not a disabled button
    await waitFor(() => {
      expect(screen.getByText('🔒 Pass the quiz first')).toBeDefined()
      expect(screen.getByText('🗺️ Battle of Order')).toBeDefined()
    })
  })

  it('hides BOO button entirely when BOO not available for this category', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(QUIZ_BRIEF))
      .mockResolvedValueOnce(makeCompleteResponse())
      .mockResolvedValueOnce(makeBooResponse(false))
      .mockResolvedValueOnce(makeQuizStatusResponse(true))
      .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })

    render(<BriefReader />)
    await swipeLeft()

    await waitFor(() => screen.getByText('Brief Complete'))
    expect(screen.queryByText(/battle order/i)).toBeNull()
  })
})

// ── Section position persistence (cross-device resume) ────────────────────────

describe('BriefReader — section position persistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('starts at section 0 when readRecord has no currentSection', async () => {
    setupLoggedIn()
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(MULTI_SECTION_BRIEF, FRESH_READ_RECORD))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))
    expect(screen.getByText('1 / 3')).toBeDefined()
  })

  it('restores logged-in user to readRecord.currentSection on mount', async () => {
    setupLoggedIn()
    const record = { ...FRESH_READ_RECORD, currentSection: 1 }
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(MULTI_SECTION_BRIEF, record))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))
    // Section counter "2 / 3" confirms resume at index 1
    expect(screen.getByText('2 / 3')).toBeDefined()
  })

  it('does NOT restore section when readRecord.completed is true', async () => {
    setupLoggedIn()
    const completedRecord = { _id: 'rr1', completed: true, currentSection: 2 }
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse(MULTI_SECTION_BRIEF, completedRecord))
      .mockResolvedValue(SAFE_EMPTY)
    render(<BriefReader />)
    // completed=true → AlreadyReadScreen, not the brief content at section 2
    await waitFor(() => screen.getByText('↩ Re-read →'))
    expect(screen.queryByText('3 / 3')).toBeNull()
  })

  it('restores guest user section from localStorage on mount', async () => {
    setupGuest()
    localStorage.setItem('sw_brief_sec_brief123', '1')
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(MULTI_SECTION_BRIEF))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))
    expect(screen.getByText('2 / 3')).toBeDefined()
  })

  it('saves section to localStorage for guest on each swipe', async () => {
    setupGuest()
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(MULTI_SECTION_BRIEF))
    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))
    fireEvent.click(screen.getByTestId('swipe-left')) // advance to section 1
    await waitFor(() => expect(localStorage.getItem('sw_brief_sec_brief123')).toBe('1'))
  })

  it('clears localStorage section key when guest completes the brief', async () => {
    setupGuest()
    localStorage.setItem('sw_brief_sec_brief123', '0')
    localStorage.setItem('skywatch_first_brief', '1')
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(TRAINING_BRIEF))
    render(<BriefReader />)
    await swipeLeft()
    await waitFor(() => screen.getByText('Brief Complete'))
    expect(localStorage.getItem('sw_brief_sec_brief123')).toBeNull()
  })

  it('sends currentSection in PATCH /time payload', async () => {
    vi.useFakeTimers()
    setupLoggedIn()
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse(MULTI_SECTION_BRIEF, FRESH_READ_RECORD))
    render(<BriefReader />)
    await act(async () => {}) // flush fetch + state updates

    await act(async () => { vi.advanceTimersByTime(10_000) })
    await act(async () => {})

    const timeCalls = global.fetch.mock.calls.filter(([url, opts]) =>
      url.includes('/time') && opts?.method === 'PATCH'
    )
    expect(timeCalls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(timeCalls[0][1].body)
    expect(body).toHaveProperty('currentSection')
    expect(typeof body.currentSection).toBe('number')

    vi.useRealTimers()
  })
})
