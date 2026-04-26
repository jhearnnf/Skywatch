import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BattleOfOrderFlow from '../BattleOfOrderFlow'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../utils/sound', () => ({ playSound: vi.fn() }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user:          { _id: 'user1' },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
  }),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, initial, animate, exit, transition, whileTap, ...rest }) =>
      <div className={className} {...rest}>{children}</div>,
    button: ({ children, className, onClick, disabled, initial, animate, exit, transition, whileTap, ...rest }) =>
      <button className={className} onClick={onClick} disabled={disabled} {...rest}>{children}</button>,
    circle: ({ children, ...rest }) => <circle>{children}</circle>,
    p: ({ children, className, initial, animate, exit, transition, ...rest }) =>
      <p className={className} {...rest}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const BRIEF_RESPONSE = {
  data: { brief: { _id: 'brief123', title: 'Eurofighter Typhoon', category: 'Aircrafts' } },
}

const OPTIONS_MULTI = {
  status: 'success',
  data: {
    available:  true,
    difficulty: 'easy',
    options: [
      { orderType: 'speed' },
      { orderType: 'year_introduced' },
    ],
  },
}

const OPTIONS_SINGLE = {
  status: 'success',
  data: {
    available:  true,
    difficulty: 'easy',
    options: [{ orderType: 'speed' }],
  },
}

const OPTIONS_UNAVAILABLE = {
  status: 'success',
  data: { available: false, reason: 'ineligible_category' },
}

const CHOICES = [
  { choiceId: 'c1', briefTitle: 'Typhoon' },
  { choiceId: 'c2', briefTitle: 'Tornado' },
  { choiceId: 'c3', briefTitle: 'Hawk'    },
]

const GENERATE_RESPONSE = {
  status: 'success',
  data: { gameId: 'game1', category: 'Aircrafts', difficulty: 'easy', orderType: 'speed', choices: CHOICES },
}

const CORRECT_REVEAL = [
  { choiceId: 'c3', briefTitle: 'Hawk',    correctOrder: 1, displayValue: '1000 kph' },
  { choiceId: 'c2', briefTitle: 'Tornado', correctOrder: 2, displayValue: '2200 kph' },
  { choiceId: 'c1', briefTitle: 'Typhoon', correctOrder: 3, displayValue: '2495 kph' },
]

function makeSubmitResponse({ won, airstarsEarned = 0, alreadyCompleted = false }) {
  return {
    status: 'success',
    data: { won, airstarsEarned, alreadyCompleted, correctReveal: CORRECT_REVEAL },
  }
}

function setupFetch({ options = OPTIONS_MULTI, won = true, airstarsEarned = 8, alreadyCompleted = false } = {}) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/'))
      return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
    if (url.includes('/options'))
      return Promise.resolve({ ok: true, status: 200, json: async () => options })
    if (url.includes('/generate'))
      return Promise.resolve({ ok: true, status: 200, json: async () => GENERATE_RESPONSE })
    if (url.includes('/submit'))
      return Promise.resolve({ ok: true, status: 200, json: async () => makeSubmitResponse({ won, airstarsEarned, alreadyCompleted }) })
    if (url.includes('/abandon'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'success' }) })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Render and advance through the roulette animation to the game screen.
 *
 * Fake timers are installed locally so callers don't have to remember to set
 * them up — and switched back to real timers as soon as the roulette is past.
 * Mixing fake timers with waitFor's polling under parallel CPU pressure was
 * the main source of flakiness; keeping fake timers' window as narrow as
 * possible avoids it.
 */
async function renderAndReachGame(fetchMock) {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  global.fetch = fetchMock
  render(<BattleOfOrderFlow />)
  // Wait for the roulette screen to appear
  await waitFor(() => screen.getByText('Battle of Order'))
  // Advance past all roulette ticks + 900ms post-spin pause
  await act(async () => { vi.advanceTimersByTime(20000) })
  vi.useRealTimers()
  // Wait for game screen on real timers — deterministic
  await waitFor(() => screen.getByText('Submit Order →'))
}

