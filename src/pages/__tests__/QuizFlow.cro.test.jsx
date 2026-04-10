import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import QuizFlow from '../QuizFlow'

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mockNavigate    = vi.hoisted(() => vi.fn())
const mockUseAuth     = vi.hoisted(() => vi.fn())
const mockUseSettings = vi.hoisted(() => vi.fn())

vi.mock('../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => mockNavigate, useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: mockUseSettings }))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt',          () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick, disabled }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
    circle: ({ children }) => <circle>{children}</circle>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const CORRECT_ID = 'ans_correct'
const WRONG_ID   = 'ans_wrong'

const QUESTION = {
  _id: 'q1',
  question: 'What is the Typhoon?',
  answers: [
    { _id: CORRECT_ID, title: 'Multirole fighter' },
    { _id: WRONG_ID,   title: 'Heavy bomber'      },
  ],
  correctAnswerId: CORRECT_ID,
}

const BRIEF_RESPONSE = { data: { brief: { _id: 'brief123', title: 'Typhoon', category: 'Aircrafts' } } }
const START_RESPONSE = { status: 'success', data: { attemptId: 'a1', gameSessionId: 's1', questions: [QUESTION], difficulty: 'easy' } }

function makeFinishResponse(won = true) {
  return {
    ok: true, status: 200,
    json: async () => ({
      data: {
        won,
        isFirstAttempt: true,
        breakdown: [],
        aircoinsEarned: won ? 5 : 0,
        attempt: { cycleAircoins: 5, totalAircoins: 100 },
      },
    }),
  }
}

function setupFetch(won = true) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/'))        return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
    if (url.includes('/api/games/quiz/start')) return Promise.resolve({ ok: true, status: 200, json: async () => START_RESPONSE })
    if (url.includes('/api/games/quiz/result')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    if (url.includes('/finish'))             return Promise.resolve(makeFinishResponse(won))
    if (url.includes('battle-of-order'))     return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { available: false } }) })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

// Free user: only has access to freeCategories (e.g. News)
const FREE_USER     = { _id: 'u1', subscriptionTier: 'free' }
// Silver user: has access to silverCategories too
const SILVER_USER   = { _id: 'u2', subscriptionTier: 'silver' }

const FREE_SETTINGS    = { freeCategories: ['News'], silverCategories: ['Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Roles', 'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties'], aircoinsPerBriefRead: 5 }
const SILVER_SETTINGS  = { freeCategories: ['News'], silverCategories: ['Aircrafts', 'Bases', 'Ranks', 'Squadrons'], aircoinsPerBriefRead: 5 }

// ── Helpers ───────────────────────────────────────────────────────────────

async function completeQuiz(answer = CORRECT_ID) {
  await waitFor(() => screen.getByText('What is the Typhoon?'))
  fireEvent.click(screen.getByText(answer === CORRECT_ID ? 'Multirole fighter' : 'Heavy bomber'))
  await waitFor(() => screen.getByRole('button', { name: /see results/i }))
  fireEvent.click(screen.getByRole('button', { name: /see results/i }))
  await waitFor(() => screen.getByRole('button', { name: /back to brief/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('QuizFlow — locked category upsell teaser', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockUseAuth.mockReset()
    mockUseSettings.mockReset()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows upsell teaser on a WIN for a free signed-in user', async () => {
    mockUseAuth.mockReturnValue({ user: FREE_USER, API: '', apiFetch: (...args) => fetch(...args), awardAircoins: vi.fn() })
    mockUseSettings.mockReturnValue({ settings: FREE_SETTINGS })
    global.fetch = setupFetch(true)
    render(<QuizFlow />)
    await completeQuiz(CORRECT_ID)
    expect(screen.getByText('5-day free trial →')).toBeDefined()
  })

  it('does NOT show upsell teaser on a LOSS', async () => {
    mockUseAuth.mockReturnValue({ user: FREE_USER, API: '', apiFetch: (...args) => fetch(...args), awardAircoins: vi.fn() })
    mockUseSettings.mockReturnValue({ settings: FREE_SETTINGS })
    global.fetch = setupFetch(false)
    render(<QuizFlow />)
    await completeQuiz(WRONG_ID)
    expect(screen.queryByText('5-day free trial →')).toBeNull()
  })

  it('does NOT show upsell teaser for a silver user on a win', async () => {
    mockUseAuth.mockReturnValue({ user: SILVER_USER, API: '', apiFetch: (...args) => fetch(...args), awardAircoins: vi.fn() })
    mockUseSettings.mockReturnValue({ settings: SILVER_SETTINGS })
    global.fetch = setupFetch(true)
    render(<QuizFlow />)
    await completeQuiz(CORRECT_ID)
    expect(screen.queryByText('5-day free trial →')).toBeNull()
  })

  it('does NOT show upsell teaser for a guest (null user) on a win', async () => {
    mockUseAuth.mockReturnValue({ user: null, API: '', apiFetch: (...args) => fetch(...args), awardAircoins: vi.fn() })
    mockUseSettings.mockReturnValue({ settings: FREE_SETTINGS })
    global.fetch = setupFetch(true)
    render(<QuizFlow />)
    await completeQuiz(CORRECT_ID)
    expect(screen.queryByText('5-day free trial →')).toBeNull()
  })

  it('upsell teaser shows the highest-priority locked category (Threats first)', async () => {
    mockUseAuth.mockReturnValue({ user: FREE_USER, API: '', apiFetch: (...args) => fetch(...args), awardAircoins: vi.fn() })
    mockUseSettings.mockReturnValue({ settings: FREE_SETTINGS })
    global.fetch = setupFetch(true)
    render(<QuizFlow />)
    await completeQuiz(CORRECT_ID)
    // Threats is first in UPSELL_PRIORITY and locked for free users
    expect(screen.getByText('Threats')).toBeDefined()
  })
})
