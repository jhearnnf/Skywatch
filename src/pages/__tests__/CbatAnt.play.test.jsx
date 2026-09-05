import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatAnt from '../CbatAnt'
import { WEIGHT_TABLE, parseHHMM } from '../../utils/antGenerator'
import { ANT_LAUNCH_MS } from '../../utils/cbat/antDifficulty'

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())
// buildRound() is random; pin the question type so each test drills one path.
const roundType = vi.hoisted(() => ({ current: 'distance' }))

vi.mock('../../utils/antGenerator', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, buildRound: (type) => actual.buildRound(type ?? roundType.current) }
})

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
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

const input = () => document.querySelector('input[inputmode="numeric"]')
const submitBtn = () => screen.getByRole('button', { name: /^submit$/i })
const nextBtn = () => screen.getByRole('button', { name: /next round|see results/i })
const answerSlot = () => document.querySelector('.min-h-\\[9rem\\]')?.textContent ?? ''

// Solve the visible distance round the way a player would: (arrive − now) × mi/min.
function distanceAnswer() {
  const cells = document.querySelectorAll('tbody tr td')
  const travel = parseHHMM(cells[4].textContent) - parseHHMM(cells[3].textContent)
  const row = WEIGHT_TABLE.find(r => r.weight === parseInt(cells[6].textContent, 10))
  return String(travel * row.mpm)
}

// Start no longer drops straight into round 1: ANT ships an Easier/Hard split,
// and pressing Start flashes the chosen difficulty for a beat first so you can
// see which board you are about to play. Every run has to step over that,
// whether or not the test itself cares about timers, so the fake clock is
// installed here rather than per test. afterEach puts the real one back.
//
// This drills the Easier board — the original eight-round one on the plain
// `ant` key, which is the default and what the panels below are written for.
function startGame() {
  vi.useFakeTimers()
  render(<CbatAnt />)
  fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
  act(() => { vi.advanceTimersByTime(ANT_LAUNCH_MS + 10) })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatAnt — live round', () => {
  beforeEach(() => { vi.clearAllMocks(); setupUser(); roundType.current = 'distance' })
  afterEach(() => { vi.useRealTimers() })

  it('grades the answer in the box when the round clock runs out', () => {
    // Regression: the clock used to read a snapshot of the box taken when the
    // round began — always empty — so a correct answer scored 0 on timeout.
    vi.useFakeTimers()
    startGame()
    const answer = distanceAnswer()
    fireEvent.change(input(), { target: { value: answer } })
    act(() => { vi.advanceTimersByTime(61_000) })

    expect(answerSlot()).toMatch(/Exact/)
    expect(answerSlot()).toMatch(/\+10 pts/)
    expect(screen.getByText(/Score/).textContent).toMatch(/10/)
  })

  it('ignores a Submit with an empty answer box', () => {
    startGame()
    fireEvent.click(submitBtn())
    expect(input()).toBeTruthy()                      // still on the question
    expect(answerSlot()).not.toMatch(/Correct:/)
  })

  it('holds the debrief until the player asks for the next round', () => {
    vi.useFakeTimers()
    startGame()
    fireEvent.change(input(), { target: { value: distanceAnswer() } })
    fireEvent.click(submitBtn())

    act(() => { vi.advanceTimersByTime(30_000) })     // no auto-advance
    expect(screen.queryByRole('button', { name: /^submit$/i })).toBeNull()  // still on the debrief
    expect(nextBtn()).toBeTruthy()
    expect(screen.getByText(/clock paused/i)).toBeTruthy()

    fireEvent.click(nextBtn())
    expect(input()).toBeTruthy()
    expect(input().value).toBe('')
  })

  it('shows the worked solution and pulses the values it used', () => {
    startGame()
    fireEvent.change(input(), { target: { value: '1' } })     // deliberately wrong
    fireEvent.click(submitBtn())

    expect(answerSlot()).toMatch(/How it's worked out/)
    expect(answerSlot()).toMatch(/Flight time/)
    expect(answerSlot()).toMatch(/Distance/)
    expect(answerSlot()).toMatch(/You:/)
    // each step says where its numbers came from
    expect(answerSlot()).toMatch(/straight off the Timings panel/)
    expect(answerSlot()).toMatch(/miles\/min in the parcel table/)
    // the clock cells and the parcel's mi/min pulse in place on the board
    expect(document.querySelectorAll('.cbat-cell-flash').length).toBeGreaterThan(2)
    // and the legs hidden during play come back
    expect(screen.getByText(/Distances now shown/i)).toBeTruthy()
  })

  it('hides the parcel weight table on speed rounds', () => {
    roundType.current = 'speed'
    startGame()
    expect(screen.getByText(/^Speed$/)).toBeTruthy()
    expect(screen.queryByText(/Parcel Weight Reference/i)).toBeNull()
  })
})
