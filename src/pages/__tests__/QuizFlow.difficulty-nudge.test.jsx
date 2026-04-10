import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import QuizFlow from '../QuizFlow'

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mockNavigate      = vi.hoisted(() => vi.fn())
const mockHasSeen       = vi.hoisted(() => vi.fn(() => false))
const mockStartAfterNav = vi.hoisted(() => vi.fn())
const mockApiFetch      = vi.hoisted(() => vi.fn())

vi.mock('../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user:          { _id: 'user1', subscriptionTier: 'free' },
    API:           '',
    awardAircoins: vi.fn(),
    apiFetch:      mockApiFetch,
  }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({
    start:         vi.fn(),
    hasSeen:       mockHasSeen,
    startAfterNav: mockStartAfterNav,
  }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: {}, levelThresholds: [] }),
}))

vi.mock('../../context/NewGameUnlockContext', () => ({
  useNewGameUnlock: () => ({ applyUnlocks: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal',  () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt',           () => ({ default: () => null }))
vi.mock('../../components/LockedCategoryModal',     () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) =>
      <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
    circle: ({ children }) => <circle>{children}</circle>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const CORRECT_ID = 'ans_correct'

const QUESTION = {
  _id: 'q1',
  question: 'What is the Typhoon?',
  answers: [
    { _id: CORRECT_ID,  title: 'Multirole fighter' },
    { _id: 'ans_wrong', title: 'Heavy bomber' },
  ],
  correctAnswerId: CORRECT_ID,
}

const BRIEF_RESPONSE = { data: { brief: { _id: 'brief123', title: 'Typhoon', category: 'Aircrafts' } } }

function makeStartResponse(difficulty = 'easy') {
  return {
    status: 'success',
    data: { attemptId: 'a1', gameSessionId: 's1', questions: [QUESTION], difficulty },
  }
}

// QuizFlow splits its calls: apiFetch loads brief + quiz/start, raw fetch handles
// /result, /finish, /abandon, and battle-of-order/options.
function setupFetch({ difficulty = 'easy', won = true, isFirstAttempt = true, aircoinsEarned = 10 } = {}) {
  const finishPayload = {
    data: {
      won, isFirstAttempt, aircoinsEarned, breakdown: [],
      attempt: { cycleAircoins: aircoinsEarned, totalAircoins: 100 },
    },
  }

  mockApiFetch.mockImplementation((url) => {
    if (url.includes('/api/briefs/'))          return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
    if (url.includes('/api/games/quiz/start')) return Promise.resolve({ ok: true, status: 200, json: async () => makeStartResponse(difficulty) })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })

  return vi.fn().mockImplementation((url) => {
    if (url.includes('/finish'))         return Promise.resolve({ ok: true, status: 200, json: async () => finishPayload })
    if (url.includes('battle-of-order')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { available: false } }) })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

// ── Helper ────────────────────────────────────────────────────────────────

async function completeQuiz() {
  await waitFor(() => screen.getByText('What is the Typhoon?'))
  fireEvent.click(screen.getByText('Multirole fighter'))
  await waitFor(() => screen.getByRole('button', { name: /see results/i }))
  fireEvent.click(screen.getByRole('button', { name: /see results/i }))
  await waitFor(() => screen.getByRole('button', { name: /back to brief/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('QuizFlow — post-quiz difficulty nudge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not appear after a loss', async () => {
    global.fetch = setupFetch({ won: false, isFirstAttempt: true })
    render(<QuizFlow />)
    await completeQuiz()

    act(() => vi.advanceTimersByTime(1500))

    expect(screen.queryByText('Was that quiz too easy?')).toBeNull()
  })

  it('still appears on a repeat win (localStorage is the one-time guard, not isFirstAttempt)', async () => {
    global.fetch = setupFetch({ won: true, isFirstAttempt: false })
    render(<QuizFlow />)
    await completeQuiz()

    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })

    await waitFor(() => expect(screen.getByText('Was that quiz too easy?')).toBeDefined())
  })

  it('does not appear when difficulty is not easy', async () => {
    global.fetch = setupFetch({ won: true, isFirstAttempt: true, difficulty: 'medium' })
    render(<QuizFlow />)
    await completeQuiz()

    act(() => vi.advanceTimersByTime(1500))

    expect(screen.queryByText('Was that quiz too easy?')).toBeNull()
  })

  it('does not appear if localStorage flag is already set', async () => {
    localStorage.setItem('sw_tut_v2_user1_quiz_difficulty_nudge', '1')
    global.fetch = setupFetch({ won: true, isFirstAttempt: true })
    render(<QuizFlow />)
    await completeQuiz()

    act(() => vi.advanceTimersByTime(1500))

    expect(screen.queryByText('Was that quiz too easy?')).toBeNull()
  })

  it('appears after 1200ms on a first-attempt easy win', async () => {
    global.fetch = setupFetch({ won: true, isFirstAttempt: true })
    render(<QuizFlow />)
    await completeQuiz()

    expect(screen.queryByText('Was that quiz too easy?')).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })

    await waitFor(() => expect(screen.getByText('Was that quiz too easy?')).toBeDefined())
    expect(screen.getByRole('button', { name: /felt right/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /show me how/i })).toBeDefined()
  })

  it('"Felt right" dismisses the nudge and sets localStorage', async () => {
    global.fetch = setupFetch({ won: true, isFirstAttempt: true })
    render(<QuizFlow />)
    await completeQuiz()

    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    await waitFor(() => screen.getByRole('button', { name: /felt right/i }))

    fireEvent.click(screen.getByRole('button', { name: /felt right/i }))

    await waitFor(() => expect(screen.queryByText('Was that quiz too easy?')).toBeNull())
    expect(localStorage.getItem('sw_tut_v2_user1_quiz_difficulty_nudge')).toBe('1')
  })

  it('"Show me how" sets localStorage, calls startAfterNav, and navigates to /profile', async () => {
    mockHasSeen.mockReturnValue(false)
    global.fetch = setupFetch({ won: true, isFirstAttempt: true })
    render(<QuizFlow />)
    await completeQuiz()

    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    await waitFor(() => screen.getByRole('button', { name: /show me how/i }))
    fireEvent.click(screen.getByRole('button', { name: /show me how/i }))

    expect(localStorage.getItem('sw_tut_v2_user1_quiz_difficulty_nudge')).toBe('1')
    expect(mockNavigate).toHaveBeenCalledWith('/profile')
  })

  it('starts profile tutorial from step 0 when profile not yet seen', async () => {
    mockHasSeen.mockReturnValue(false)
    global.fetch = setupFetch({ won: true, isFirstAttempt: true })
    render(<QuizFlow />)
    await completeQuiz()

    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    await waitFor(() => screen.getByRole('button', { name: /show me how/i }))
    fireEvent.click(screen.getByRole('button', { name: /show me how/i }))

    expect(mockStartAfterNav).toHaveBeenCalledWith('profile', 0)
  })

  it('skips to last profile step (Infinity sentinel) when profile tutorial already seen', async () => {
    mockHasSeen.mockReturnValue(true)
    global.fetch = setupFetch({ won: true, isFirstAttempt: true })
    render(<QuizFlow />)
    await completeQuiz()

    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    await waitFor(() => screen.getByRole('button', { name: /show me how/i }))
    fireEvent.click(screen.getByRole('button', { name: /show me how/i }))

    expect(mockStartAfterNav).toHaveBeenCalledWith('profile', Infinity)
  })
})
