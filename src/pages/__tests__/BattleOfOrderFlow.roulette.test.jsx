import { render, screen, waitFor, act } from '@testing-library/react'
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
    awardAircoins: vi.fn(),
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

const GENERATE_RESPONSE = {
  status: 'success',
  data: {
    gameId: 'game1',
    category: 'Aircrafts',
    difficulty: 'easy',
    orderType: 'speed',
    choices: [
      { choiceId: 'c1', briefTitle: 'Typhoon' },
      { choiceId: 'c2', briefTitle: 'Tornado' },
      { choiceId: 'c3', briefTitle: 'Hawk'    },
    ],
  },
}

function setupFetch(options = OPTIONS_MULTI) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/'))
      return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
    if (url.includes('/options'))
      return Promise.resolve({ ok: true, status: 200, json: async () => options })
    if (url.includes('/generate'))
      return Promise.resolve({ ok: true, status: 200, json: async () => GENERATE_RESPONSE })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('BattleOfOrderFlow — roulette screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockClear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows roulette screen (not game screen) when multiple options are available', async () => {
    global.fetch = setupFetch(OPTIONS_MULTI)
    render(<BattleOfOrderFlow />)

    // Wait for data to load — roulette screen shows before game
    await waitFor(() => screen.getByText('Battle of Order'))
    expect(screen.queryByText('Submit Order →')).toBeNull()
  })

  it('plays battle_of_order_selection sound on roulette mount', async () => {
    const { playSound } = await import('../../utils/sound')
    global.fetch = setupFetch(OPTIONS_MULTI)
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order'))
    expect(playSound).toHaveBeenCalledWith('battle_of_order_selection')
  })

  it('shows brief title on roulette screen', async () => {
    global.fetch = setupFetch(OPTIONS_MULTI)
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Eurofighter Typhoon'))
  })

  it('shows difficulty badge on roulette screen', async () => {
    global.fetch = setupFetch(OPTIONS_MULTI)
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText(/Standard — 3 items/i))
  })

  it('shows "Selecting challenge…" label during spin', async () => {
    global.fetch = setupFetch(OPTIONS_MULTI)
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText(/Selecting challenge/i))
  })

  it('transitions to game screen automatically after roulette spin completes', async () => {
    global.fetch = setupFetch(OPTIONS_MULTI)
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('Battle of Order'))

    // Advance timers past the full roulette spin + 900ms pause
    await act(async () => {
      vi.advanceTimersByTime(15000)
    })

    await waitFor(() => screen.getByText('Submit Order →'), { timeout: 3000 })
  })

  it('skips roulette and goes straight to game when only one option', async () => {
    global.fetch = setupFetch(OPTIONS_SINGLE)
    render(<BattleOfOrderFlow />)

    // With a single option, RouletteScreen still runs but immediately picks that option
    // After the spin completes, the game screen should appear
    await act(async () => {
      vi.advanceTimersByTime(15000)
    })

    await waitFor(() => screen.getByText('Submit Order →'), { timeout: 3000 })
  })

  it('"← Back to Brief" on roulette screen navigates back', async () => {
    global.fetch = setupFetch(OPTIONS_MULTI)
    render(<BattleOfOrderFlow />)

    await waitFor(() => screen.getByText('← Back to Brief'))
    screen.getByText('← Back to Brief').click()
    expect(mockNavigate).toHaveBeenCalledWith('/brief/brief123')
  })
})

describe('BattleOfOrderFlow — roulette after results (retry)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockClear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('returns to roulette screen (not game) when Try Again is clicked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const fetchMock = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/briefs/'))
        return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
      if (url.includes('/options'))
        return Promise.resolve({ ok: true, status: 200, json: async () => OPTIONS_MULTI })
      if (url.includes('/generate'))
        return Promise.resolve({ ok: true, status: 200, json: async () => GENERATE_RESPONSE })
      if (url.includes('/submit'))
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          status: 'success',
          data: { won: false, aircoinsEarned: 0, alreadyCompleted: false, correctReveal: [] },
        }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    global.fetch = fetchMock
    render(<BattleOfOrderFlow />)

    // Wait for roulette → spin through → game screen
    await waitFor(() => screen.getByText('Battle of Order'))
    await act(async () => { vi.advanceTimersByTime(15000) })
    await waitFor(() => screen.getByText('Submit Order →'), { timeout: 3000 })

    // Submit the game
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.click(screen.getByText('Submit Order →'))
    await waitFor(() => screen.getByRole('button', { name: /try again/i }))

    // Click Try Again
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    // Should be back on roulette, not game screen
    await waitFor(() => screen.getByText('Battle of Order'))
    expect(screen.queryByText('Submit Order →')).toBeNull()

    vi.useRealTimers()
  })
})
