import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import QuizFlow from '../QuizFlow'
import { playSound } from '../../utils/sound'

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../utils/sound', () => ({
  playSound: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
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
  useAppSettings: () => ({ settings: {} }),
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

const mockApplyUnlocks = vi.fn()
vi.mock('../../context/NewGameUnlockContext', () => ({
  useNewGameUnlock: () => ({
    newGames:             new Set(),
    hasAnyNew:            false,
    isUnlocked:           () => false,
    markSeen:             vi.fn(),
    markUnlockFromServer: vi.fn(),
    applyUnlocks:         mockApplyUnlocks,
  }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const CORRECT_ID = 'ans_correct'

const QUESTION = {
  _id: 'q1',
  question: 'What type of aircraft is the F-35?',
  answers: [
    { _id: CORRECT_ID,  title: 'Multirole stealth fighter' },
    { _id: 'ans_wrong', title: 'Heavy bomber' },
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

function makeFinishResponse({ won = true, gameUnlocksGranted = [] } = {}) {
  return {
    data: {
      airstarsEarned:   won ? 10 : 0,
      won,
      isFirstAttempt:   true,
      breakdown:        won ? [{ label: '1 correct × 10', amount: 10 }] : [],
      gameUnlocksGranted,
    },
  }
}

function setupFetch({ won = true, gameUnlocksGranted = [] } = {}) {
  return vi.fn().mockImplementation((url) => {
    if (url.includes('/api/briefs/'))
      return Promise.resolve({ ok: true, json: async () => BRIEF_RESPONSE })
    if (url.includes('/api/games/quiz/start'))
      return Promise.resolve({ ok: true, json: async () => START_RESPONSE })
    if (url.includes('/api/games/quiz/result'))
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) })
    if (url.includes('/api/games/quiz/attempt') && url.includes('/finish'))
      return Promise.resolve({ ok: true, json: async () => makeFinishResponse({ won, gameUnlocksGranted }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function renderAndComplete({ won = true, gameUnlocksGranted = [] } = {}) {
  global.fetch = setupFetch({ won, gameUnlocksGranted })
  render(<QuizFlow />)
  await waitFor(() => screen.getByText(/What type of aircraft is the F-35\?/i))
  // Answer the (only) question
  fireEvent.click(screen.getByText('Multirole stealth fighter'))
  // Advance to results screen
  const nextBtn = await waitFor(() => screen.getByRole('button', { name: /see results/i }))
  fireEvent.click(nextBtn)
}

// ── Setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  mockApplyUnlocks.mockClear()
  playSound.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('QuizFlow — game unlock handling', () => {
  it('calls applyUnlocks with ["boo"] when finish response includes gameUnlocksGranted: ["boo"]', async () => {
    await renderAndComplete({ won: true, gameUnlocksGranted: ['boo'] })

    await waitFor(() => {
      expect(mockApplyUnlocks).toHaveBeenCalledWith(['boo'])
    })
  })

  it('does NOT call applyUnlocks when gameUnlocksGranted is empty', async () => {
    await renderAndComplete({ won: true, gameUnlocksGranted: [] })

    // playSound('quiz_complete_win') is called in handleNext before applyUnlocks;
    // waiting for it guarantees the entire async block has run.
    await waitFor(() => expect(playSound).toHaveBeenCalledWith('quiz_complete_win'))
    expect(mockApplyUnlocks).not.toHaveBeenCalled()
  })

  it('does NOT call applyUnlocks when quiz is lost and gameUnlocksGranted is empty', async () => {
    await renderAndComplete({ won: false, gameUnlocksGranted: [] })

    await waitFor(() => expect(playSound).toHaveBeenCalledWith('quiz_complete_lose'))
    expect(mockApplyUnlocks).not.toHaveBeenCalled()
  })

  it('calls applyUnlocks with all keys when multiple unlocks are granted', async () => {
    await renderAndComplete({ won: true, gameUnlocksGranted: ['boo', 'wta'] })

    await waitFor(() => {
      expect(mockApplyUnlocks).toHaveBeenCalledWith(['boo', 'wta'])
    })
  })
})