async function renderAndReachResults(fetchMock) {
  await renderAndReachGame(fetchMock)
  fireEvent.click(screen.getByText('Submit Order →'))
  await waitFor(() => screen.getByRole('button', { name: /back to brief/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('BattleOfOrderFlow — roulette / selection screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows roulette screen with "Battle of Order" heading', async () => {
    global.fetch = setupFetch({ options: OPTIONS_MULTI })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order'))
    expect(screen.getByText('Eurofighter Typhoon')).toBeDefined()
  })

  it('shows "Selecting challenge…" while roulette is spinning', async () => {
    global.fetch = setupFetch({ options: OPTIONS_MULTI })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText(/Selecting challenge/i))
  })

  it('shows difficulty badge on roulette screen', async () => {
    global.fetch = setupFetch({ options: OPTIONS_MULTI })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText(/Standard — 3 items/i))
    expect(screen.getByText(/Standard — 3 items/i)).toBeDefined()
  })

  it('shows unavailable screen for ineligible category', async () => {
    global.fetch = setupFetch({ options: OPTIONS_UNAVAILABLE })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order unavailable'))
    expect(screen.getByText(/doesn't support Battle of Order/i)).toBeDefined()
  })

  it('shows "read and complete" message when brief has not been read', async () => {
    global.fetch = setupFetch({
      options: { status: 'success', data: { available: false, reason: 'not_read' } },
    })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order unavailable'))
    expect(screen.getByText(/read and complete this brief/i)).toBeDefined()
  })

  it('shows "pass the Intel Quiz" message when quiz not yet passed', async () => {
    global.fetch = setupFetch({
      options: { status: 'success', data: { available: false, reason: 'quiz_not_passed' } },
    })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order unavailable'))
    expect(screen.getByText(/pass the Intel Quiz/i)).toBeDefined()
  })

  it('navigates back to brief when ← Back clicked on roulette screen', async () => {
    global.fetch = setupFetch({ options: OPTIONS_MULTI })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText(/Back to Brief/))
    fireEvent.click(screen.getByText('← Back to Brief'))
    expect(mockNavigate).toHaveBeenCalledWith('/brief/brief123')
  })

  it('advances to game screen after roulette spin completes (multi-option)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    global.fetch = setupFetch({ options: OPTIONS_MULTI })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order'))
    await act(async () => { vi.advanceTimersByTime(20000) })
    vi.useRealTimers()

    await waitFor(() => screen.getByText('Submit Order →'))
    expect(screen.queryByText('Selecting challenge')).toBeNull()
  })

  it('advances to game screen after roulette spin completes (single-option)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    global.fetch = setupFetch({ options: OPTIONS_SINGLE })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order'))
    await act(async () => { vi.advanceTimersByTime(20000) })
    vi.useRealTimers()

    await waitFor(() => screen.getByText('Submit Order →'))
  })
})

describe('BattleOfOrderFlow — game screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows all choice items on game screen', async () => {
    await renderAndReachGame(setupFetch())

    expect(screen.getByText('Typhoon')).toBeDefined()
    expect(screen.getByText('Tornado')).toBeDefined()
    expect(screen.getByText('Hawk')).toBeDefined()
  })

  it('shows a timer on the game screen', async () => {
    await renderAndReachGame(setupFetch())
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeDefined()
  })

  it('shows difficulty badge on game screen', async () => {
    await renderAndReachGame(setupFetch())
    expect(screen.getByText(/Standard/i)).toBeDefined()
  })

  it('calls abandon and navigates back when Quit is clicked', async () => {
    const fetchMock = setupFetch()
    await renderAndReachGame(fetchMock)

    fireEvent.click(screen.getByText('✕ Quit'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/brief/brief123'))
    // abandon should have been called
    const calls = fetchMock.mock.calls.map(c => c[0])
    expect(calls.some(u => u.includes('/abandon'))).toBe(true)
  })

  it('plays battle_of_order_selection sound on roulette mount', async () => {
    const { playSound } = await import('../../utils/sound')
    global.fetch = setupFetch({ options: OPTIONS_MULTI })
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order'))
    expect(playSound).toHaveBeenCalledWith('battle_of_order_selection')
  })

  it('does NOT play battle_of_order_selection sound when moving items up or down', async () => {
    const { playSound } = await import('../../utils/sound')

    await renderAndReachGame(setupFetch())
    // Clear after roulette finishes so the roulette's own sound call doesn't pollute the assertion
    vi.clearAllMocks()

    // Click move-up on second item (index 1)
    const moveUpBtns = screen.getAllByRole('button', { name: /move up/i })
    fireEvent.click(moveUpBtns[1])

    // Click move-down on first item (index 0)
    const moveDownBtns = screen.getAllByRole('button', { name: /move down/i })
    fireEvent.click(moveDownBtns[0])

    expect(playSound).not.toHaveBeenCalledWith('battle_of_order_selection')
  })
})

