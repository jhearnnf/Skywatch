import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import QuizFlow from '../QuizFlow'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(),
}))

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { _id: 'user1' }, API: '', awardAircoins: vi.fn() }),
}))

vi.mock('../../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { aircoinsPerBriefRead: 5 } }),
}))

vi.mock('../../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../../components/UpgradePrompt',          () => ({ default: () => null }))

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

const BRIEF_RESPONSE  = { data: { brief: { _id: 'brief123', title: 'Typhoon', category: 'Aircrafts' } } }
const START_RESPONSE  = { status: 'success', data: { attemptId: 'a1', gameSessionId: 's1', questions: [QUESTION], difficulty: 'easy' } }
const RESULT_RESPONSE = { status: 'success' }

function makeFinishResponse({ won, isFirstAttempt, breakdown, aircoinsEarned }) {
  return { ok: true, status: 200, json: async () => ({ data: { won, isFirstAttempt, breakdown, aircoinsEarned, attempt: { cycleAircoins: aircoinsEarned, totalAircoins: 100 } } }) }
}

function setupFetch(finishData, { booAvailable = false } = {}) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/'))                          return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
    if (url.includes('/api/games/quiz/start'))                 return Promise.resolve({ ok: true, status: 200, json: async () => START_RESPONSE })
    if (url.includes('/api/games/quiz/result'))                return Promise.resolve({ ok: true, status: 200, json: async () => RESULT_RESPONSE })
    if (url.includes('/finish'))                               return Promise.resolve(makeFinishResponse(finishData))
    if (url.includes('battle-of-order/options'))               return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { available: booAvailable } }) })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function completeQuiz() {
  render(<QuizFlow />)
  await waitFor(() => screen.getByText('What is the Typhoon?'))
  fireEvent.click(screen.getByText('Multirole fighter'))
  await waitFor(() => screen.getByRole('button', { name: /see results/i }))
  fireEvent.click(screen.getByRole('button', { name: /see results/i }))
  await waitFor(() => screen.getByRole('button', { name: /back to brief/i }))
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('QuizFlow — aircoins breakdown on results screen', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows breakdown line items and total on a first-attempt win', async () => {
    global.fetch = setupFetch({
      won: true, isFirstAttempt: true, aircoinsEarned: 65,
      breakdown: [
        { label: '5 correct answers × 10', amount: 50 },
        { label: 'Perfect score bonus',    amount: 15 },
      ],
    })

    await completeQuiz()

    expect(screen.getByText('5 correct answers × 10')).toBeDefined()
    expect(screen.getByText('+50')).toBeDefined()
    expect(screen.getByText('Perfect score bonus')).toBeDefined()
    expect(screen.getByText('+15')).toBeDefined()
    expect(screen.getByText('Total')).toBeDefined()
    expect(screen.getByText('+65')).toBeDefined()
    expect(screen.getByText(/65 Aircoins earned/i)).toBeDefined()
  })

  it('shows only the base line item (no perfect score row) on a non-perfect win', async () => {
    global.fetch = setupFetch({
      won: true, isFirstAttempt: true, aircoinsEarned: 40,
      breakdown: [
        { label: '4 correct answers × 10', amount: 40 },
      ],
    })

    await completeQuiz()

    expect(screen.getByText('4 correct answers × 10')).toBeDefined()
    expect(screen.getAllByText('+40').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Perfect score bonus')).toBeNull()
  })

  it('does not show a breakdown table on a loss', async () => {
    global.fetch = setupFetch({
      won: false, isFirstAttempt: true, aircoinsEarned: 0,
      breakdown: [],
    })

    await completeQuiz()

    expect(screen.queryByText('Total')).toBeNull()
    expect(screen.queryByText(/Aircoins earned/i)).toBeNull()
    expect(screen.getByText(/Score above 60%/i)).toBeDefined()
  })

  it('shows "already earned" message on a repeat win with 0 coins', async () => {
    global.fetch = setupFetch({
      won: true, isFirstAttempt: false, aircoinsEarned: 0,
      breakdown: [],
    })

    await completeQuiz()

    expect(screen.getByText(/already earned Aircoins/i)).toBeDefined()
    expect(screen.queryByText('Total')).toBeNull()
  })

  it('breakdown total row matches the badge amount', async () => {
    global.fetch = setupFetch({
      won: true, isFirstAttempt: true, aircoinsEarned: 30,
      breakdown: [{ label: '3 correct answers × 10', amount: 30 }],
    })

    await completeQuiz()

    // Badge and total row both show +30
    const thirties = screen.getAllByText('+30')
    expect(thirties.length).toBeGreaterThanOrEqual(2)
  })
})

// ── Tests: Battle of Order button ─────────────────────────────────────────

describe('QuizFlow — Battle of Order button on results screen', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows BOO button when quiz is won and BOO is available', async () => {
    global.fetch = setupFetch(
      { won: true, isFirstAttempt: true, aircoinsEarned: 0, breakdown: [] },
      { booAvailable: true },
    )
    await completeQuiz()
    await waitFor(() => expect(screen.getByRole('button', { name: /start battle of order/i })).toBeDefined())
  })

  it('shows BOO button on a repeat win (prior win exists) when BOO is available', async () => {
    global.fetch = setupFetch(
      { won: true, isFirstAttempt: false, aircoinsEarned: 0, breakdown: [] },
      { booAvailable: true },
    )
    await completeQuiz()
    await waitFor(() => expect(screen.getByRole('button', { name: /start battle of order/i })).toBeDefined())
  })

  it('does not show BOO button when quiz is won but BOO is unavailable', async () => {
    global.fetch = setupFetch(
      { won: true, isFirstAttempt: true, aircoinsEarned: 0, breakdown: [] },
      { booAvailable: false },
    )
    await completeQuiz()
    await waitFor(() => screen.getByRole('button', { name: /back to brief/i }))
    expect(screen.queryByRole('button', { name: /start battle of order/i })).toBeNull()
  })

  it('does not show BOO button when quiz is lost (no prior win)', async () => {
    global.fetch = setupFetch(
      { won: false, isFirstAttempt: true, aircoinsEarned: 0, breakdown: [] },
      { booAvailable: true },
    )
    await completeQuiz()
    await waitFor(() => screen.getByRole('button', { name: /back to brief/i }))
    expect(screen.queryByRole('button', { name: /start battle of order/i })).toBeNull()
  })

  it('BOO button appears above Try Again button', async () => {
    global.fetch = setupFetch(
      { won: false, isFirstAttempt: false, aircoinsEarned: 0, breakdown: [] },
      { booAvailable: true },
    )
    await completeQuiz()
    await waitFor(() => screen.getByRole('button', { name: /start battle of order/i }))
    const buttons = screen.getAllByRole('button')
    const booIdx  = buttons.findIndex(b => /start battle of order/i.test(b.textContent))
    const retryIdx = buttons.findIndex(b => /try again/i.test(b.textContent))
    expect(booIdx).toBeLessThan(retryIdx)
  })

  it('clicking BOO button navigates to /battle-of-order/:briefId', async () => {
    const mockNavigate = vi.fn()
    vi.mocked(await import('react-router-dom')).useNavigate = () => mockNavigate

    global.fetch = setupFetch(
      { won: true, isFirstAttempt: true, aircoinsEarned: 0, breakdown: [] },
      { booAvailable: true },
    )
    await completeQuiz()
    await waitFor(() => screen.getByRole('button', { name: /start battle of order/i }))
    fireEvent.click(screen.getByRole('button', { name: /start battle of order/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/battle-of-order/brief123')
  })
})
