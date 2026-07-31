import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatNumericalOps from '../CbatNumericalOps'
import {
  NUMERICAL_OPS_TUNING, DEFAULT_NUMERICAL_OPS_DIFFICULTY, numericalOpsTuning, numericalOpsGameKey,
  computeGrade, readStoredNumericalOpsDifficulty, storeNumericalOpsDifficulty,
} from '../../utils/cbat/numericalOpsDifficulty'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

const LAUNCH_MS = 1000

function setup() {
  const apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) }))
  mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, API: '', apiFetch })
  return apiFetch
}

const startBtn = () => screen.getByRole('button', { name: /^start$/i })

describe('Numerical Operations — difficulty tuning', () => {
  it('defaults to easier and sends each difficulty to its own leaderboard', () => {
    expect(DEFAULT_NUMERICAL_OPS_DIFFICULTY).toBe('easier')
    expect(numericalOpsGameKey('easier')).toBe('numerical-ops-easier')
    expect(numericalOpsGameKey('hard')).toBe('numerical-ops')
    expect(numericalOpsTuning('nonsense')).toBe(NUMERICAL_OPS_TUNING.easier)
  })

  // Easier is the same test at a lower load — the same 20 questions on the same
  // clock, with the arithmetic itself toned down. Nothing about the round
  // structure, the question count or the 20s timeout changes.
  it('shrinks only the numbers, the ×/÷ operands and the op mix', () => {
    const e = NUMERICAL_OPS_TUNING.easier
    const h = NUMERICAL_OPS_TUNING.hard

    expect(e.roundMax).toHaveLength(h.roundMax.length)
    e.roundMax.forEach((max, i) => expect(max).toBeLessThanOrEqual(h.roundMax[i]))
    // It still escalates — an easier round 4 is bigger than an easier round 1.
    expect(e.roundMax[3]).toBeGreaterThan(e.roundMax[0])

    // Hard puts no cap on the multiplier/divisor; easier keeps it a times-table
    // fact.
    expect(h.factorMax).toBeNull()
    expect(e.factorMax).toBe(10)

    const share = (ops, op) => ops.filter(o => o === op).length / ops.length
    for (const op of ['+', '-']) {
      expect(share(e.ops, op)).toBeGreaterThan(share(h.ops, op))
    }
    expect(share(e.ops, '*')).toBeLessThan(share(h.ops, '*'))
  })

  it('carries no knobs beyond the numbers, the op mix and the grade bands', () => {
    const allowed = [
      'key', 'label', 'gameKey', 'bars', 'blurb',
      'roundMax', 'ops', 'factorMax', 'grades',
    ]
    for (const t of [NUMERICAL_OPS_TUNING.easier, NUMERICAL_OPS_TUNING.hard]) {
      expect(Object.keys(t).sort()).toEqual([...allowed].sort())
    }
  })

  it('hard keeps the original constants (unchanged for existing scores)', () => {
    expect(NUMERICAL_OPS_TUNING.hard).toMatchObject({
      roundMax: [10, 25, 50, 99],
      ops: ['+', '+', '-', '-', '*', '*', '/'],
      factorMax: null,
      grades: { outstanding: 90, good: 70, needsWork: 50 },
    })
  })

  // Both difficulties score a percentage of the same 20 questions, so unlike
  // FLAG and CUT the ceiling doesn't move — the bands go UP on easier instead
  // of down.
  it('asks for more accuracy on easier for the same grade', () => {
    const e = NUMERICAL_OPS_TUNING.easier
    const h = NUMERICAL_OPS_TUNING.hard
    for (const band of ['outstanding', 'good', 'needsWork']) {
      expect(e.grades[band]).toBeGreaterThan(h.grades[band])
    }
    expect(computeGrade(90, h)).toBe('Outstanding')
    expect(computeGrade(90, e)).toBe('Good')
    expect(computeGrade(10, e)).toBe('Failed')
  })

  describe('persistence', () => {
    beforeEach(() => localStorage.clear())

    it('falls back to the default when nothing is stored', () => {
      expect(readStoredNumericalOpsDifficulty()).toBe('easier')
    })

    it('round-trips the most recent choice and rejects a stale one', () => {
      storeNumericalOpsDifficulty('hard')
      expect(readStoredNumericalOpsDifficulty()).toBe('hard')
      storeNumericalOpsDifficulty('impossible')
      expect(readStoredNumericalOpsDifficulty()).toBe('easier')
    })
  })
})