describe('BattleOfOrderFlow — results screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows win message and airstars earned on a win', async () => {
    await renderAndReachResults(setupFetch({ won: true, airstarsEarned: 8 }))

    expect(screen.getByText('Correct Order!')).toBeDefined()
    expect(screen.getByText(/\+8 Airstars earned/i)).toBeDefined()
  })

  it('shows loss message on a loss', async () => {
    await renderAndReachResults(setupFetch({ won: false, airstarsEarned: 0 }))

    expect(screen.getByText('Not Quite!')).toBeDefined()
    expect(screen.queryByText(/Airstars earned/i)).toBeNull()
  })

  it('shows correct reveal with display values', async () => {
    await renderAndReachResults(setupFetch({ won: true, airstarsEarned: 8 }))

    expect(screen.getByText('Hawk')).toBeDefined()
    expect(screen.getByText('Tornado')).toBeDefined()
    expect(screen.getByText('1000 kph')).toBeDefined()
    expect(screen.getByText('2495 kph')).toBeDefined()
  })

  it('shows "already earned" message on repeat win with 0 coins', async () => {
    await renderAndReachResults(setupFetch({ won: true, airstarsEarned: 0, alreadyCompleted: true }))

    expect(screen.getByText(/already earned Airstars for this order type/i)).toBeDefined()
    expect(screen.queryByText(/\+0 Airstars/i)).toBeNull()
  })

  it('plays battle_of_order_won sound on win', async () => {
    const { playSound } = await import('../../utils/sound')
    await renderAndReachResults(setupFetch({ won: true, airstarsEarned: 8 }))

    expect(playSound).toHaveBeenCalledWith('battle_of_order_won')
    expect(playSound).not.toHaveBeenCalledWith('battle_of_order_lost')
  })

  it('plays battle_of_order_lost sound on loss', async () => {
    const { playSound } = await import('../../utils/sound')
    await renderAndReachResults(setupFetch({ won: false, airstarsEarned: 0 }))

    expect(playSound).toHaveBeenCalledWith('battle_of_order_lost')
    expect(playSound).not.toHaveBeenCalledWith('battle_of_order_won')
  })

  it('navigates back to brief when Back to Brief clicked', async () => {
    await renderAndReachResults(setupFetch({ won: true, airstarsEarned: 8 }))

    fireEvent.click(screen.getByRole('button', { name: /back to brief/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/brief/brief123')
  })

  it('returns to roulette (not game) when Try Again clicked', async () => {
    const fetchMock = setupFetch({ won: false, airstarsEarned: 0 })
    await renderAndReachResults(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    // Should show roulette screen again — NOT game screen yet
    await waitFor(() => screen.getByText('Battle of Order'))
    expect(screen.queryByText('Submit Order →')).toBeNull()
  })

  it('re-generates game after Try Again → roulette → game', async () => {
    const fetchMock = setupFetch({ won: false, airstarsEarned: 0 })
    await renderAndReachResults(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    // Advance through the second roulette spin
    await waitFor(() => screen.getByText('Battle of Order'))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await act(async () => { vi.advanceTimersByTime(20000) })
    vi.useRealTimers()
    await waitFor(() => screen.getByText('Submit Order →'))

    const calls = fetchMock.mock.calls.map(c => c[0])
    expect(calls.filter(u => u.includes('/generate')).length).toBeGreaterThanOrEqual(2)
  })
})

// ── Training order types ───────────────────────────────────────────────────

const TRAINING_BRIEF_RESPONSE = {
  data: { brief: { _id: 'brief123', title: 'Basic Flying Training', category: 'Training' } },
}

const TRAINING_OPTIONS_BOTH = {
  status: 'success',
  data: {
    available:  true,
    difficulty: 'easy',
    options: [
      { orderType: 'training_week' },
      { orderType: 'training_duration' },
    ],
  },
}

const TRAINING_OPTIONS_DURATION_ONLY = {
  status: 'success',
  data: {
    available:  true,
    difficulty: 'easy',
    options: [{ orderType: 'training_duration' }],
  },
}

const TRAINING_GENERATE_DURATION = {
  status: 'success',
  data: {
    gameId: 'game2', category: 'Training', difficulty: 'easy',
    orderType: 'training_duration',
    choices: [
      { choiceId: 'd1', briefTitle: 'Phase 1', displayValue: '4 wks' },
      { choiceId: 'd2', briefTitle: 'Phase 2', displayValue: '8 wks' },
      { choiceId: 'd3', briefTitle: 'Phase 3', displayValue: '12 wks' },
    ],
  },
}

function setupTrainingFetch(options = TRAINING_OPTIONS_BOTH, generateResp = TRAINING_GENERATE_DURATION) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/'))
      return Promise.resolve({ ok: true, status: 200, json: async () => TRAINING_BRIEF_RESPONSE })
    if (url.includes('/options'))
      return Promise.resolve({ ok: true, status: 200, json: async () => options })
    if (url.includes('/generate'))
      return Promise.resolve({ ok: true, status: 200, json: async () => generateResp })
    if (url.includes('/submit'))
      return Promise.resolve({ ok: true, status: 200, json: async () => makeSubmitResponse({ won: true, airstarsEarned: 8 }) })
    if (url.includes('/abandon'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'success' }) })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

describe('BattleOfOrderFlow — Training order types', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows roulette and advances to game screen when both Training order types are available', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    global.fetch = setupTrainingFetch(TRAINING_OPTIONS_BOTH, TRAINING_GENERATE_DURATION)
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order'))
    await act(async () => { vi.advanceTimersByTime(20000) })
    vi.useRealTimers()
    // Roulette picks one of the two options and proceeds to game screen
    await waitFor(() => screen.getByText('Submit Order →'))
  })

  it('advances to game screen for training_duration orderType', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    global.fetch = setupTrainingFetch(TRAINING_OPTIONS_DURATION_ONLY, TRAINING_GENERATE_DURATION)
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order'))
    await act(async () => { vi.advanceTimersByTime(20000) })
    vi.useRealTimers()

    await waitFor(() => screen.getByText('Submit Order →'))
  })

})
