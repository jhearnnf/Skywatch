import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatAnt from '../CbatAnt'
import { formatHHMM } from '../../utils/antGenerator'
import { PRACTISE_QUESTION_COUNT, PRACTISE_MAX_SCORE } from '../../utils/cbat/antPractise'
import { submitCbatResult } from '../../lib/cbatOutbox'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockSettings = vi.hoisted(() => ({ current: {} }))
// The sheet is random; keep a handle on the rounds so the test can answer them.
const runRef = vi.hoisted(() => ({ current: null }))

vi.mock('../../utils/cbat/antPractise', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    buildPractiseRun: (...args) => {
      runRef.current = actual.buildPractiseRun(...args)
      return runRef.current
    },
  }
})

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: mockSettings.current }),
}))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), markCompleted: vi.fn(), setRound: vi.fn() }),
}))
vi.mock('../../lib/cbatOutbox', () => ({
  submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className, style }) => <div className={className} style={style}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

function setupUser() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', email: 'a@b.com' },
    API: '',
    apiFetch: vi.fn().mockImplementation((url) =>
      Promise.resolve({ ok: true, json: async () => (url.includes('/personal-best') ? { data: null } : {}) })),
  })
}

const boxes = () => [...document.querySelectorAll('input[inputmode="numeric"]')]
const markBtn = () => screen.getByRole('button', { name: /mark my answers/i })

function openPractise() {
  render(<CbatAnt />)
  fireEvent.click(screen.getByRole('button', { name: /^practise$/i }))
}

function correctAnswerFor(round) {
  return round.type === 'arrival' ? formatHHMM(round.correctAnswer) : String(round.correctAnswer)
}

// Fill question `i` (0-indexed) with the right answer.
function answer(i) {
  fireEvent.change(boxes()[i], { target: { value: correctAnswerFor(runRef.current[i]) } })
}

function answerAll() {
  for (let i = 0; i < PRACTISE_QUESTION_COUNT; i++) answer(i)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatAnt — practise sheet', () => {
  beforeEach(() => { vi.clearAllMocks(); setupUser(); mockSettings.current = {} })

  it('puts every question on the page at once, each with its own box', () => {
    openPractise()
    expect(boxes()).toHaveLength(PRACTISE_QUESTION_COUNT)
    // Every question is readable straight away, not revealed one at a time.
    runRef.current.forEach((_, i) => {
      expect(screen.getByLabelText(new RegExp(`^Question ${i + 1} answer in`))).toBeTruthy()
    })
  })

  it('keeps the board out of it — no map, tables or route names', () => {
    openPractise()
    expect(document.body.textContent).toMatch(/You travel|You leave/)
    expect(screen.queryByText(/Weight Reference/i)).toBeNull()
    expect(document.querySelector('svg')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Victor|Xray|Yankee|Zulu|Whiskey|Tango|Romeo|Papa/)
  })

  it('lets you answer in any order and counts what is done', () => {
    openPractise()
    expect(document.body.textContent).toContain(`0 of ${PRACTISE_QUESTION_COUNT} answered`)

    // Start at the fifth question, then the second — the whole point of a sheet.
    answer(4)
    expect(document.body.textContent).toContain(`1 of ${PRACTISE_QUESTION_COUNT} answered`)
    answer(1)
    expect(document.body.textContent).toContain(`2 of ${PRACTISE_QUESTION_COUNT} answered`)
    // The boxes hold what was typed, each independently.
    expect(boxes()[4].value).toBe(correctAnswerFor(runRef.current[4]))
    expect(boxes()[1].value).toBe(correctAnswerFor(runRef.current[1]))
    expect(boxes()[0].value).toBe('')
  })

  it('marks nothing, and gives nothing away, until the sheet is handed in', () => {
    openPractise()
    answerAll()
    expect(screen.queryByText(/Your sheet, marked/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/Correct:/)
    expect(document.body.textContent).not.toMatch(/Flight time/)
  })

  it('marks the whole sheet and submits it to the practise board', () => {
    openPractise()
    answerAll()
    fireEvent.click(markBtn())

    expect(submitCbatResult).toHaveBeenCalledTimes(1)
    const [gameKey, payload] = submitCbatResult.mock.calls[0]
    expect(gameKey).toBe('ant-practise')
    expect(payload).toMatchObject({
      totalScore: PRACTISE_MAX_SCORE,
      exactCount: PRACTISE_QUESTION_COUNT,
      partialCount: 0,
      missCount: 0,
      roundsPlayed: PRACTISE_QUESTION_COUNT,
      grade: 'Outstanding',
    })
  })

  it('shows the marked sheet with the maths for every question', () => {
    openPractise()
    answerAll()
    fireEvent.click(markBtn())

    expect(screen.getByText(/Your sheet, marked/i)).toBeTruthy()
    expect(screen.getAllByText(/Flight time/)).toHaveLength(PRACTISE_QUESTION_COUNT)
    expect(screen.getByText(/By calculation/i)).toBeTruthy()
    expect(document.body.textContent).toContain(`${PRACTISE_MAX_SCORE}/${PRACTISE_MAX_SCORE}`)
  })

  it('scores a blank as zero and says so', () => {
    openPractise()
    for (let i = 1; i < PRACTISE_QUESTION_COUNT; i++) answer(i)
    expect(document.body.textContent).toContain('blanks score 0')
    fireEvent.click(markBtn())

    const [, payload] = submitCbatResult.mock.calls[0]
    expect(payload.totalScore).toBe(PRACTISE_MAX_SCORE - 10)
    expect(payload.missCount).toBe(1)
    expect(screen.getByText(/Blank \+0/)).toBeTruthy()
  })

  it('scores the drill on its own board, never on ANT\'s', () => {
    openPractise()
    answerAll()
    fireEvent.click(markBtn())
    expect(submitCbatResult.mock.calls.some(([key]) => key === 'ant')).toBe(false)
  })

  it('hides Practise when an admin disables the ant-practise board', () => {
    mockSettings.current = { cbatGameEnabled: { 'ant-practise': false } }
    render(<CbatAnt />)
    expect(screen.queryByRole('button', { name: /^practise$/i })).toBeNull()
    // ANT itself is untouched.
    expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^tutorial$/i })).toBeTruthy()
  })
})