describe('Numerical Operations — difficulty selection on the instructions card', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
  afterEach(() => vi.useRealTimers())

  it('opens on Easier with it marked as selected', () => {
    setup()
    render(<CbatNumericalOps />)
    expect(screen.getByRole('button', { name: /easier/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /hard/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows each difficulty its own round ranges', () => {
    setup()
    render(<CbatNumericalOps />)
    expect(screen.getByText(/numbers 1–50/)).toBeDefined()
    expect(screen.queryByText(/numbers 1–99/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    expect(screen.getByText(/numbers 1–99/)).toBeDefined()
  })

  it('switching to Hard repoints the leaderboard link and is remembered', () => {
    setup()
    const { unmount } = render(<CbatNumericalOps />)
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))

    expect(screen.getByRole('link', { name: /view leaderboard/i }).getAttribute('href'))
      .toBe('/cbat/numerical-ops/leaderboard')

    unmount()
    render(<CbatNumericalOps />)
    expect(screen.getByRole('button', { name: /hard/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reads the personal best from the selected difficulty board', async () => {
    const apiFetch = setup()
    render(<CbatNumericalOps />)
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url]) => url.includes('/cbat/numerical-ops-easier/personal-best'))).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url]) => url.endsWith('/cbat/numerical-ops/personal-best'))).toBe(true)
    })
  })

  it('flashes the selected difficulty for 1s before the first question', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatNumericalOps />)
    fireEvent.click(startBtn())

    // Still on the instructions card: chosen button flashing, the other greyed.
    expect(screen.queryByText('Solve')).toBeNull()
    expect(screen.getByRole('button', { name: /easier/i }).className).toContain('cbat-launch-flash')
    expect(screen.getByRole('button', { name: /hard/i }).className).toContain('cbat-launch-dim')

    await act(async () => { vi.advanceTimersByTime(900) })
    expect(screen.queryByText('Solve')).toBeNull()

    await act(async () => { vi.advanceTimersByTime(200) })
    expect(screen.getByText('Solve')).toBeDefined()
  })

  it('names the difficulty in play beside the page title', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    render(<CbatNumericalOps />)
    fireEvent.click(screen.getByRole('button', { name: /hard/i }))
    fireEvent.click(startBtn())
    await act(async () => { vi.advanceTimersByTime(LAUNCH_MS + 100) })

    const marker = document.querySelector('[data-difficulty-marker]')
    expect(marker.getAttribute('data-difficulty-marker')).toBe('hard')
    expect(marker.textContent).toContain('Hard')
  })

  it('submits a finished run to the board it was played on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { submitCbatResult } = await import('../../lib/cbatOutbox')
    setup()
    render(<CbatNumericalOps />)
    fireEvent.click(startBtn())
    await act(async () => { vi.advanceTimersByTime(LAUNCH_MS + 100) })

    // Time out all 20 questions: 20s each plus the 900ms feedback flash. The
    // question and the flash are advanced separately so React commits the phase
    // change in between — one combined advance runs the feedback timeout before
    // the effect that schedules it has been committed, and the run falls a
    // question behind per iteration.
    for (let i = 0; i < 20; i++) {
      await act(async () => { vi.advanceTimersByTime(20_000) })
      await act(async () => { vi.advanceTimersByTime(1_000) })
    }

    await waitFor(() => expect(submitCbatResult).toHaveBeenCalled())
    expect(submitCbatResult.mock.calls[0][0]).toBe('numerical-ops-easier')
    // Playing a full 20-question run through the 100ms countdown tick is a lot
    // of fake-timer work — the default 5s budget isn't enough for it.
  }, 20_000)
})

// The generated questions are what the difficulty actually IS — the tuning table
// is only a promise until the generator honours it.
describe('Numerical Operations — generated questions honour the tuning', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
  afterEach(() => vi.useRealTimers())

  function playedQuestions(difficulty) {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    localStorage.setItem('sw_cbat_numerical_ops_difficulty', difficulty)
    const { unmount } = render(<CbatNumericalOps />)
    fireEvent.click(startBtn())
    const seen = []
    act(() => { vi.advanceTimersByTime(LAUNCH_MS + 100) })
    for (let i = 0; i < 20; i++) {
      const text = document.querySelector('.font-mono.font-bold.text-white')?.textContent || ''
      const m = text.match(/^(\d+)\s*([+−×÷])\s*(\d+)/)
      if (m) seen.push({ a: Number(m[1]), op: m[2], b: Number(m[3]), round: Math.floor(i / 5) + 1 })
      // Question then feedback flash, separately — see the note in the submit
      // test: combining them lets the run drift behind what's on screen.
      act(() => { vi.advanceTimersByTime(20_000) })
      act(() => { vi.advanceTimersByTime(1_000) })
    }
    unmount()
    return seen
  }

  it('keeps easier operands inside the round cap, with times-table ×/÷', () => {
    const tuning = NUMERICAL_OPS_TUNING.easier
    // A handful of runs — the operands are random, so one run only samples a
    // slice of the space.
    for (let run = 0; run < 5; run++) {
      const qs = playedQuestions('easier')
      expect(qs.length).toBe(20)
      for (const q of qs) {
        const max = tuning.roundMax[q.round - 1]
        expect(q.a).toBeGreaterThanOrEqual(1)
        expect(q.a).toBeLessThanOrEqual(max)
        expect(q.b).toBeLessThanOrEqual(max)
        if (q.op === '×' || q.op === '÷') {
          expect(q.b).toBeLessThanOrEqual(tuning.factorMax)
        }
      }
    }
  })

  it('leaves hard free to serve the full range', () => {
    const tuning = NUMERICAL_OPS_TUNING.hard
    for (let run = 0; run < 5; run++) {
      for (const q of playedQuestions('hard')) {
        const max = tuning.roundMax[q.round - 1]
        expect(q.a).toBeLessThanOrEqual(max)
        expect(q.b).toBeLessThanOrEqual(max)
      }
    }
  })
})
