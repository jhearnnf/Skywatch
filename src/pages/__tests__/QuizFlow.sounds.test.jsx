import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import QuizFlow from '../QuizFlow'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../utils/sound', () => ({
  playSound: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useParams: () => ({ briefId: 'brief123' }),
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'user1' },
    API: '',
    apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
  }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { airstarsPerBriefRead: 5 } }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({
  default: () => null,
}))

vi.mock('../../components/UpgradePrompt', () => ({
  default: () => null,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, onClick, ...rest }) => <div className={className} onClick={onClick}>{children}</div>,
    button: ({ children, className, onClick, disabled, ...rest }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
    circle: ({ children, ...rest }) => <circle>{children}</circle>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const CORRECT_ID = 'ans_correct'
const WRONG_ID   = 'ans_wrong'

const QUESTION = {
  _id: 'q1',
  question: 'What type of aircraft is the F-35?',
  answers: [
    { _id: CORRECT_ID, title: 'Multirole stealth fighter' },
    { _id: WRONG_ID,   title: 'Heavy bomber' },
  ],
  correctAnswerId: CORRECT_ID,
  difficulty: 'easy',
}

const BRIEF_RESPONSE = {
  data: { brief: { _id: 'brief123', title: 'F-35', category: 'Aircrafts' } },
}

const START_RESPONSE = {
  status: 'success',
  data: {
    attemptId:     'attempt1',
    gameSessionId: 'session1',
    questions:     [QUESTION],
    difficulty:    'easy',
  },
}

const RESULT_RESPONSE = { status: 'success' }

function makeFinishResponse(won = true) {
  return {
    data: {
      airstarsEarned: won ? 10 : 0,
      won,
      isFirstAttempt: true,
      breakdown: won ? [{ label: '1 correct answer × 10', amount: 10 }] : [],
      attempt: { cycleAirstars: 10, totalAirstars: 100 },
    },
  }
}

function setupFetch({ won = true } = {}) {
  return vi.fn().mockImplementation((url, opts) => {
    const method = opts?.method ?? 'GET'

    if (url.includes('/api/briefs/')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
    }
    if (url.includes('/api/games/quiz/start')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => START_RESPONSE })
    }
    if (url.includes('/api/games/quiz/result')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => RESULT_RESPONSE })
    }
    if (url.includes('/api/games/quiz/attempt') && url.includes('/finish')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => makeFinishResponse(won) })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function renderAndLoad() {
  render(<QuizFlow />)
  // Wait for question to appear
  await waitFor(() => screen.getByText(/What type of aircraft is the F-35\?/i))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('QuizFlow — sound wiring', () => {
  let playSound

  beforeEach(async () => {
    playSound = (await import('../../utils/sound')).playSound
    playSound.mockClear()
    mockNavigate.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('plays "quiz_answer_correct" when a correct answer is selected', async () => {
    global.fetch = setupFetch()
    await renderAndLoad()

    fireEvent.click(screen.getByText('Multirole stealth fighter'))

    expect(playSound).toHaveBeenCalledWith('quiz_answer_correct')
  })

  it('plays "quiz_answer_incorrect" when a wrong answer is selected', async () => {
    global.fetch = setupFetch()
    await renderAndLoad()

    fireEvent.click(screen.getByText('Heavy bomber'))

    expect(playSound).toHaveBeenCalledWith('quiz_answer_incorrect')
  })

  it('does NOT play "quiz_answer_incorrect" when a correct answer is selected', async () => {
    global.fetch = setupFetch()
    await renderAndLoad()

    fireEvent.click(screen.getByText('Multirole stealth fighter'))

    expect(playSound).not.toHaveBeenCalledWith('quiz_answer_incorrect')
  })

  it('does NOT play "quiz_answer_correct" when a wrong answer is selected', async () => {
    global.fetch = setupFetch()
    await renderAndLoad()

    fireEvent.click(screen.getByText('Heavy bomber'))

    expect(playSound).not.toHaveBeenCalledWith('quiz_answer_correct')
  })

  it('plays "quiz_complete_win" when quiz is completed with a win', async () => {
    global.fetch = setupFetch({ won: true })
    await renderAndLoad()

    // Answer the (only) question correctly
    fireEvent.click(screen.getByText('Multirole stealth fighter'))

    // Click "See Results"
    await waitFor(() => screen.getByText(/See Results/i))
    fireEvent.click(screen.getByText(/See Results/i))

    await waitFor(() => {
      expect(playSound).toHaveBeenCalledWith('quiz_complete_win')
    })
    expect(playSound).not.toHaveBeenCalledWith('quiz_complete_lose')
  })

  it('plays "quiz_complete_lose" when quiz is completed with a loss', async () => {
    global.fetch = setupFetch({ won: false })
    await renderAndLoad()

    // Answer incorrectly
    fireEvent.click(screen.getByText('Heavy bomber'))

    await waitFor(() => screen.getByText(/See Results/i))
    fireEvent.click(screen.getByText(/See Results/i))

    await waitFor(() => {
      expect(playSound).toHaveBeenCalledWith('quiz_complete_lose')
    })
    expect(playSound).not.toHaveBeenCalledWith('quiz_complete_win')
  })

  it('plays "quiz_answer_correct" only once per correct answer (not duplicated)', async () => {
    global.fetch = setupFetch()
    await renderAndLoad()

    fireEvent.click(screen.getByText('Multirole stealth fighter'))

    const correctCalls = playSound.mock.calls.filter(c => c[0] === 'quiz_answer_correct')
    expect(correctCalls).toHaveLength(1)
  })
})
